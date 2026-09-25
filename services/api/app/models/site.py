from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class Site(BaseModel):
    id: str
    organization_id: str = "org_demo"
    name: str
    region: str
    facility_power_capacity_mw: float
    pue: float = Field(default=1.0, description="facility = IT * PUE; a visible demo assumption, not a constant")
    created_at: datetime


class Cluster(BaseModel):
    id: str
    site_id: str
    name: str
    adapter_type: Literal["mock", "kubernetes"] = "mock"
    observe_enabled: bool = True
    actuation_enabled: bool = False
    status: Literal["connected", "disconnected", "error"] = "connected"
    capabilities: list[str] = Field(default_factory=lambda: ["discover", "telemetry"])
    last_seen_at: datetime | None = None
    created_at: datetime


class SimulationRun(BaseModel):
    id: str
    policy_version_id: str
    site_id: str
    scenario: str
    input_snapshot: dict
    plan: dict | None
    result_status: Literal["FEASIBLE", "CONDITIONALLY_FEASIBLE", "INFEASIBLE"]
    baseline_mw: float
    target_reduction_mw: float
    expected_reduction_mw: float
    critical_workloads_affected: int
    flexible_workloads_modified: int
    constraints_respected: list[str]
    risks: list[str]
    failure_conditions: list[str]
    sensitivity: list[dict]
    created_at: datetime
