from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

PolicyVersionStatus = Literal[
    "AI_INTERPRETED",
    "HUMAN_CONFIRMED",
    "SIMULATED",
    "EXTERNALLY_APPROVED",
    "ACTIVE",
    "RETIRED",
]

WorkloadClass = Literal[
    "critical_inference",
    "safety_systems",
    "platform_services",
    "training",
    "batch",
    "evaluation",
    "embeddings",
    "synthetic_data",
    "internal_inference",
]


class ReductionTarget(BaseModel):
    type: Literal["percent_of_baseline", "absolute_mw"]
    value: float


class Trigger(BaseModel):
    type: Literal[
        "declared_grid_stress_event",
        "utility_dispatch",
        "price_signal",
        "scheduled_window",
        "unspecified",
    ]
    description: str | None = None


class Ambiguity(BaseModel):
    field: str
    reason: str


class PolicyRule(BaseModel):
    """Strict structured interpretation of a demand-flexibility rule.

    This is the JSON Schema handed to Microsoft Foundry Structured Outputs.
    Missing operational values must be reported in `ambiguities`, never invented.
    """

    reduction_target: ReductionTarget
    duration_minutes: int | None = Field(default=None, description="Null if the text does not specify")
    response_time_minutes: int | None = Field(default=None, description="Null if the text does not specify")
    trigger: Trigger
    protected_workload_classes: list[WorkloadClass] = Field(default_factory=list)
    flexible_workload_classes: list[WorkloadClass] = Field(default_factory=list)
    allowed_actions: list[Literal["suspend", "throttle", "defer"]] = Field(default_factory=list)
    operator_approval_required: bool = True
    ambiguities: list[Ambiguity] = Field(default_factory=list)
    summary: str = Field(description="One sentence restating the rule as interpreted")


class Policy(BaseModel):
    id: str
    organization_id: str = "org_demo"
    name: str
    source_type: Literal["text", "program"] = "text"
    source_text: str
    created_by: str = "analyst_demo"
    created_at: datetime


class PolicyVersion(BaseModel):
    """Never overwritten in place. Each interpretation/confirmation is a new version."""

    id: str
    policy_id: str
    version: int
    structured_rule: PolicyRule
    status: PolicyVersionStatus
    interpretation_model: str
    foundry_trace_id: str | None = None
    foundry_request_id: str | None = None
    confirmed_by: str | None = None
    confirmed_at: datetime | None = None
    external_reference: str | None = None
    created_at: datetime
