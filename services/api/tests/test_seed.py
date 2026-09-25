from app.core.seed import CLUSTER_ID, seed_demo
from app.core.store import Store


def test_seed_loads_demo_site_totalling_12_6_mw():
    store = Store()
    seed_demo(store)
    workloads = store.workloads_for_cluster(CLUSTER_ID)
    assert len(workloads) == 5
    assert round(sum(w.current_power_mw for w in workloads), 2) == 12.6
    protected = [w for w in workloads if w.protected]
    assert [w.id for w in protected] == ["workload_inference"]
    assert store.policy_versions["policy_demo_v1"].status == "ACTIVE"
