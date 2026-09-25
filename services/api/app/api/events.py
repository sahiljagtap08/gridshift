from __future__ import annotations

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app.core.bus import Bus, dumps, get_bus
from app.core.deps import get_orchestrator
from app.core.store import Store, get_store
from app.models import EventTarget
from app.services.orchestrator import Orchestrator, OrchestratorError

router = APIRouter(tags=["events"])

_idempotency: dict[str, Any] = {}


class CreateEventRequest(BaseModel):
    site_id: str = "site_demo"
    policy_version_id: str = "policy_demo_v1"
    source: Literal["demo", "csp", "utility", "manual"] = "demo"
    target: EventTarget = Field(default_factory=lambda: EventTarget(type="percent", value=10))
    duration_minutes: int = 120
    response_time_minutes: int = 10
    simulate_under_delivery: bool = False


class DecisionRequest(BaseModel):
    user_id: str = "operator_demo"
    comment: str | None = None


def _raise(err: OrchestratorError) -> None:
    raise HTTPException(status_code=err.status_code, detail={"message": err.detail, **err.extra})


def event_detail(store: Store, event_id: str) -> dict:
    event = store.events.get(event_id)
    if event is None:
        raise HTTPException(404, "event not found")
    plans = store.plans_for_event(event_id)
    verification = store.verifications.get(event.verification_id) if event.verification_id else None
    approvals = [a for a in store.approvals.values() if a.action_plan_id in {p.id for p in plans}]
    return {
        "event": event,
        "plans": plans,
        "active_plan": store.plans.get(event.active_plan_id) if event.active_plan_id else None,
        "verification": verification,
        "approvals": approvals,
        "timeline": store.timeline_for_event(event_id),
        "policy_version": store.policy_versions.get(event.policy_version_id),
        "workloads": store.workloads_for_cluster(event.cluster_id),
    }


@router.post("/events", status_code=201)
async def create_event(
    body: CreateEventRequest,
    orch: Orchestrator = Depends(get_orchestrator),
    store: Store = Depends(get_store),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    if idempotency_key and idempotency_key in _idempotency:
        return _idempotency[idempotency_key]
    try:
        event = await orch.create_event(
            site_id=body.site_id, policy_version_id=body.policy_version_id, target=body.target,
            duration_minutes=body.duration_minutes, response_time_minutes=body.response_time_minutes,
            source=body.source, simulate_under_delivery=body.simulate_under_delivery,
        )
    except OrchestratorError as err:
        _raise(err)
    detail = event_detail(store, event.id)
    if idempotency_key:
        _idempotency[idempotency_key] = detail
    return detail


@router.get("/events")
async def list_events(store: Store = Depends(get_store)):
    return sorted(store.events.values(), key=lambda e: e.received_at, reverse=True)


@router.get("/events/{event_id}")
async def get_event(event_id: str, store: Store = Depends(get_store)):
    return event_detail(store, event_id)


@router.get("/plans/{plan_id}")
async def get_plan(plan_id: str, store: Store = Depends(get_store)):
    plan = store.plans.get(plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    return plan


@router.post("/plans/{plan_id}/approve")
async def approve_plan(
    plan_id: str, body: DecisionRequest, orch: Orchestrator = Depends(get_orchestrator),
    store: Store = Depends(get_store),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    key = f"approve:{plan_id}:{idempotency_key}" if idempotency_key else None
    if key and key in _idempotency:
        return _idempotency[key]
    try:
        plan = orch.approve(plan_id, user_id=body.user_id, comment=body.comment)
    except OrchestratorError as err:
        _raise(err)
    detail = event_detail(store, plan.grid_event_id)
    if key:
        _idempotency[key] = detail
    return detail


@router.post("/plans/{plan_id}/reject")
async def reject_plan(plan_id: str, body: DecisionRequest, orch: Orchestrator = Depends(get_orchestrator),
                      store: Store = Depends(get_store)):
    try:
        plan = orch.reject(plan_id, user_id=body.user_id, comment=body.comment)
    except OrchestratorError as err:
        _raise(err)
    return event_detail(store, plan.grid_event_id)


@router.post("/events/{event_id}/end")
async def end_event(event_id: str, body: DecisionRequest, orch: Orchestrator = Depends(get_orchestrator),
                    store: Store = Depends(get_store)):
    try:
        await orch.end_event(event_id, actor_id=body.user_id, reason=body.comment or "ended by operator")
    except OrchestratorError as err:
        _raise(err)
    return event_detail(store, event_id)


@router.post("/events/{event_id}/cancel")
async def cancel_event(event_id: str, body: DecisionRequest, orch: Orchestrator = Depends(get_orchestrator),
                       store: Store = Depends(get_store)):
    try:
        await orch.cancel(event_id, actor_id=body.user_id)
    except OrchestratorError as err:
        _raise(err)
    return event_detail(store, event_id)


@router.get("/events/{event_id}/verification")
async def get_verification(event_id: str, store: Store = Depends(get_store)):
    event = store.events.get(event_id)
    if event is None:
        raise HTTPException(404, "event not found")
    if not event.verification_id:
        return {"status": "UNVERIFIED", "reason": "no verification has run for this event yet"}
    return store.verifications[event.verification_id]


async def _stream(request: Request, bus: Bus, event_id: str | None):
    q = bus.subscribe()
    try:
        yield {"event": "hello", "data": dumps({"type": "hello", "event_id": event_id})}
        while True:
            if await request.is_disconnected():
                break
            try:
                msg = await asyncio.wait_for(q.get(), timeout=15)
            except asyncio.TimeoutError:
                yield {"event": "ping", "data": "{}"}
                continue
            if event_id and msg.get("type") == "event" and msg.get("event_id") != event_id:
                continue
            yield {"event": msg["type"], "data": dumps(msg)}
    finally:
        bus.unsubscribe(q)


@router.get("/stream")
async def stream_all(request: Request, bus: Bus = Depends(get_bus)):
    return EventSourceResponse(_stream(request, bus, None))


@router.get("/events/{event_id}/stream")
async def stream_event(event_id: str, request: Request, bus: Bus = Depends(get_bus)):
    return EventSourceResponse(_stream(request, bus, event_id))
