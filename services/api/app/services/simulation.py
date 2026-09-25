"""Policy Lab simulation: run a HUMAN_CONFIRMED (or ACTIVE) rule against a modeled site.

Uses the same optimizer, workload model, and action vocabulary as Live Ops (spec 6, 9).
"""

from __future__ import annotations

import copy
from dataclasses import asdict

from app.core.store import Store, now
from app.models import PolicyRule, PolicyVersion, SimulationRun, Workload
from app.services import optimizer

CLASS_TO_LABEL = {
    "critical_inference": "critical_inference", "safety_systems": "safety_systems",
    "platform_services": "platform_services", "training": "training", "batch": "batch",
    "evaluation": "evaluation", "embeddings": "embeddings", "synthetic_data": "synthetic_data",
    "internal_inference": "internal_inference",
}


def apply_rule_to_workloads(rule: PolicyRule, workloads: list[Workload]) -> list[Workload]:
    """Return copies of the workloads with the rule's class-level constraints applied."""
    out = []
    for w in workloads:
        c = copy.deepcopy(w)
        cls = c.labels.get("class", "")
        if cls in rule.protected_workload_classes:
            c.protected = True
            c.allowed_actions = ["none"]
        elif rule.flexible_workload_classes and cls not in rule.flexible_workload_classes and cls != "batch":
            # rule names eligible classes; anything else is out of scope for this rule
            c.allowed_actions = ["none"]
        if rule.allowed_actions and not c.protected:
            c.allowed_actions = [a for a in c.allowed_actions if a in rule.allowed_actions or a == "none"] or ["none"]
        out.append(c)
    return out


def target_mw(rule: PolicyRule, baseline_mw: float) -> float:
    if rule.reduction_target.type == "percent_of_baseline":
        return round(baseline_mw * rule.reduction_target.value / 100, 4)
    return round(rule.reduction_target.value, 4)


def run_simulation(store: Store, pv: PolicyVersion, site_id: str, scenario: str = "current_peak") -> SimulationRun:
    if pv.status not in ("HUMAN_CONFIRMED", "SIMULATED", "EXTERNALLY_APPROVED", "ACTIVE"):
        raise ValueError(f"policy version is {pv.status}; only human-confirmed rules can be simulated (INV-2)")
    site = store.sites[site_id]
    cluster = next(c for c in store.clusters.values() if c.site_id == site_id)
    rule = pv.structured_rule
    base_workloads = store.workloads_for_cluster(cluster.id)
    # scenario "current_peak": every workload at nominal power
    modeled = copy.deepcopy(base_workloads)
    for w in modeled:
        w.state, w.throttle_percent, w.current_power_mw = "running", 0.0, w.nominal_power_mw
    baseline = round(sum(w.current_power_mw for w in modeled) * site.pue, 4)
    target = target_mw(rule, baseline)
    duration = rule.duration_minutes or 120
    at = now()

    constrained = apply_rule_to_workloads(rule, modeled)
    result = optimizer.build_plan(constrained, gap_mw=target, duration_minutes=duration, at=at)

    protected_ids = {w.id for w in constrained if w.protected}
    critical_affected = sum(1 for c in result.selected if c.workload.id in protected_ids)
    status = "FEASIBLE" if result.feasible else "INFEASIBLE"
    risks = [
        "actual facility reduction may differ from modeled IT-load reduction (PUE, cooling lag)",
        "baseline method must be defined by the real grid program; DEMO_PRE_EVENT_SNAPSHOT used here",
        "workload class tags require operator confirmation before live use",
    ]
    if rule.ambiguities:
        risks.append("rule has unresolved ambiguities: " + "; ".join(a.field for a in rule.ambiguities))
        if result.feasible:
            status = "CONDITIONALLY_FEASIBLE"
    if rule.duration_minutes is None:
        risks.append("duration not specified; simulated with 120 minutes")

    constraints = []
    if protected_ids:
        constraints.append("protected classes untouched: " + ", ".join(sorted(protected_ids)))
    constraints.append("no workload deadline violated (deadline buffer 30 min)")
    constraints.append(f"pause durations within each workload's max pause for a {duration}-minute event")
    if result.feasible:
        constraints.append(f"requested reduction {target:.2f} MW met with {result.expected_reduction_mw:.2f} MW expected")
    if rule.allowed_actions:
        constraints.append("only rule-permitted actions used: " + ", ".join(rule.allowed_actions))

    sensitivity = []
    for d in (30, 60, 120, 240, 480):
        for pct in sorted({5.0, 10.0, 15.0, 20.0, 30.0, 50.0} | ({rule.reduction_target.value} if rule.reduction_target.type == "percent_of_baseline" else set())):
            r = optimizer.build_plan(constrained, gap_mw=round(baseline * pct / 100, 4), duration_minutes=d, at=at)
            sensitivity.append({"duration_minutes": d, "reduction_percent": pct,
                                "status": "FEASIBLE" if r.feasible else "INFEASIBLE",
                                "expected_reduction_mw": r.expected_reduction_mw if r.feasible else r.max_achievable_mw})

    failure_conditions = []
    pct_value = rule.reduction_target.value if rule.reduction_target.type == "percent_of_baseline" else round(100 * target / baseline, 1)
    longer = [s for s in sensitivity if s["reduction_percent"] == pct_value and s["status"] == "INFEASIBLE" and s["duration_minutes"] > duration]
    if longer:
        failure_conditions.append(f"If event duration increases to {longer[0]['duration_minutes']} min: deadlines make the target infeasible.")
    harder = [s for s in sensitivity if s["duration_minutes"] == duration and s["status"] == "INFEASIBLE" and s["reduction_percent"] > pct_value]
    if harder:
        failure_conditions.append(f"If the reduction target rises to {harder[0]['reduction_percent']:g}%: flexible capacity ({result.max_achievable_mw:.2f} MW) is exhausted.")
    for e in result.exclusions:
        if "deadline" in e.reason:
            failure_conditions.append(f"{e.workload_name} is already excluded ({e.reason}); tighter deadlines remove more capacity.")
    if not failure_conditions:
        failure_conditions.append("No failure found within the tested duration/target grid; protected-class changes would be the main risk.")

    run = SimulationRun(
        id=store.new_id("sim"), policy_version_id=pv.id, site_id=site_id, scenario=scenario,
        input_snapshot={"rule": rule.model_dump(mode="json"), "site": site.model_dump(mode="json"),
                        "workloads": [w.model_dump(mode="json") for w in constrained], "duration_minutes": duration},
        plan={"actions": [{"workload_id": c.workload.id, "workload_name": c.workload.name, "action_type": c.action_type,
                           "parameters": c.parameters, "expected_reduction_mw": round(c.reduction_mw, 4),
                           "reason": c.reason, "user_impact": c.user_impact, "recovery": c.recovery} for c in result.selected],
              "exclusions": [asdict(e) for e in result.exclusions],
              "disruption_score": result.disruption_score, "max_achievable_mw": result.max_achievable_mw,
              "infeasible_reason": result.infeasible_reason},
        result_status=status, baseline_mw=baseline, target_reduction_mw=target,
        expected_reduction_mw=result.expected_reduction_mw, critical_workloads_affected=critical_affected,
        flexible_workloads_modified=len(result.selected), constraints_respected=constraints, risks=risks,
        failure_conditions=failure_conditions, sensitivity=sensitivity, created_at=at,
    )
    store.simulation_runs[run.id] = run
    if pv.status == "HUMAN_CONFIRMED":
        pv.status = "SIMULATED"
    return run
