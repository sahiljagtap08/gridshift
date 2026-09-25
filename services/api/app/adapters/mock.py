"""Mock scheduler adapter: a coherent, seeded simulator of an AI cluster.

Demo power model (spec 21.3), explicitly an assumption:
    running            = 100% of nominal
    throttle p         = (1 - p) * nominal
    suspended          = 5% residual (control plane, memory, idle GPUs)
    deferred / queued  = 0

After an action the *actual* reduction differs slightly from the estimate
(seeded noise, spec 21.4). The under-delivery toggle makes the first plan land
at ~85% of expectation so the closed loop has something to correct.
"""

from __future__ import annotations

import asyncio
import random

from app.adapters.base import ActionResult, ValidationResult
from app.core.store import Store, now
from app.models import Action, Workload

SUSPEND_RESIDUAL = 0.05
POWER_MODEL_NOTE = "running=100%, throttle p=(1-p), suspended=5% residual, deferred=0. Demo assumption."


def power_for(workload: Workload, state: str, throttle_percent: float = 0.0) -> float:
    if state == "running":
        return workload.nominal_power_mw
    if state == "throttled":
        return workload.nominal_power_mw * (1.0 - throttle_percent)
    if state == "suspended":
        return workload.nominal_power_mw * SUSPEND_RESIDUAL
    if state in ("deferred", "queued"):
        return 0.0
    raise ValueError(f"unknown state {state}")


def estimate_reduction(workload: Workload, action_type: str, throttle_percent: float = 0.0) -> float:
    """Expected MW saved by applying `action_type` to a workload in its current state."""
    current = workload.current_power_mw
    if action_type == "throttle":
        target = power_for(workload, "throttled", throttle_percent)
    elif action_type == "suspend":
        target = power_for(workload, "suspended")
    elif action_type == "defer":
        target = power_for(workload, "deferred")
    else:
        return 0.0
    return max(current - target, 0.0)


class MockAdapter:
    def __init__(
        self,
        store: Store,
        cluster_id: str,
        *,
        seed: int = 42,
        action_latency_seconds: float = 0.0,
        fail_workload_ids: set[str] | None = None,
    ) -> None:
        self.store = store
        self.cluster_id = cluster_id
        self.rng = random.Random(seed)
        self.action_latency_seconds = action_latency_seconds
        self.fail_workload_ids = fail_workload_ids or set()
        self.under_delivery = False
        self._under_delivery_used = False
        # noise multiplier applied to the modeled reduction per workload after an action
        self._response_factor: dict[str, float] = {}

    # ---- observation -------------------------------------------------

    async def discover_workloads(self) -> list[Workload]:
        return self.store.workloads_for_cluster(self.cluster_id)

    async def get_workload(self, workload_id: str) -> Workload:
        return self.store.workloads[workload_id]

    def it_power_mw(self) -> float:
        return sum(w.current_power_mw for w in self.store.workloads_for_cluster(self.cluster_id))

    def sample_noise(self) -> float:
        """Small telemetry jitter, +-0.5%."""
        return self.rng.uniform(-0.005, 0.005)

    # ---- actuation ---------------------------------------------------

    async def validate_action(self, action: Action) -> ValidationResult:
        w = self.store.workloads.get(action.workload_id)
        if w is None:
            return ValidationResult(ok=False, reason="workload not found")
        if w.protected:
            return ValidationResult(ok=False, reason="workload is protected")
        if action.action_type not in w.allowed_actions:
            return ValidationResult(ok=False, reason=f"{action.action_type} not allowed for {w.id}")
        return ValidationResult(ok=True)

    async def execute_action(self, action: Action) -> ActionResult:
        if self.action_latency_seconds:
            await asyncio.sleep(self.action_latency_seconds)
        w = self.store.workloads[action.workload_id]
        if action.workload_id in self.fail_workload_ids:
            return ActionResult(
                action_id=action.id, ok=False, workload_id=w.id, new_state=w.state,
                new_power_mw=w.current_power_mw, message="scheduler rejected the action (injected failure)",
            )

        if action.action_type == "throttle":
            pct = float(action.parameters.get("throttle_percent", 0.1))
            new_state, modeled = "throttled", power_for(w, "throttled", pct)
            w.throttle_percent = pct
        elif action.action_type == "suspend":
            new_state, modeled = "suspended", power_for(w, "suspended")
        elif action.action_type == "defer":
            new_state, modeled = "deferred", power_for(w, "deferred")
        else:
            return ActionResult(action_id=action.id, ok=False, workload_id=w.id, new_state=w.state,
                                new_power_mw=w.current_power_mw, message="no-op action")

        # Actual response differs from the model: seeded noise, optional under-delivery on first plan.
        factor = self.rng.uniform(0.94, 1.02)
        if self.under_delivery and not self._under_delivery_used:
            factor = 0.85
        modeled_reduction = w.current_power_mw - modeled
        actual_power = w.current_power_mw - modeled_reduction * factor
        self._response_factor[w.id] = factor

        w.state = new_state
        w.current_power_mw = round(actual_power, 4)
        w.generation += 1
        w.last_seen_at = now()
        return ActionResult(
            action_id=action.id, ok=True, workload_id=w.id, new_state=new_state,
            new_power_mw=w.current_power_mw, message=f"{action.action_type} applied via mock scheduler",
        )

    def mark_plan_executed(self) -> None:
        """Called by the orchestrator after a plan round so under-delivery only hits the first round."""
        if self.under_delivery:
            self._under_delivery_used = True

    async def rollback_action(self, action: Action) -> ActionResult:
        return await self._restore_workload(action)

    async def _restore_workload(self, action: Action) -> ActionResult:
        if self.action_latency_seconds:
            await asyncio.sleep(self.action_latency_seconds)
        w = self.store.workloads[action.workload_id]
        w.state = "running"
        w.throttle_percent = 0.0
        w.current_power_mw = w.nominal_power_mw
        w.generation += 1
        w.last_seen_at = now()
        return ActionResult(action_id=action.id, ok=True, workload_id=w.id, new_state="running",
                            new_power_mw=w.current_power_mw, message="restored to running")

    async def restore(self, event_id: str) -> list[ActionResult]:
        results = []
        for plan in self.store.plans_for_event(event_id):
            for action in plan.actions:
                if action.status == "SUCCEEDED":
                    results.append(await self._restore_workload(action))
        return results
