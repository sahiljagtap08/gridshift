"""Deterministic flexibility optimizer (spec section 14).

Not an LLM. Hard constraints are enforced in code:
  - protected workloads are never candidates (INV-1)
  - only actions in the workload's allowed_actions are legal
  - suspend/defer must fit inside max_pause_minutes and the workload deadline
  - throttle levels are capped by max_throttle_percent

Objective (minimized over subsets with at most one action per workload):
    sum(disruption_cost) + OVERSHOOT_WEIGHT * (delivered - planned_target)
subject to delivered >= planned_target, where planned_target = gap * (1 + PLANNING_MARGIN).

The candidate space is tiny (a handful of workloads, a few actions each), so an
exhaustive search is cheap and gives a provable optimum for the demo. The production
path swaps this for OR-Tools without changing the interface.
"""

from __future__ import annotations

import hashlib
import itertools
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.adapters.mock import estimate_reduction
from app.models import Action, ActionPlan, Workload

THROTTLE_LEVELS = [0.10, 0.25, 0.50]
THROTTLE_COST = {0.10: 1.0, 0.25: 1.8, 0.50: 3.0}
SUSPEND_COST_CHECKPOINTABLE = 2.0
SUSPEND_COST_LOSSY = 6.0
DEFER_COST = 1.5
CRITICALITY_MULTIPLIER = {"low": 1.0, "medium": 1.25, "high": 2.0, "critical": 100.0}
OVERSHOOT_WEIGHT = 2.0
PLANNING_MARGIN = 0.05
DEADLINE_BUFFER_MINUTES = 30


@dataclass
class Candidate:
    workload: Workload
    action_type: str
    parameters: dict
    reduction_mw: float
    cost: float
    reason: str
    user_impact: str
    recovery: str


@dataclass
class Exclusion:
    workload_id: str
    workload_name: str
    action_type: str
    reason: str


@dataclass
class PlanResult:
    feasible: bool
    planned_target_mw: float
    expected_reduction_mw: float
    disruption_score: float
    selected: list[Candidate]
    exclusions: list[Exclusion] = field(default_factory=list)
    max_achievable_mw: float = 0.0
    infeasible_reason: str | None = None


def _fits_pause(w: Workload, duration_minutes: int, at: datetime) -> str | None:
    if w.max_pause_minutes and duration_minutes > w.max_pause_minutes:
        return f"event duration {duration_minutes} min exceeds max pause {w.max_pause_minutes} min"
    if w.deadline_at is not None:
        needed = at + timedelta(minutes=duration_minutes + DEADLINE_BUFFER_MINUTES)
        if w.deadline_at < needed:
            return f"deadline {w.deadline_at.strftime('%H:%M')} UTC falls inside the event window"
    return None


def enumerate_candidates(
    workloads: list[Workload], duration_minutes: int, at: datetime
) -> tuple[list[Candidate], list[Exclusion]]:
    candidates: list[Candidate] = []
    exclusions: list[Exclusion] = []
    for w in workloads:
        if w.protected:
            exclusions.append(Exclusion(w.id, w.name, "*", "protected workload (hard gate)"))
            continue
        mult = CRITICALITY_MULTIPLIER[w.criticality]

        if "throttle" in w.allowed_actions:
            for level in THROTTLE_LEVELS:
                if level > w.max_throttle_percent + 1e-9:
                    exclusions.append(Exclusion(w.id, w.name, f"throttle {int(level*100)}%",
                                                f"exceeds max throttle {int(w.max_throttle_percent*100)}%"))
                    continue
                if level <= w.throttle_percent + 1e-9:
                    continue  # already at or beyond this level
                mw = estimate_reduction(w, "throttle", level)
                if mw <= 0:
                    continue
                candidates.append(Candidate(
                    workload=w, action_type="throttle", parameters={"throttle_percent": level},
                    reduction_mw=mw, cost=THROTTLE_COST[level] * mult,
                    reason=f"checkpointable; {'long' if w.deadline_at else 'no'} deadline; throttle to {int((1-level)*100)}%",
                    user_impact="none expected", recovery="automatic ramp",
                ))

        if "suspend" in w.allowed_actions and w.state != "suspended":
            why = _fits_pause(w, duration_minutes, at)
            if why:
                exclusions.append(Exclusion(w.id, w.name, "suspend", why))
            else:
                mw = estimate_reduction(w, "suspend")
                base = SUSPEND_COST_CHECKPOINTABLE if w.checkpointable else SUSPEND_COST_LOSSY
                candidates.append(Candidate(
                    workload=w, action_type="suspend", parameters={},
                    reduction_mw=mw, cost=base * mult,
                    reason=("checkpointable batch job; " if w.checkpointable else "non-checkpointed; progress lost; ")
                    + "no live SLO",
                    user_impact="completion delayed", recovery="resume from checkpoint" if w.checkpointable else "restart",
                ))

        if "defer" in w.allowed_actions and w.state not in ("deferred", "queued"):
            why = _fits_pause(w, duration_minutes, at)
            if why:
                exclusions.append(Exclusion(w.id, w.name, "defer", why))
            else:
                mw = estimate_reduction(w, "defer")
                candidates.append(Candidate(
                    workload=w, action_type="defer", parameters={},
                    reduction_mw=mw, cost=DEFER_COST * mult,
                    reason="queued batch work; can start after the event before its deadline",
                    user_impact="batch only", recovery="scheduled after event",
                ))
    return candidates, exclusions


