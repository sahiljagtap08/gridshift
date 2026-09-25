from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel

from app.models import Action, Workload


class ValidationResult(BaseModel):
    ok: bool
    reason: str | None = None


class ActionResult(BaseModel):
    action_id: str
    ok: bool
    workload_id: str
    new_state: str
    new_power_mw: float
    message: str


class SchedulerAdapter(Protocol):
    """Scheduler-independent actuation interface (spec section 15)."""

    async def discover_workloads(self) -> list[Workload]: ...

    async def get_workload(self, workload_id: str) -> Workload: ...

    async def validate_action(self, action: Action) -> ValidationResult: ...

    async def execute_action(self, action: Action) -> ActionResult: ...

    async def rollback_action(self, action: Action) -> ActionResult: ...

    async def restore(self, event_id: str) -> list[ActionResult]: ...
