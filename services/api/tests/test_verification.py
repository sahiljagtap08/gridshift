import pytest

from app.core.seed import CLUSTER_ID, seed_demo
from app.core.store import Store, now
from app.models import TelemetrySample
from app.services.verification import compute_verification


def sample(mw: float) -> TelemetrySample:
    return TelemetrySample(site_id="site_demo", cluster_id=CLUSTER_ID, it_power_mw=mw, facility_power_mw=mw,
                           timestamp=now(), per_workload_mw={})


@pytest.fixture
def workloads():
    s = Store()
    seed_demo(s)
    return s.workloads_for_cluster(CLUSTER_ID)


def test_baseline_minus_actual(workloads):
    rec = compute_verification(record_id="ver_1", event_id="evt_1", baseline_mw=12.6, target_reduction_mw=1.26,
                               plans=[], samples=[sample(10.9)] * 5, workloads=workloads)
    assert rec.status == "VERIFIED"
    assert rec.verified_reduction_mw == pytest.approx(1.7)
    assert rec.target_met is True


def test_shortfall_is_not_target_met(workloads):
    rec = compute_verification(record_id="ver_1", event_id="evt_1", baseline_mw=12.6, target_reduction_mw=1.26,
                               plans=[], samples=[sample(11.5)] * 5, workloads=workloads)
    assert rec.verified_reduction_mw == pytest.approx(1.1)
    assert rec.target_met is False


def test_missing_telemetry_is_unverified(workloads):
    rec = compute_verification(record_id="ver_1", event_id="evt_1", baseline_mw=12.6, target_reduction_mw=1.26,
                               plans=[], samples=[], workloads=workloads)
    assert rec.status == "UNVERIFIED"
    assert rec.target_met is None
    assert rec.verified_reduction_mw is None
