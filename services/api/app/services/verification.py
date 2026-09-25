"""Verification: baseline minus measured (spec section 16).

INV-5: success requires measured telemetry. With no samples the record is UNVERIFIED
and target_met is None, never True.
INV-7: expected and measured are separate fields, always.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.models import ActionPlan, TelemetrySample, VerificationRecord, Workload

BASELINE_METHOD = "DEMO_PRE_EVENT_SNAPSHOT"


def compute_verification(
    *,
    record_id: str,
    event_id: str,
    baseline_mw: float,
    target_reduction_mw: float,
    plans: list[ActionPlan],
    samples: list[TelemetrySample],
    workloads: list[Workload],
    window: int = 5,
) -> VerificationRecord:
    executed = [a for p in plans for a in p.actions if a.status in ("SUCCEEDED", "RESTORED")]
    expected = round(sum(a.expected_reduction_mw for a in executed), 4)
    protected_ids = {w.id for w in workloads if w.protected}
    critical_impacted = sum(1 for a in executed if a.workload_id in protected_ids)
    created = datetime.now(timezone.utc)

    if not samples:
        return VerificationRecord(
            id=record_id, grid_event_id=event_id, baseline_method=BASELINE_METHOD, baseline_mw=baseline_mw,
            actual_mw=None, target_reduction_mw=target_reduction_mw, expected_reduction_mw=expected,
            verified_reduction_mw=None, target_met=None, status="UNVERIFIED",
            critical_workloads_impacted=critical_impacted, deadline_misses=0, actions_executed=len(executed),
            calculation={"reason": "no telemetry samples available; scheduler success alone is not verification"},
            created_at=created,
        )

    recent = samples[-window:]
    actual = round(sum(s.facility_power_mw for s in recent) / len(recent), 4)
    verified = round(baseline_mw - actual, 4)
    target_met = verified + 1e-9 >= target_reduction_mw
    return VerificationRecord(
        id=record_id, grid_event_id=event_id, baseline_method=BASELINE_METHOD, baseline_mw=baseline_mw,
        actual_mw=actual, target_reduction_mw=target_reduction_mw, expected_reduction_mw=expected,
        verified_reduction_mw=verified, target_met=target_met, status="VERIFIED",
        critical_workloads_impacted=critical_impacted, deadline_misses=0, actions_executed=len(executed),
        calculation={
            "formula": "verified_reduction = baseline_mw - mean(facility_power_mw over last N samples)",
            "samples_used": len(recent),
            "baseline_mw": baseline_mw,
            "actual_mw": actual,
            "verified_reduction_mw": verified,
            "target_reduction_mw": target_reduction_mw,
            "achievement_percent": round(100 * verified / target_reduction_mw, 1) if target_reduction_mw else None,
        },
        created_at=created,
    )
