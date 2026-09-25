from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.audit import record_audit
from app.core.deps import get_orchestrator
from app.core.seed import seed_demo
from app.core.store import Store, get_store, now
from app.models import Cluster, FlexibilityUpdate
from app.services.orchestrator import Orchestrator

router = APIRouter(tags=["clusters", "workloads"])


class CreateClusterRequest(BaseModel):
    site_id: str
    name: str
    adapter_type: Literal["mock", "kubernetes"] = "mock"
    observe_enabled: bool = True
    actuation_enabled: bool = False


class PermissionsRequest(BaseModel):
    observe_enabled: bool | None = None
    actuation_enabled: bool | None = None


@router.get("/sites")
async def list_sites(store: Store = Depends(get_store)):
    return list(store.sites.values())


@router.get("/clusters")
async def list_clusters(store: Store = Depends(get_store)):
    return list(store.clusters.values())


@router.post("/clusters", status_code=201)
async def create_cluster(body: CreateClusterRequest, store: Store = Depends(get_store)):
    if body.site_id not in store.sites:
        raise HTTPException(404, "site not found")
    if body.adapter_type != "mock":
        raise HTTPException(422, "only the mock adapter is available in this build")
    c = Cluster(id=store.new_id("clu"), site_id=body.site_id, name=body.name, adapter_type=body.adapter_type,
                observe_enabled=body.observe_enabled, actuation_enabled=body.actuation_enabled,
                status="connected", last_seen_at=now(), created_at=now())
    store.clusters[c.id] = c
    record_audit(store, actor_type="user", actor_id="operator_demo", event_type="cluster.created",
                 entity_type="cluster", entity_id=c.id, payload=body.model_dump())
    return c


@router.get("/clusters/{cluster_id}")
async def get_cluster(cluster_id: str, store: Store = Depends(get_store)):
    c = store.clusters.get(cluster_id)
    if c is None:
        raise HTTPException(404, "cluster not found")
    return c


@router.patch("/clusters/{cluster_id}/permissions")
async def patch_permissions(cluster_id: str, body: PermissionsRequest, store: Store = Depends(get_store)):
    c = store.clusters.get(cluster_id)
    if c is None:
        raise HTTPException(404, "cluster not found")
    if body.observe_enabled is not None:
        c.observe_enabled = body.observe_enabled
    if body.actuation_enabled is not None:
        c.actuation_enabled = body.actuation_enabled
    c.capabilities = ["discover", "telemetry"] + (["actuate"] if c.actuation_enabled else [])
    record_audit(store, actor_type="user", actor_id="operator_demo", event_type="cluster.permissions_changed",
                 entity_type="cluster", entity_id=c.id, payload=body.model_dump(exclude_none=True))
    return c


@router.post("/clusters/{cluster_id}/sync")
async def sync_cluster(cluster_id: str, orch: Orchestrator = Depends(get_orchestrator), store: Store = Depends(get_store)):
    if cluster_id not in store.clusters:
        raise HTTPException(404, "cluster not found")
    workloads = await orch.adapter_for(cluster_id).discover_workloads()
    store.clusters[cluster_id].last_seen_at = now()
    return {"discovered": len(workloads), "workloads": workloads}


@router.get("/clusters/{cluster_id}/workloads")
async def list_workloads(cluster_id: str, store: Store = Depends(get_store)):
    if cluster_id not in store.clusters:
        raise HTTPException(404, "cluster not found")
    return store.workloads_for_cluster(cluster_id)


@router.get("/workloads")
async def list_all_workloads(store: Store = Depends(get_store)):
    return list(store.workloads.values())


@router.patch("/workloads/{workload_id}/flexibility")
async def patch_flexibility(workload_id: str, body: FlexibilityUpdate, store: Store = Depends(get_store)):
    w = store.workloads.get(workload_id)
    if w is None:
        raise HTTPException(404, "workload not found")
    changes = body.model_dump(exclude_none=True)
    for k, v in changes.items():
        setattr(w, k, v)
    if w.protected:
        w.allowed_actions = ["none"]
    w.generation += 1  # invalidates any plan built on the old snapshot (INV-8)
    record_audit(store, actor_type="user", actor_id="operator_demo", event_type="workload.flexibility_changed",
                 entity_type="workload", entity_id=w.id, payload=changes)
    return w


@router.get("/telemetry")
async def telemetry(site_id: str = "site_demo", limit: int = 180, store: Store = Depends(get_store)):
    return store.recent_telemetry(site_id, limit=limit)


@router.get("/overview")
async def overview(site_id: str = "site_demo", store: Store = Depends(get_store),
                   orch: Orchestrator = Depends(get_orchestrator)):
    site = store.sites.get(site_id)
    if site is None:
        raise HTTPException(404, "site not found")
    clusters = [c for c in store.clusters.values() if c.site_id == site_id]
    workloads = [w for c in clusters for w in store.workloads_for_cluster(c.id)]
    protected = sum(w.current_power_mw for w in workloads if w.protected)
    flexible = sum(w.current_power_mw for w in workloads if not w.protected)
    active = next((e for e in reversed(list(store.events.values()))
                   if e.site_id == site_id and e.status not in ("COMPLETED", "CANCELLED", "FAILED")), None)
    last = next((e for e in reversed(list(store.events.values())) if e.site_id == site_id and e.status == "COMPLETED"), None)
    active_policy = next((pv for pv in store.policy_versions.values() if pv.status == "ACTIVE"), None)
    return {
        "site": site,
        "current_load_mw": round(orch.current_facility_mw(site_id), 3),
        "it_load_mw": round(sum(w.current_power_mw for w in workloads), 3),
        "protected_load_mw": round(protected, 3),
        "flexible_load_mw": round(flexible, 3),
        "workload_count": len(workloads),
        "clusters": clusters,
        "active_event": active,
        "last_completed_event": last,
        "last_verification": store.verifications.get(last.verification_id) if last and last.verification_id else None,
        "active_policy_version": active_policy,
        "active_policy": store.policies.get(active_policy.policy_id) if active_policy else None,
    }


@router.post("/demo/reset")
async def reset_demo(store: Store = Depends(get_store), orch: Orchestrator = Depends(get_orchestrator)):
    orch.reset()
    seed_demo(store)
    orch.start_telemetry()
    return {"status": "reset", "workloads": len(store.workloads)}


@router.get("/audit")
async def audit_log(limit: int = 200, store: Store = Depends(get_store)):
    return list(reversed(store.audit[-limit:]))
