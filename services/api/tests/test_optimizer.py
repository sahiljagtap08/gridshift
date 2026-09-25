from datetime import timedelta

import pytest

from app.core.seed import CLUSTER_ID, seed_demo
from app.core.store import Store, now
from app.services.optimizer import build_plan


@pytest.fixture
def workloads():
    s = Store()
    seed_demo(s)
    return s.workloads_for_cluster(CLUSTER_ID)


def test_demo_plan_meets_target_without_touching_protected(workloads):
    r = build_plan(workloads, gap_mw=1.26, duration_minutes=120, at=now())
    assert r.feasible
    assert r.expected_reduction_mw >= 1.26
    ids = {c.workload.id for c in r.selected}
    assert "workload_inference" not in ids
    assert any(e.workload_id == "workload_inference" and "protected" in e.reason for e in r.exclusions)


def test_demo_plan_is_deterministic(workloads):
    t = now()
    a = build_plan(workloads, 1.26, 120, at=t)
    b = build_plan(workloads, 1.26, 120, at=t)
    assert [(c.workload.id, c.action_type, c.parameters) for c in a.selected] == \
           [(c.workload.id, c.action_type, c.parameters) for c in b.selected]


def test_demo_plan_prefers_low_disruption_pair_over_big_single_suspend(workloads):
    r = build_plan(workloads, 1.26, 120, at=now())
    chosen = {(c.workload.id, c.action_type) for c in r.selected}
    assert ("workload_training", "throttle") in chosen
    assert ("workload_eval", "suspend") in chosen
    assert r.expected_reduction_mw == pytest.approx(1.495, abs=1e-3)


def test_infeasible_when_target_exceeds_flexible_capacity(workloads):
    r = build_plan(workloads, gap_mw=9.0, duration_minutes=120, at=now())
    assert not r.feasible
    assert r.selected == []
    assert r.max_achievable_mw < 9.0
    assert "below planned target" in r.infeasible_reason


def test_deadline_inside_window_excludes_suspend(workloads):
    t = now()
    for w in workloads:
        if w.id == "workload_synthetic":
            w.deadline_at = t + timedelta(minutes=60)
    r = build_plan(workloads, 1.26, 120, at=t)
    assert not any(c.workload.id == "workload_synthetic" for c in r.selected)
    assert any(e.workload_id == "workload_synthetic" and "deadline" in e.reason for e in r.exclusions)


def test_only_allowed_actions_are_used(workloads):
    r = build_plan(workloads, 1.26, 120, at=now())
    for c in r.selected:
        assert c.action_type in c.workload.allowed_actions


def test_max_pause_respected(workloads):
    for w in workloads:
        if w.id == "workload_eval":
            w.max_pause_minutes = 60
    r = build_plan(workloads, 1.26, 120, at=now())
    assert not any(c.workload.id == "workload_eval" for c in r.selected)


def test_replan_after_partial_throttle_can_raise_throttle_level(workloads):
    for w in workloads:
        if w.id == "workload_training":
            w.state, w.throttle_percent, w.current_power_mw = "throttled", 0.10, 4.05
        if w.id == "workload_eval":
            w.state, w.current_power_mw = "suspended", 0.055
    r = build_plan(workloads, gap_mw=0.14, duration_minutes=120, at=now())
    assert r.feasible
    assert len(r.selected) == 1
    c = r.selected[0]
    assert c.workload.id == "workload_training" and c.parameters["throttle_percent"] == 0.25
