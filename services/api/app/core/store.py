"""In-memory store for the hackathon build.

Every entity is keyed by stable ID and kept in insertion order. Versioned entities
(policy versions, plans, verification records, audit events) are append-only by
convention: callers create new records instead of mutating history.
"""

from __future__ import annotations

import itertools
from datetime import datetime, timezone

from app.models import (
    Action,
    ActionPlan,
    Approval,
    AuditEvent,
    Cluster,
    GridEvent,
    Policy,
    PolicyVersion,
    SimulationRun,
    Site,
    TelemetrySample,
    TimelineEntry,
    VerificationRecord,
    Workload,
)


def now() -> datetime:
    return datetime.now(timezone.utc)


class Store:
    def __init__(self) -> None:
        self.sites: dict[str, Site] = {}
        self.clusters: dict[str, Cluster] = {}
        self.workloads: dict[str, Workload] = {}
        self.policies: dict[str, Policy] = {}
        self.policy_versions: dict[str, PolicyVersion] = {}
        self.simulation_runs: dict[str, SimulationRun] = {}
        self.events: dict[str, GridEvent] = {}
        self.plans: dict[str, ActionPlan] = {}
        self.approvals: dict[str, Approval] = {}
        self.verifications: dict[str, VerificationRecord] = {}
        self.telemetry: list[TelemetrySample] = []
        self.timeline: list[TimelineEntry] = []
        self.audit: list[AuditEvent] = []
        self._counter = itertools.count(1)

    def new_id(self, prefix: str) -> str:
        return f"{prefix}_{next(self._counter):04d}"

    def workloads_for_cluster(self, cluster_id: str) -> list[Workload]:
        return [w for w in self.workloads.values() if w.cluster_id == cluster_id]

    def actions_for_plan(self, plan_id: str) -> list[Action]:
        plan = self.plans.get(plan_id)
        return list(plan.actions) if plan else []

    def plans_for_event(self, event_id: str) -> list[ActionPlan]:
        return [p for p in self.plans.values() if p.grid_event_id == event_id]

    def timeline_for_event(self, event_id: str) -> list[TimelineEntry]:
        return [t for t in self.timeline if t.event_id == event_id]

    def recent_telemetry(self, site_id: str, limit: int = 300) -> list[TelemetrySample]:
        samples = [t for t in self.telemetry if t.site_id == site_id]
        return samples[-limit:]

    def reset(self) -> None:
        self.__init__()


_store = Store()


def get_store() -> Store:
    return _store
