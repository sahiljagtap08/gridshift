import pytest
from httpx import ASGITransport, AsyncClient

from app.core.seed import seed_demo
from app.core.store import Store
from app.main import app
from app.services.foundry_policy_parser import fallback_interpret
from app.services.simulation import run_simulation

EXAMPLE = ("During declared grid stress events, participating large-load customers should reduce non-critical "
           "electricity demand by 15% for up to two hours while protecting critical customer-facing services.")


def test_fallback_extracts_fields_and_flags_missing_response_time():
    r = fallback_interpret(EXAMPLE)
    rule = r.rule
    assert rule.reduction_target.type == "percent_of_baseline" and rule.reduction_target.value == 15
    assert rule.duration_minutes == 120
    assert rule.trigger.type == "declared_grid_stress_event"
    assert "critical_inference" in rule.protected_workload_classes
    assert rule.operator_approval_required is True
    assert any(a.field == "response_time_minutes" for a in rule.ambiguities)
    assert "fallback" in r.model


def test_fallback_never_invents_duration():
    r = fallback_interpret("Cut load by 2 MW when the utility requests it.")
    assert r.rule.duration_minutes is None
    assert r.rule.reduction_target.type == "absolute_mw"
    assert any(a.field == "duration_minutes" for a in r.rule.ambiguities)


def test_simulation_blocks_unconfirmed_rule():
    store = Store()
    seed_demo(store)
    pv = store.policy_versions["policy_demo_v1"]
    pv.status = "AI_INTERPRETED"
    with pytest.raises(ValueError):
        run_simulation(store, pv, "site_demo")


def test_simulation_of_active_demo_rule_is_feasible():
    store = Store()
    seed_demo(store)
    run = run_simulation(store, store.policy_versions["policy_demo_v1"], "site_demo")
    assert run.result_status == "FEASIBLE"
    assert run.baseline_mw == pytest.approx(12.6)
    assert run.target_reduction_mw == pytest.approx(1.26)
    assert run.expected_reduction_mw >= 1.26
    assert run.critical_workloads_affected == 0
    assert any(s["status"] == "INFEASIBLE" for s in run.sensitivity)
    assert run.failure_conditions


@pytest.fixture
async def client():
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test/api/v1") as c:
            yield c


async def test_policy_lab_flow_via_api(client):
    p = (await client.post("/policies", json={"name": "Draft 15% / 2h", "source_text": EXAMPLE})).json()
    v1 = (await client.post(f"/policies/{p['id']}/interpret")).json()
    assert v1["status"] == "AI_INTERPRETED"

    # cannot simulate an AI_INTERPRETED version (INV-2)
    r = await client.post("/simulations", json={"policy_version_id": v1["id"]})
    assert r.status_code == 422

    rule = v1["structured_rule"]
    rule["response_time_minutes"] = 10
    rule["ambiguities"] = []
    v2 = (await client.post(f"/policy-versions/{v1['id']}/confirm", json={"structured_rule": rule})).json()
    assert v2["status"] == "HUMAN_CONFIRMED" and v2["version"] == 2

    sim = (await client.post("/simulations", json={"policy_version_id": v2["id"]})).json()
    assert sim["result_status"] == "FEASIBLE"
    assert sim["target_reduction_mw"] == pytest.approx(1.89, abs=0.01)
    assert sim["plan"]["actions"]

    pub = (await client.post(f"/policy-versions/{v2['id']}/publish", json={"external_reference": "SCC-2027-01"})).json()
    assert pub["status"] == "ACTIVE"
    reg = (await client.get("/policy-registry")).json()
    statuses = {row["version"]["id"]: row["version"]["status"] for row in reg}
    assert statuses[v2["id"]] == "ACTIVE" and statuses["policy_demo_v1"] == "RETIRED"
