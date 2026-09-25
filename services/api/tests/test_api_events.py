import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

from app.core import config, deps
from app.core.bus import Bus
from app.core.store import get_store
from app.main import app
from app.services.orchestrator import Orchestrator
from tests.test_orchestrator import fast_settings


@pytest.fixture
async def client(monkeypatch):
    deps._orchestrator = Orchestrator(get_store(), fast_settings(), Bus())
    async with app.router.lifespan_context(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test/api/v1") as c:
            yield c
    deps._orchestrator = None


async def poll(client, event_id, statuses, timeout=3.0):
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        detail = (await client.get(f"/events/{event_id}")).json()
        if detail["event"]["status"] in statuses:
            return detail
        if asyncio.get_event_loop().time() > deadline:
            raise AssertionError(f"timed out in {detail['event']['status']}")
        await asyncio.sleep(0.02)


async def test_overview_and_workloads(client):
    ov = (await client.get("/overview")).json()
    assert ov["workload_count"] == 5
    assert ov["protected_load_mw"] == pytest.approx(3.2)
    ws = (await client.get("/clusters/cluster_demo/workloads")).json()
    assert {w["id"] for w in ws} >= {"workload_inference", "workload_training"}


async def test_event_lifecycle_via_api(client):
    r = await client.post("/events", json={"target": {"type": "percent", "value": 10}}, headers={"Idempotency-Key": "k1"})
    assert r.status_code == 201, r.text
    detail = r.json()
    event_id = detail["event"]["id"]
    assert detail["event"]["status"] == "AWAITING_APPROVAL"
    plan = detail["active_plan"]
    assert plan["expected_reduction_mw"] >= detail["event"]["target_reduction_mw"]
    assert "workload_inference" in plan["protected_workload_ids"]

    # idempotent replay returns the same event
    r2 = await client.post("/events", json={"target": {"type": "percent", "value": 10}}, headers={"Idempotency-Key": "k1"})
    assert r2.json()["event"]["id"] == event_id

    r = await client.post(f"/plans/{plan['id']}/approve", json={"user_id": "operator_demo"})
    assert r.status_code == 200, r.text
    detail = await poll(client, event_id, {"TARGET_MET"})
    assert detail["verification"]["status"] == "VERIFIED"
    assert detail["verification"]["target_met"] is True
    detail = await poll(client, event_id, {"COMPLETED"})
    assert any(t["kind"] == "restore" for t in detail["timeline"])

    audit = (await client.get("/audit")).json()
    assert any(a["event_type"] == "plan.approved" for a in audit)


async def test_flexibility_change_invalidates_plan(client):
    detail = (await client.post("/events", json={})).json()
    plan_id = detail["active_plan"]["id"]
    r = await client.patch("/workloads/workload_synthetic/flexibility", json={"protected": True})
    assert r.status_code == 200 and r.json()["protected"] is True
    r = await client.post(f"/plans/{plan_id}/approve", json={})
    assert r.status_code == 409
    assert "new_plan_id" in r.json()["detail"]


async def test_reject_cancels_event(client):
    detail = (await client.post("/events", json={})).json()
    r = await client.post(f"/plans/{detail['active_plan']['id']}/reject", json={"comment": "not now"})
    assert r.json()["event"]["status"] == "CANCELLED"
