"""Deterministic demo seed: the Virginia AI Campus, 12.6 MW (spec section 22)."""

from __future__ import annotations

from datetime import timedelta

from app.core.store import Store, now
from app.models import Cluster, Policy, PolicyRule, PolicyVersion, ReductionTarget, Site, Trigger, Workload

SITE_ID = "site_demo"
CLUSTER_ID = "cluster_demo"
POLICY_ID = "policy_demo"
POLICY_VERSION_ID = "policy_demo_v1"

DEMO_POLICY_TEXT = (
    "Reduce non-critical load by at least 10% for up to 120 minutes during a grid stress event. "
    "Do not interrupt critical customer-facing inference. Manual operator approval is required."
)


def demo_workloads(cluster_id: str = CLUSTER_ID) -> list[Workload]:
    t0 = now()
    return [
        Workload(
            id="workload_inference",
            cluster_id=cluster_id,
            name="Production inference",
            workload_type="Deployment",
            namespace="prod-inference",
            nominal_power_mw=3.2,
            current_power_mw=3.2,
            min_power_mw=3.2,
            criticality="critical",
            protected=True,
            allowed_actions=["none"],
            owner="platform",
            labels={"class": "critical_inference", "slo": "p99<200ms"},
            last_seen_at=t0,
        ),
        Workload(
            id="workload_training",
            cluster_id=cluster_id,
            name="Model training",
            workload_type="Job",
            namespace="model-training",
            nominal_power_mw=4.5,
            current_power_mw=4.5,
            criticality="medium",
            protected=False,
            checkpointable=True,
            max_pause_minutes=240,
            max_throttle_percent=0.5,
            deadline_at=t0 + timedelta(hours=14),
            allowed_actions=["throttle", "suspend"],
            owner="research",
            labels={"class": "training", "checkpoint_interval": "5m"},
            last_seen_at=t0,
        ),
        Workload(
            id="workload_embeddings",
            cluster_id=cluster_id,
            name="Embeddings refresh",
            workload_type="Job",
            namespace="ai-batch",
            nominal_power_mw=1.4,
            current_power_mw=1.4,
            criticality="low",
            protected=False,
            checkpointable=False,
            max_pause_minutes=180,
            deadline_at=t0 + timedelta(hours=6),
            allowed_actions=["defer"],
            owner="search",
            labels={"class": "embeddings"},
            last_seen_at=t0,
        ),
        Workload(
            id="workload_eval",
            cluster_id=cluster_id,
            name="Evaluation suite",
            workload_type="Job",
            namespace="ai-batch",
            nominal_power_mw=1.1,
            current_power_mw=1.1,
            criticality="low",
            protected=False,
            checkpointable=True,
            max_pause_minutes=360,
            deadline_at=t0 + timedelta(hours=9),
            allowed_actions=["suspend"],
            owner="ml-quality",
            labels={"class": "evaluation"},
            last_seen_at=t0,
        ),
        Workload(
            id="workload_synthetic",
            cluster_id=cluster_id,
            name="Synthetic data generation",
            workload_type="Job",
            namespace="ai-batch",
            nominal_power_mw=2.4,
            current_power_mw=2.4,
            criticality="low",
            protected=False,
            checkpointable=True,
            max_pause_minutes=720,
            deadline_at=t0 + timedelta(hours=12),
            allowed_actions=["suspend"],
            owner="data-platform",
            labels={"class": "synthetic_data"},
            last_seen_at=t0,
        ),
    ]


def demo_policy_rule() -> PolicyRule:
    return PolicyRule(
        reduction_target=ReductionTarget(type="percent_of_baseline", value=10),
        duration_minutes=120,
        response_time_minutes=10,
        trigger=Trigger(type="declared_grid_stress_event", description="Grid stress event declared by utility or CSP"),
        protected_workload_classes=["critical_inference"],
        flexible_workload_classes=["training", "batch", "evaluation", "embeddings", "synthetic_data"],
        allowed_actions=["suspend", "throttle", "defer"],
        operator_approval_required=True,
        ambiguities=[],
        summary="Reduce non-critical load by at least 10% for up to 120 minutes during grid stress events, protecting critical inference, with manual approval.",
    )


def seed_demo(store: Store) -> None:
    store.reset()
    t0 = now()
    store.sites[SITE_ID] = Site(
        id=SITE_ID,
        name="Virginia AI Campus",
        region="Ashburn, VA (Dominion / PJM)",
        facility_power_capacity_mw=20.0,
        pue=1.0,
        created_at=t0,
    )
    store.clusters[CLUSTER_ID] = Cluster(
        id=CLUSTER_ID,
        site_id=SITE_ID,
        name="Ashburn GPU Cluster",
        adapter_type="mock",
        observe_enabled=True,
        actuation_enabled=True,
        status="connected",
        capabilities=["discover", "telemetry", "actuate"],
        last_seen_at=t0,
        created_at=t0,
    )
    for w in demo_workloads():
        store.workloads[w.id] = w

    store.policies[POLICY_ID] = Policy(
        id=POLICY_ID,
        name="Virginia Large-Load Flex Demo",
        source_type="program",
        source_text=DEMO_POLICY_TEXT,
        created_at=t0,
    )
    store.policy_versions[POLICY_VERSION_ID] = PolicyVersion(
        id=POLICY_VERSION_ID,
        policy_id=POLICY_ID,
        version=1,
        structured_rule=demo_policy_rule(),
        status="ACTIVE",
        interpretation_model="seed",
        confirmed_by="analyst_demo",
        confirmed_at=t0,
        external_reference="DEMO-PROGRAM-2026-09",
        created_at=t0,
    )
