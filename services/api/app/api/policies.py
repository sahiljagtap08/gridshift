from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.audit import record_audit
from app.core.config import Settings, get_settings
from app.core.store import Store, get_store, now
from app.models import Policy, PolicyRule, PolicyVersion
from app.services.foundry_policy_parser import FoundryPolicyParser
from app.services.simulation import run_simulation

router = APIRouter(tags=["policy-lab"])


class CreatePolicyRequest(BaseModel):
    name: str = "Untitled policy"
    source_text: str


class ConfirmRequest(BaseModel):
    structured_rule: PolicyRule
    confirmed_by: str = "analyst_demo"


class PublishRequest(BaseModel):
    external_reference: str = "DEMO-EXTERNAL-APPROVAL"
    published_by: str = "admin_demo"


class SimulationRequest(BaseModel):
    policy_version_id: str
    site_id: str = "site_demo"
    scenario: str = "current_peak"


def _versions(store: Store, policy_id: str) -> list[PolicyVersion]:
    return sorted((v for v in store.policy_versions.values() if v.policy_id == policy_id), key=lambda v: v.version)


@router.get("/policies")
async def list_policies(store: Store = Depends(get_store)):
    return [{"policy": p, "versions": _versions(store, p.id)} for p in store.policies.values()]


@router.post("/policies", status_code=201)
async def create_policy(body: CreatePolicyRequest, store: Store = Depends(get_store)):
    if not body.source_text.strip():
        raise HTTPException(422, "source_text is required")
    p = Policy(id=store.new_id("pol"), name=body.name, source_text=body.source_text, created_at=now())
    store.policies[p.id] = p
    record_audit(store, actor_type="user", actor_id=p.created_by, event_type="policy.created",
                 entity_type="policy", entity_id=p.id, payload={"name": p.name})
    return p


@router.get("/policies/{policy_id}")
async def get_policy(policy_id: str, store: Store = Depends(get_store)):
    p = store.policies.get(policy_id)
    if p is None:
        raise HTTPException(404, "policy not found")
    return {"policy": p, "versions": _versions(store, p.id)}


@router.post("/policies/{policy_id}/interpret")
async def interpret_policy(policy_id: str, store: Store = Depends(get_store), settings: Settings = Depends(get_settings)):
    p = store.policies.get(policy_id)
    if p is None:
        raise HTTPException(404, "policy not found")
    parser = FoundryPolicyParser(settings)
    try:
        result = await parser.interpret(p.source_text)
    except Exception as exc:  # surface Foundry errors honestly instead of silently falling back
        raise HTTPException(502, f"Foundry interpretation failed: {exc}")
    version = PolicyVersion(
        id=store.new_id("polv"), policy_id=p.id, version=len(_versions(store, p.id)) + 1,
        structured_rule=result.rule, status="AI_INTERPRETED", interpretation_model=result.model,
        foundry_request_id=result.request_id, created_at=now(),
    )
    store.policy_versions[version.id] = version
    record_audit(store, actor_type="foundry", actor_id=result.model, event_type="policy.interpreted",
                 entity_type="policy_version", entity_id=version.id,
                 payload={"request_id": result.request_id, "ambiguities": [a.model_dump() for a in result.rule.ambiguities]})
    return version


@router.get("/policy-versions/{version_id}")
async def get_version(version_id: str, store: Store = Depends(get_store)):
    v = store.policy_versions.get(version_id)
    if v is None:
        raise HTTPException(404, "policy version not found")
    return v


@router.post("/policy-versions/{version_id}/confirm")
async def confirm_version(version_id: str, body: ConfirmRequest, store: Store = Depends(get_store)):
    src = store.policy_versions.get(version_id)
    if src is None:
        raise HTTPException(404, "policy version not found")
    if src.status != "AI_INTERPRETED":
        raise HTTPException(409, f"version is {src.status}; only AI_INTERPRETED versions can be confirmed")
    confirmed = PolicyVersion(
        id=store.new_id("polv"), policy_id=src.policy_id, version=len(_versions(store, src.policy_id)) + 1,
        structured_rule=body.structured_rule, status="HUMAN_CONFIRMED", interpretation_model=src.interpretation_model,
        foundry_request_id=src.foundry_request_id, confirmed_by=body.confirmed_by, confirmed_at=now(), created_at=now(),
    )
    store.policy_versions[confirmed.id] = confirmed
    edited = body.structured_rule.model_dump(mode="json") != src.structured_rule.model_dump(mode="json")
    record_audit(store, actor_type="user", actor_id=body.confirmed_by, event_type="policy.confirmed",
                 entity_type="policy_version", entity_id=confirmed.id,
                 payload={"from_version": src.id, "edited_by_human": edited})
    return confirmed


@router.post("/policy-versions/{version_id}/publish")
async def publish_version(version_id: str, body: PublishRequest, store: Store = Depends(get_store)):
    v = store.policy_versions.get(version_id)
    if v is None:
        raise HTTPException(404, "policy version not found")
    if v.status not in ("HUMAN_CONFIRMED", "SIMULATED", "EXTERNALLY_APPROVED"):
        raise HTTPException(409, f"version is {v.status}; cannot publish")
    if v.structured_rule.ambiguities:
        raise HTTPException(422, "resolve all ambiguities before publishing an operational rule")
    for other in store.policy_versions.values():
        if other.status == "ACTIVE" and other.id != v.id:
            other.status = "RETIRED"
    v.status = "ACTIVE"
    v.external_reference = body.external_reference
    record_audit(store, actor_type="user", actor_id=body.published_by, event_type="policy.published",
                 entity_type="policy_version", entity_id=v.id, payload={"external_reference": body.external_reference})
    return v


@router.get("/policy-registry")
async def registry(store: Store = Depends(get_store)):
    rows = []
    for v in sorted(store.policy_versions.values(), key=lambda x: x.created_at, reverse=True):
        rows.append({"version": v, "policy_name": store.policies[v.policy_id].name})
    return rows


@router.post("/simulations", status_code=201)
async def create_simulation(body: SimulationRequest, store: Store = Depends(get_store)):
    pv = store.policy_versions.get(body.policy_version_id)
    if pv is None:
        raise HTTPException(404, "policy version not found")
    if body.site_id not in store.sites:
        raise HTTPException(404, "site not found")
    try:
        run = run_simulation(store, pv, body.site_id, body.scenario)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    record_audit(store, actor_type="user", actor_id="analyst_demo", event_type="simulation.run",
                 entity_type="simulation_run", entity_id=run.id,
                 payload={"status": run.result_status, "expected_reduction_mw": run.expected_reduction_mw})
    return run


@router.get("/simulations")
async def list_simulations(store: Store = Depends(get_store)):
    return sorted(store.simulation_runs.values(), key=lambda r: r.created_at, reverse=True)


@router.get("/simulations/{sim_id}")
async def get_simulation(sim_id: str, store: Store = Depends(get_store)):
    run = store.simulation_runs.get(sim_id)
    if run is None:
        raise HTTPException(404, "simulation not found")
    return run
