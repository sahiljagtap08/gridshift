"""Event orchestrator: drives the grid-event state machine (spec sections 8, 20, 25).

RECEIVED -> PLANNING -> AWAITING_APPROVAL -> EXECUTING -> VERIFYING
    -> TARGET_MET -> RESTORING -> COMPLETED
VERIFYING -> AWAITING_APPROVAL on shortfall (replan the gap)
Side exits: CANCELLED, FAILED, REQUIRES_OPERATOR, BLOCKED, PARTIAL_EXECUTION
"""

from __future__ import annotations

import asyncio
from datetime import datetime

from app.adapters.mock import MockAdapter
from app.core.audit import record_audit, record_timeline
from app.core.bus import Bus
from app.core.config import Settings
from app.core.store import Store, now
from app.models import ActionPlan, Approval, EventTarget, GridEvent, TelemetrySample
from app.services import optimizer
from app.services.verification import compute_verification


class OrchestratorError(Exception):
    def __init__(self, status_code: int, detail: str, **extra):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.extra = extra


class Orchestrator:
    def __init__(self, store: Store, settings: Settings, bus: Bus) -> None:
        self.store = store
        self.settings = settings
        self.bus = bus
        self.adapters: dict[str, MockAdapter] = {}
        self._tasks: set[asyncio.Task] = set()
        self._telemetry_task: asyncio.Task | None = None
        self._hold_tasks: dict[str, asyncio.Task] = {}

    # ---- lifecycle ---------------------------------------------------

    def adapter_for(self, cluster_id: str) -> MockAdapter:
        if cluster_id not in self.adapters:
            self.adapters[cluster_id] = MockAdapter(
                self.store, cluster_id, seed=self.settings.demo_random_seed,
                action_latency_seconds=self.settings.demo_action_latency_seconds,
            )
        return self.adapters[cluster_id]

    def reset(self) -> None:
        for t in list(self._tasks) + list(self._hold_tasks.values()):
            t.cancel()
        self._tasks.clear()
        self._hold_tasks.clear()
        self.adapters.clear()

    def start_telemetry(self) -> None:
        if self._telemetry_task is None or self._telemetry_task.done():
            self._telemetry_task = asyncio.create_task(self._telemetry_loop())

    async def stop(self) -> None:
        if self._telemetry_task:
            self._telemetry_task.cancel()
        self.reset()

    def _spawn(self, coro) -> asyncio.Task:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return t

    # ---- telemetry ---------------------------------------------------

    def sample_now(self, cluster_id: str) -> TelemetrySample:
        cluster = self.store.clusters[cluster_id]
        site = self.store.sites[cluster.site_id]
        adapter = self.adapter_for(cluster_id)
        per = {w.id: round(w.current_power_mw, 4) for w in self.store.workloads_for_cluster(cluster_id)}
        it = adapter.it_power_mw() * (1 + adapter.sample_noise())
        sample = TelemetrySample(
            site_id=site.id, cluster_id=cluster_id, it_power_mw=round(it, 4),
            facility_power_mw=round(it * site.pue, 4), timestamp=now(), per_workload_mw=per,
        )
        self.store.telemetry.append(sample)
        if len(self.store.telemetry) > 5000:
            del self.store.telemetry[:1000]
        self.bus.publish("telemetry", {"sample": sample})
        return sample

    async def _telemetry_loop(self) -> None:
        while True:
            try:
                for cluster_id in list(self.store.clusters):
                    self.sample_now(cluster_id)
            except Exception:  # keep the loop alive during demo
                pass
            await asyncio.sleep(self.settings.demo_telemetry_interval_seconds)

    def current_facility_mw(self, site_id: str) -> float:
        recent = self.store.recent_telemetry(site_id, limit=3)
        if not recent:
            cluster = next(c for c in self.store.clusters.values() if c.site_id == site_id)
            return self.sample_now(cluster.id).facility_power_mw
        return round(sum(s.facility_power_mw for s in recent) / len(recent), 4)

    # ---- event creation & planning ----------------------------------

    def _emit(self, event: GridEvent, kind: str, message: str, **data) -> None:
        record_timeline(self.store, event.id, kind, message, **data)
        self.bus.publish("event", {"event_id": event.id, "status": event.status, "kind": kind, "message": message, "data": data})

    def _set_status(self, event: GridEvent, status: str, message: str | None = None, **data) -> None:
        event.status = status  # type: ignore[assignment]
        self._emit(event, "status", message or status.replace("_", " ").title(), **data)

    async def create_event(
        self, *, site_id: str, policy_version_id: str, target: EventTarget, duration_minutes: int,
        response_time_minutes: int, source: str = "demo", simulate_under_delivery: bool = False,
        actor_id: str = "operator_demo",
    ) -> GridEvent:
        site = self.store.sites.get(site_id)
        if site is None:
            raise OrchestratorError(404, "site not found")
        pv = self.store.policy_versions.get(policy_version_id)
        if pv is None:
            raise OrchestratorError(404, "policy version not found")
        if pv.status != "ACTIVE":
            raise OrchestratorError(422, f"policy version {pv.id} is {pv.status}; only ACTIVE versions can drive live events (INV-3)")
        cluster = next((c for c in self.store.clusters.values() if c.site_id == site_id), None)
        if cluster is None:
            raise OrchestratorError(422, "site has no connected cluster")

        baseline = self.current_facility_mw(site_id)
        target_mw = round(baseline * target.value / 100, 4) if target.type == "percent" else round(target.value, 4)
        event = GridEvent(
            id=self.store.new_id("evt"), site_id=site_id, cluster_id=cluster.id, policy_version_id=pv.id,
            source=source, target=target, baseline_mw=baseline, target_reduction_mw=target_mw,
            duration_minutes=duration_minutes, response_time_minutes=response_time_minutes,
            simulate_under_delivery=simulate_under_delivery, received_at=now(),
        )
        self.store.events[event.id] = event
        record_audit(self.store, actor_type="user", actor_id=actor_id, event_type="event.created",
                     entity_type="grid_event", entity_id=event.id,
                     payload={"baseline_mw": baseline, "target_reduction_mw": target_mw, "policy_version_id": pv.id})
        self._emit(event, "received", f"Event received: {target_mw:.2f} MW for {duration_minutes} min",
                   baseline_mw=baseline, target_reduction_mw=target_mw)

        if cluster.status != "connected" or not cluster.observe_enabled:
            self._set_status(event, "BLOCKED", "Cluster adapter unavailable; cannot plan or claim available MW")
            return event
        if not cluster.actuation_enabled:
            self._set_status(event, "BLOCKED", "Actuation permission not granted for this cluster")
            return event

        self.adapter_for(cluster.id).under_delivery = simulate_under_delivery
        self._set_status(event, "PLANNING", "Snapshot frozen; building least-disruptive plan")
        self.build_plan(event, gap_mw=target_mw, round_=1)
        return event

    def build_plan(self, event: GridEvent, gap_mw: float, round_: int) -> ActionPlan:
        workloads = self.store.workloads_for_cluster(event.cluster_id)
        result = optimizer.build_plan(workloads, gap_mw=gap_mw, duration_minutes=event.duration_minutes, at=now())
        digest, snap = optimizer.snapshot_hash(workloads)
        plan_id = self.store.new_id("plan")
        plan = ActionPlan(
            id=plan_id, grid_event_id=event.id, round=round_, workload_snapshot_hash=digest, workload_snapshot=snap,
            target_reduction_mw=round(gap_mw, 4), expected_reduction_mw=result.expected_reduction_mw,
            disruption_score=result.disruption_score, status="AWAITING_APPROVAL" if result.feasible else "INFEASIBLE",
            actions=optimizer.to_actions(result, plan_id, self.store.new_id),
            protected_workload_ids=[w.id for w in workloads if w.protected],
            infeasible_reason=result.infeasible_reason, created_at=now(),
        )
        self.store.plans[plan.id] = plan
        event.plan_ids.append(plan.id)
        event.active_plan_id = plan.id
        record_audit(self.store, actor_type="system", actor_id="optimizer", event_type="plan.generated",
                     entity_type="action_plan", entity_id=plan.id,
                     payload={"round": round_, "expected_reduction_mw": plan.expected_reduction_mw,
                              "actions": [(a.workload_id, a.action_type, a.parameters) for a in plan.actions],
                              "exclusions": [e.__dict__ for e in result.exclusions]})
        if result.feasible:
            self._set_status(event, "AWAITING_APPROVAL",
                             f"Plan round {round_}: {plan.expected_reduction_mw:.2f} MW expected from {len(plan.actions)} action(s)",
                             plan_id=plan.id)
        else:
            self._set_status(event, "REQUIRES_OPERATOR",
                             f"No feasible plan for {gap_mw:.2f} MW: {result.infeasible_reason}", plan_id=plan.id)
        return plan

    # ---- approval ----------------------------------------------------

    def approve(self, plan_id: str, user_id: str, comment: str | None = None) -> ActionPlan:
        plan = self.store.plans.get(plan_id)
        if plan is None:
            raise OrchestratorError(404, "plan not found")
        event = self.store.events[plan.grid_event_id]
        if plan.status != "AWAITING_APPROVAL" or event.status != "AWAITING_APPROVAL":
            raise OrchestratorError(409, f"plan is {plan.status}, event is {event.status}; nothing to approve")

        digest, _ = optimizer.snapshot_hash(self.store.workloads_for_cluster(event.cluster_id))
        if digest != plan.workload_snapshot_hash:
            plan.status = "SUPERSEDED"
            self._emit(event, "stale", "Workload snapshot changed since planning; plan invalidated and rebuilt (INV-8)")
            new_plan = self.build_plan(event, gap_mw=plan.target_reduction_mw, round_=plan.round)
            raise OrchestratorError(409, "workload snapshot changed since planning; a new plan was generated",
                                    new_plan_id=new_plan.id)

        approval = Approval(id=self.store.new_id("apr"), action_plan_id=plan.id, plan_hash=optimizer.plan_hash(plan),
                            user_id=user_id, decision="approve", comment=comment, created_at=now())
        self.store.approvals[approval.id] = approval
        plan.status = "APPROVED"
        record_audit(self.store, actor_type="user", actor_id=user_id, event_type="plan.approved",
                     entity_type="action_plan", entity_id=plan.id, payload={"plan_hash": approval.plan_hash})
        self._emit(event, "approved", f"Approved by {user_id}", plan_id=plan.id, plan_hash=approval.plan_hash)
        self._set_status(event, "EXECUTING", "Executing approved actions through scheduler adapter")
        self._spawn(self._execute(event, plan))
        return plan

    def reject(self, plan_id: str, user_id: str, comment: str | None = None) -> ActionPlan:
        plan = self.store.plans.get(plan_id)
        if plan is None:
            raise OrchestratorError(404, "plan not found")
        event = self.store.events[plan.grid_event_id]
        if plan.status != "AWAITING_APPROVAL":
            raise OrchestratorError(409, f"plan is {plan.status}")
        plan.status = "REJECTED"
        self.store.approvals[self.store.new_id("apr")] = Approval(
            id="", action_plan_id=plan.id, plan_hash=optimizer.plan_hash(plan), user_id=user_id,
            decision="reject", comment=comment, created_at=now())
        record_audit(self.store, actor_type="user", actor_id=user_id, event_type="plan.rejected",
                     entity_type="action_plan", entity_id=plan.id, payload={"comment": comment})
        if plan.round == 1:
            self._set_status(event, "CANCELLED", f"Plan rejected by {user_id}; event cancelled")
        else:
            self._set_status(event, "REQUIRES_OPERATOR", f"Replan rejected by {user_id}; shortfall remains")
        return plan

    # ---- execution & verification -----------------------------------

    async def _execute(self, event: GridEvent, plan: ActionPlan) -> None:
        adapter = self.adapter_for(event.cluster_id)
        if event.started_at is None:
            event.started_at = now()
        plan.status = "EXECUTED"
        succeeded = failed = 0
        for action in plan.actions:
            action.status = "EXECUTING"
            record_audit(self.store, actor_type="system", actor_id="orchestrator", event_type="action.executing",
                         entity_type="action", entity_id=action.id,
                         payload={"workload_id": action.workload_id, "action_type": action.action_type})
            v = await adapter.validate_action(action)
            if not v.ok:
                action.status = "FAILED"
                action.result = {"ok": False, "message": v.reason}
                failed += 1
                self._emit(event, "action_failed", f"{action.workload_name}: {v.reason}", action_id=action.id)
                continue
            r = await adapter.execute_action(action)
            action.executed_at = now()
            action.result = r.model_dump()
            if r.ok:
                action.status = "SUCCEEDED"
                succeeded += 1
                self._emit(event, "action", self._describe(action), action_id=action.id,
                           workload_id=action.workload_id, new_state=r.new_state, new_power_mw=r.new_power_mw)
            else:
                action.status = "FAILED"
                failed += 1
                self._emit(event, "action_failed", f"{action.workload_name}: {r.message}", action_id=action.id)
            record_audit(self.store, actor_type="system", actor_id="mock_adapter", event_type="action.result",
                         entity_type="action", entity_id=action.id, payload=action.result)
            self.sample_now(event.cluster_id)
        adapter.mark_plan_executed()

        if failed and not succeeded:
            self._set_status(event, "FAILED", "All actions failed; no reduction applied")
            return
        if failed:
            self._set_status(event, "PARTIAL_EXECUTION",
                             f"{succeeded} action(s) applied, {failed} failed; replan required",
                             succeeded=succeeded, failed=failed)
        await self._verify(event)

    @staticmethod
    def _describe(action) -> str:
        if action.action_type == "throttle":
            pct = int(action.parameters.get("throttle_percent", 0) * 100)
            return f"{action.workload_name} throttled -{pct}%"
        return f"{action.workload_name} {action.action_type}{'ed' if action.action_type != 'defer' else 'red'}"

    async def _verify(self, event: GridEvent) -> None:
        self._set_status(event, "VERIFYING", "Waiting for telemetry to settle")
        settle_started = now()
        await asyncio.sleep(self.settings.demo_verify_settle_seconds)
        for _ in range(3):
            self.sample_now(event.cluster_id)
        post_action = [s for s in self.store.recent_telemetry(event.site_id, limit=50) if s.timestamp >= settle_started]
        record = compute_verification(
            record_id=self.store.new_id("ver"), event_id=event.id, baseline_mw=event.baseline_mw,
            target_reduction_mw=event.target_reduction_mw, plans=self.store.plans_for_event(event.id),
            samples=post_action,
            workloads=self.store.workloads_for_cluster(event.cluster_id),
        )
        self.store.verifications[record.id] = record
        event.verification_id = record.id
        record_audit(self.store, actor_type="system", actor_id="verification", event_type="event.verified",
                     entity_type="verification_record", entity_id=record.id, payload=record.calculation)

        if record.status == "UNVERIFIED":
            self._set_status(event, "REQUIRES_OPERATOR", "Telemetry unavailable; reduction is UNVERIFIED")
            return
        measured = record.verified_reduction_mw or 0.0
        if record.target_met:
            event.target_met_at = now()
            self._set_status(event, "TARGET_MET",
                             f"Target met: measured {measured:.2f} MW vs target {event.target_reduction_mw:.2f} MW",
                             measured_mw=measured, verification_id=record.id)
            self._hold_tasks[event.id] = self._spawn(self._hold_then_end(event))
        else:
            gap = round(event.target_reduction_mw - measured, 4)
            self._emit(event, "shortfall", f"Shortfall: measured {measured:.2f} MW, gap {gap:.2f} MW; replanning",
                       measured_mw=measured, gap_mw=gap)
            next_round = max(p.round for p in self.store.plans_for_event(event.id)) + 1
            self.build_plan(event, gap_mw=gap, round_=next_round)

    async def _hold_then_end(self, event: GridEvent) -> None:
        await asyncio.sleep(self.settings.demo_event_hold_seconds)
        if event.status == "TARGET_MET":
            await self.end_event(event.id, actor_id="system", reason="event window elapsed (demo-compressed)")

    # ---- restore -----------------------------------------------------

    async def end_event(self, event_id: str, actor_id: str = "operator_demo", reason: str = "ended by operator") -> GridEvent:
        event = self.store.events.get(event_id)
        if event is None:
            raise OrchestratorError(404, "event not found")
        if event.status not in ("TARGET_MET", "AWAITING_APPROVAL", "REQUIRES_OPERATOR", "PARTIAL_EXECUTION", "VERIFYING"):
            raise OrchestratorError(409, f"event is {event.status}; cannot end")
        hold = self._hold_tasks.pop(event.id, None)
        if hold and hold is not asyncio.current_task():
            hold.cancel()
        event.ended_at = now()
        record_audit(self.store, actor_type="user" if actor_id != "system" else "system", actor_id=actor_id,
                     event_type="event.ended", entity_type="grid_event", entity_id=event.id, payload={"reason": reason})
        await self._restore(event, reason)
        return event

    async def _restore(self, event: GridEvent, reason: str) -> None:
        self._set_status(event, "RESTORING", f"Event ended ({reason}); staged restore to avoid rebound peak")
        adapter = self.adapter_for(event.cluster_id)
        actions = [a for p in self.store.plans_for_event(event.id) for a in p.actions if a.status == "SUCCEEDED"]
        priority = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        actions.sort(key=lambda a: (priority[self.store.workloads[a.workload_id].criticality], a.workload_id))
        restored = 0
        for a in actions:
            r = await adapter.rollback_action(a)
            a.status = "RESTORED" if r.ok else a.status
            a.restored_at = now()
            record_audit(self.store, actor_type="system", actor_id="orchestrator", event_type="action.restored",
                         entity_type="action", entity_id=a.id, payload=r.model_dump())
            self._emit(event, "restore", f"{a.workload_name} restored to running", action_id=a.id,
                       workload_id=a.workload_id, new_power_mw=r.new_power_mw)
            restored += 1
            self.sample_now(event.cluster_id)
            await asyncio.sleep(self.settings.demo_restore_stage_seconds)
        event.completed_at = now()
        self._set_status(event, "COMPLETED", f"All {restored} workload(s) restored; event record finalized",
                         restored=restored, verification_id=event.verification_id)

    async def cancel(self, event_id: str, actor_id: str = "operator_demo") -> GridEvent:
        event = self.store.events.get(event_id)
        if event is None:
            raise OrchestratorError(404, "event not found")
        if event.status in ("COMPLETED", "CANCELLED", "FAILED"):
            raise OrchestratorError(409, f"event already {event.status}")
        hold = self._hold_tasks.pop(event.id, None)
        if hold:
            hold.cancel()
        has_changes = any(a.status == "SUCCEEDED" for p in self.store.plans_for_event(event.id) for a in p.actions)
        record_audit(self.store, actor_type="user", actor_id=actor_id, event_type="event.cancelled",
                     entity_type="grid_event", entity_id=event.id, payload={"had_changes": has_changes})
        if has_changes:
            event.ended_at = now()
            await self._restore(event, "cancelled by operator")
        else:
            for p in self.store.plans_for_event(event.id):
                if p.status == "AWAITING_APPROVAL":
                    p.status = "SUPERSEDED"
            self._set_status(event, "CANCELLED", f"Cancelled by {actor_id}")
        return event
