import pytest

from app.adapters.mock import MockAdapter, estimate_reduction, power_for
from app.core.seed import CLUSTER_ID, seed_demo
from app.core.store import Store, now
from app.models import Action


@pytest.fixture
def store():
    s = Store()
    seed_demo(s)
    return s


def make_action(workload_id: str, action_type: str, **params) -> Action:
    return Action(
        id="act_test", action_plan_id="plan_test", workload_id=workload_id, workload_name=workload_id,
        action_type=action_type, parameters=params, expected_reduction_mw=0.0,
        reason="test", user_impact="none", recovery="resume",
    )


def test_power_model_table(store):
    training = store.workloads["workload_training"]
    assert power_for(training, "running") == 4.5
    assert power_for(training, "throttled", 0.10) == pytest.approx(4.05)
    assert power_for(training, "suspended") == pytest.approx(0.225)
    assert power_for(training, "deferred") == 0.0


def test_estimate_reduction_matches_demo_numbers(store):
    assert estimate_reduction(store.workloads["workload_training"], "throttle", 0.10) == pytest.approx(0.45)
    assert estimate_reduction(store.workloads["workload_eval"], "suspend") == pytest.approx(1.045)
    assert estimate_reduction(store.workloads["workload_synthetic"], "suspend") == pytest.approx(2.28)
    assert estimate_reduction(store.workloads["workload_embeddings"], "defer") == pytest.approx(1.4)


async def test_execute_is_seeded_and_deterministic():
    results = []
    for _ in range(2):
        s = Store()
        seed_demo(s)
        adapter = MockAdapter(s, CLUSTER_ID, seed=42)
        r = await adapter.execute_action(make_action("workload_eval", "suspend"))
        results.append(r.new_power_mw)
    assert results[0] == results[1]
    assert 0.0 < results[0] < 1.1


async def test_execute_rejects_protected(store):
    adapter = MockAdapter(store, CLUSTER_ID)
    v = await adapter.validate_action(make_action("workload_inference", "suspend"))
    assert not v.ok


async def test_under_delivery_hits_first_round_only(store):
    adapter = MockAdapter(store, CLUSTER_ID, seed=42)
    adapter.under_delivery = True
    r1 = await adapter.execute_action(make_action("workload_synthetic", "suspend"))
    expected = 2.4 - 0.12
    assert (2.4 - r1.new_power_mw) == pytest.approx(expected * 0.75, rel=1e-3)
    adapter.mark_plan_executed()
    r2 = await adapter.execute_action(make_action("workload_eval", "suspend"))
    assert (1.1 - r2.new_power_mw) > 1.045 * 0.9


async def test_restore_returns_to_nominal(store):
    adapter = MockAdapter(store, CLUSTER_ID)
    await adapter.execute_action(make_action("workload_eval", "suspend"))
    await adapter.rollback_action(make_action("workload_eval", "suspend"))
    w = store.workloads["workload_eval"]
    assert w.state == "running" and w.current_power_mw == 1.1


async def test_failure_injection(store):
    adapter = MockAdapter(store, CLUSTER_ID, fail_workload_ids={"workload_eval"})
    r = await adapter.execute_action(make_action("workload_eval", "suspend"))
    assert not r.ok
    assert store.workloads["workload_eval"].state == "running"
