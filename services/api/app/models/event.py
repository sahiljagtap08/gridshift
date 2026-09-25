from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from .workload import ActionType

EventStatus = Literal[
    "RECEIVED",
    "PLANNING",
    "AWAITING_APPROVAL",
    "EXECUTING",
    "VERIFYING",
    "TARGET_MET",
    "PARTIAL_EXECUTION",
    "RESTORING",
    "COMPLETED",
    "CANCELLED",
    "FAILED",
    "REQUIRES_OPERATOR",
    "BLOCKED",
]

PlanStatus = Literal["DRAFT", "AWAITING_APPROVAL", "APPROVED", "REJECTED", "EXECUTED", "SUPERSEDED", "INFEASIBLE"]
ActionStatus = Literal["PENDING", "EXECUTING", "SUCCEEDED", "FAILED", "RESTORED"]


class EventTarget(BaseModel):
    type: Literal["percent", "mw"]
    value: float


class GridEvent(BaseModel):
    id: str
    site_id: str
    cluster_id: str
    policy_version_id: str
    source: Literal["demo", "csp", "utility", "manual"] = "demo"
    external_event_id: str | None = None

    target: EventTarget
    baseline_mw: float = Field(description="Facility load snapshot taken at event receipt (DEMO_PRE_EVENT_SNAPSHOT)")
    target_reduction_mw: float
    duration_minutes: int
    response_time_minutes: int

    status: EventStatus = "RECEIVED"
    active_plan_id: str | None = None
    plan_ids: list[str] = Field(default_factory=list)
    verification_id: str | None = None

    simulate_under_delivery: bool = False
    received_at: datetime
    started_at: datetime | None = None
    target_met_at: datetime | None = None
    ended_at: datetime | None = None
    completed_at: datetime | None = None
    failure_reason: str | None = None


class Action(BaseModel):
    id: str
    action_plan_id: str
    workload_id: str
    workload_name: str
    action_type: ActionType
    parameters: dict[str, Any] = Field(default_factory=dict)
    expected_reduction_mw: float
    reason: str
    user_impact: str
    recovery: str
    status: ActionStatus = "PENDING"
    executed_at: datetime | None = None
    restored_at: datetime | None = None
    result: dict[str, Any] | None = None


class ActionPlan(BaseModel):
    id: str
    grid_event_id: str
    round: int = Field(description="1 for the initial plan, 2+ for shortfall replans")
    workload_snapshot_hash: str
    workload_snapshot: dict[str, int] = Field(description="workload_id -> generation at planning time")
    target_reduction_mw: float = Field(description="What this plan must deliver (the gap for replans)")
    expected_reduction_mw: float
    disruption_score: float
    status: PlanStatus
    actions: list[Action]
    protected_workload_ids: list[str]
    exclusions: list[dict[str, str]] = Field(default_factory=list, description="Workload/action pairs ruled out and why")
    infeasible_reason: str | None = None
    created_at: datetime


class Approval(BaseModel):
    id: str
    action_plan_id: str
    plan_hash: str
    user_id: str
    decision: Literal["approve", "reject"]
    comment: str | None = None
    created_at: datetime


class TelemetrySample(BaseModel):
    site_id: str
    cluster_id: str
    it_power_mw: float
    facility_power_mw: float
    timestamp: datetime
    per_workload_mw: dict[str, float]


class VerificationRecord(BaseModel):
    id: str
    grid_event_id: str
    baseline_method: str
    baseline_mw: float
    actual_mw: float | None
    target_reduction_mw: float
    expected_reduction_mw: float
    verified_reduction_mw: float | None
    target_met: bool | None
    status: Literal["VERIFIED", "UNVERIFIED"]
    critical_workloads_impacted: int
    deadline_misses: int
    actions_executed: int
    calculation: dict[str, Any]
    created_at: datetime


class TimelineEntry(BaseModel):
    at: datetime
    event_id: str
    kind: str
    message: str
    data: dict[str, Any] = Field(default_factory=dict)


class AuditEvent(BaseModel):
    id: str
    organization_id: str = "org_demo"
    actor_type: Literal["user", "system", "foundry"]
    actor_id: str
    event_type: str
    entity_type: str
    entity_id: str
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
