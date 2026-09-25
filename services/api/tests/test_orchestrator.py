import asyncio

import pytest

from app.core.bus import Bus
from app.core.config import Settings
from app.core.seed import CLUSTER_ID, POLICY_VERSION_ID, SITE_ID, seed_demo
from app.core.store import Store
from app.models import EventTarget
from app.services.orchestrator import Orchestrator, OrchestratorError


def fast_settings() -> Settings:
    return Settings(
        demo_telemetry_interval_seconds=0.01, demo_action_latency_seconds=0.0,
        demo_verify_settle_seconds=0.0, demo_event_hold_seconds=0.05, demo_restore_stage_seconds=0.0,
        _env_file=None,
    )


@pytest.fixture
def orch():
    store = Store()
    seed_demo(store)
    o = Orchestrator(store, fast_settings(), Bus())
    yield o
    o.reset()


async def wait_for(event, statuses, timeout=3.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while event.status not in statuses:
        if asyncio.get_event_loop().time() > deadline:
            raise AssertionError(f"timed out in {event.status}, wanted {statuses}")
        await asyncio.sleep(0.01)


async def test_full_loop_target_met_and_restored(orch):
    event = await orch.create_event(site_id=SITE_ID, policy_version_id=POLICY_VERSION_ID,
                                    target=EventTarget(type="percent", value=10), duration_minutes=120,
                                    response_time_minutes=10)
    assert event.status == "AWAITING_APPROVAL"
    assert event.target_reduction_mw == pytest.approx(1.26, abs=0.02)
    plan = orch.store.plans[event.active_plan_id]
    assert plan.expected_reduction_mw >= event.target_reduction_mw
    assert "workload_inference" not in {a.workload_id for a in plan.actions}

    orch.approve(plan.id, user_id="operator_demo")
    await wait_for(event, {"TARGET_MET"})
    rec = orch.store.verifications[event.verification_id]
    assert rec.status == "VERIFIED" and rec.target_met
    assert rec.verified_reduction_mw >= event.target_reduction_mw
    assert rec.critical_workloads_impacted == 0

    await wait_for(event, {"COMPLETED"})
    for w in orch.store.workloads_for_cluster(CLUSTER_ID):
        assert w.state == "running" and w.current_power_mw == w.nominal_power_mw
    kinds = [t.kind for t in orch.store.timeline_for_event(event.id)]
    assert "approved" in kinds and "restore" in kinds
    assert any(a.event_type == "action.result" for a in orch.store.audit)


async def test_under_delivery_triggers_replan_then_target_met(orch):
    event = await orch.create_event(site_id=SITE_ID, policy_version_id=POLICY_VERSION_ID,
                                    target=EventTarget(type="percent", value=10), duration_minutes=120,
                                    response_time_minutes=10, simulate_under_delivery=True)
    plan1 = orch.store.plans[event.active_plan_id]
    orch.approve(plan1.id, user_id="operator_demo")
    await wait_for(event, {"AWAITING_APPROVAL", "TARGET_MET"})
    assert event.status == "AWAITING_APPROVAL", "first round should under-deliver and require a replan"
    plan2 = orch.store.plans[event.active_plan_id]
    assert plan2.round == 2
    assert plan2.target_reduction_mw < event.target_reduction_mw  # only the gap
    orch.approve(plan2.id, user_id="operator_demo")
    await wait_for(event, {"TARGET_MET"})
    await wait_for(event, {"COMPLETED"})


async def test_stale_snapshot_invalidates_plan(orch):
    event = await orch.create_event(site_id=SITE_ID, policy_version_id=POLICY_VERSION_ID,
                                    target=EventTarget(type="percent", value=10), duration_minutes=120,
                                    response_time_minutes=10)
    plan = orch.store.plans[event.active_plan_id]
    orch.store.workloads["workload_eval"].generation += 1  # operator changed something after planning
    with pytest.raises(OrchestratorError) as exc:
        orch.approve(plan.id, user_id="operator_demo")
    assert exc.value.status_code == 409
    assert plan.status == "SUPERSEDED"
    assert event.active_plan_id == exc.value.extra["new_plan_id"]
    assert event.status == "AWAITING_APPROVAL"


async def test_non_active_policy_rejected(orch):
    orch.store.policy_versions[POLICY_VERSION_ID].status = "HUMAN_CONFIRMED"
    with pytest.raises(OrchestratorError) as exc:
        await orch.create_event(site_id=SITE_ID, policy_version_id=POLICY_VERSION_ID,
                                target=EventTarget(type="percent", value=10), duration_minutes=120,
                                response_time_minutes=10)
    assert exc.value.status_code == 422


async def test_infeasible_target_requires_operator(orch):
    event = await orch.create_event(site_id=SITE_ID, policy_version_id=POLICY_VERSION_ID,
                                    target=EventTarget(type="percent", value=70), duration_minutes=120,
                                    response_time_minutes=10)
    assert event.status == "REQUIRES_OPERATOR"
    assert orch.store.plans[event.active_plan_id].status == "INFEASIBLE"


async def test_actuation_disabled_blocks_event(orch):
    orch.store.clusters[CLUSTER_ID].actuation_enabled = False
    event = await orch.create_event(site_id=SITE_ID, policy_version_id=POLICY_VERSION_ID,
                                    target=EventTarget(type="percent", value=10), duration_minutes=120,
                                    response_time_minutes=10)
    assert event.status == "BLOCKED"


async def test_partial_execution_on_action_failure(orch):
    event = await orch.create_event(site_id=SITE_ID, policy_version_id=POLICY_VERSION_ID,
                                    target=EventTarget(type="percent", value=10), duration_minutes=120,
                                    response_time_minutes=10)
    orch.adapter_for(CLUSTER_ID).fail_workload_ids = {"workload_eval"}
    plan = orch.store.plans[event.active_plan_id]
    orch.approve(plan.id, user_id="operator_demo")
    await wait_for(event, {"AWAITING_APPROVAL", "TARGET_MET", "REQUIRES_OPERATOR"})
    statuses = {a.workload_id: a.status for a in plan.actions}
    assert statuses["workload_eval"] == "FAILED"
    assert statuses["workload_training"] == "SUCCEEDED"
    kinds = [t.kind for t in orch.store.timeline_for_event(event.id)]
    assert "action_failed" in kinds