def build_plan(
    workloads: list[Workload], gap_mw: float, duration_minutes: int, at: datetime | None = None
) -> PlanResult:
    at = at or datetime.now(tz=None)
    if workloads and workloads[0].deadline_at is not None and workloads[0].deadline_at.tzinfo is not None:
        at = at.astimezone(workloads[0].deadline_at.tzinfo) if at.tzinfo else at.replace(tzinfo=workloads[0].deadline_at.tzinfo)
    planned_target = round(gap_mw * (1 + PLANNING_MARGIN), 4)
    candidates, exclusions = enumerate_candidates(workloads, duration_minutes, at)

    # group by workload: at most one action per workload
    by_workload: dict[str, list[Candidate]] = {}
    for c in candidates:
        by_workload.setdefault(c.workload.id, []).append(c)
    groups = [[None, *opts] for opts in by_workload.values()]

    best: tuple[float, int, str, list[Candidate]] | None = None
    max_achievable = 0.0
    for combo in itertools.product(*groups) if groups else [()]:
        chosen = [c for c in combo if c is not None]
        total = sum(c.reduction_mw for c in chosen)
        max_achievable = max(max_achievable, total)
        if total + 1e-9 < planned_target:
            continue
        cost = sum(c.cost for c in chosen) + OVERSHOOT_WEIGHT * (total - planned_target)
        key = (round(cost, 6), len(chosen), "|".join(sorted(c.workload.id for c in chosen)))
        if best is None or key < best[:3]:
            best = (*key, chosen)

    if best is None:
        return PlanResult(
            feasible=False, planned_target_mw=planned_target, expected_reduction_mw=0.0, disruption_score=0.0,
            selected=[], exclusions=exclusions, max_achievable_mw=round(max_achievable, 4),
            infeasible_reason=f"maximum achievable reduction {max_achievable:.2f} MW is below planned target {planned_target:.2f} MW",
        )
    chosen = best[3]
    return PlanResult(
        feasible=True, planned_target_mw=planned_target,
        expected_reduction_mw=round(sum(c.reduction_mw for c in chosen), 4),
        disruption_score=round(sum(c.cost for c in chosen), 3),
        selected=chosen, exclusions=exclusions, max_achievable_mw=round(max_achievable, 4),
    )


def snapshot_hash(workloads: list[Workload]) -> tuple[str, dict[str, int]]:
    snap = {w.id: w.generation for w in sorted(workloads, key=lambda x: x.id)}
    digest = hashlib.sha256(json.dumps(snap, sort_keys=True).encode()).hexdigest()[:16]
    return digest, snap


def plan_hash(plan: ActionPlan) -> str:
    payload = [(a.workload_id, a.action_type, json.dumps(a.parameters, sort_keys=True)) for a in plan.actions]
    return hashlib.sha256(json.dumps([plan.workload_snapshot_hash, payload]).encode()).hexdigest()[:16]


def to_actions(result: PlanResult, plan_id: str, id_factory) -> list[Action]:
    return [
        Action(
            id=id_factory("act"), action_plan_id=plan_id, workload_id=c.workload.id, workload_name=c.workload.name,
            action_type=c.action_type, parameters=c.parameters, expected_reduction_mw=round(c.reduction_mw, 4),
            reason=c.reason, user_impact=c.user_impact, recovery=c.recovery,
        )
        for c in result.selected
    ]
