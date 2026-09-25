from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Criticality = Literal["critical", "high", "medium", "low"]
ActionType = Literal["suspend", "throttle", "defer", "none"]
WorkloadState = Literal["running", "throttled", "suspended", "deferred", "queued"]


class Workload(BaseModel):
    """Normalized, scheduler-independent workload contract (spec section 12.1)."""

    id: str
    cluster_id: str
    name: str
    scheduler_kind: str = "mock"
    namespace: str | None = None
    workload_type: str = "Job"

    # power (all MW)
    nominal_power_mw: float = Field(description="Power when running unconstrained")
    current_power_mw: float
    min_power_mw: float = 0.0

    # importance
    criticality: Criticality
    protected: bool

    # flexibility
    checkpointable: bool = False
    max_pause_minutes: int = 0
    max_throttle_percent: float = 0.0
    deadline_at: datetime | None = None
    allowed_actions: list[ActionType] = Field(default_factory=list)

    # runtime
    state: WorkloadState = "running"
    throttle_percent: float = 0.0
    generation: int = Field(default=1, description="Bumps on every change; used for stale-snapshot detection")

    owner: str | None = None
    labels: dict[str, str] = Field(default_factory=dict)
    last_seen_at: datetime | None = None

    @property
    def flexibility_label(self) -> str:
        if self.protected:
            return "protected"
        if "throttle" in self.allowed_actions and "suspend" in self.allowed_actions:
            return "throttle / suspend"
        if "throttle" in self.allowed_actions:
            return "throttle"
        if "suspend" in self.allowed_actions:
            return "suspend"
        if "defer" in self.allowed_actions:
            return "delay"
        return "none"


class FlexibilityUpdate(BaseModel):
    """Operator-owned flexibility settings (spec 8 step 5). Operator is the authority."""

    protected: bool | None = None
    criticality: Criticality | None = None
    checkpointable: bool | None = None
    max_pause_minutes: int | None = None
    max_throttle_percent: float | None = None
    deadline_at: datetime | None = None
    allowed_actions: list[ActionType] | None = None
    owner: str | None = None
