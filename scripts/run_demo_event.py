#!/usr/bin/env python3
"""Drive the full Live Ops loop against a running API and print the timeline.

    python scripts/run_demo_event.py [--under-delivery] [--api http://localhost:8000/api/v1]
"""

from __future__ import annotations

import argparse
import time
import uuid

import httpx


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000/api/v1")
    ap.add_argument("--under-delivery", action="store_true")
    ap.add_argument("--percent", type=float, default=10)
    args = ap.parse_args()
    c = httpx.Client(base_url=args.api, timeout=30)

    c.post("/demo/reset")
    ov = c.get("/overview").json()
    print(f"site {ov['site']['name']}: {ov['current_load_mw']:.2f} MW, protected {ov['protected_load_mw']:.2f} MW")

    d = c.post("/events", json={"target": {"type": "percent", "value": args.percent},
                                "simulate_under_delivery": args.under_delivery}).json()
    ev = d["event"]
    print(f"event {ev['id']}: target {ev['target_reduction_mw']:.2f} MW of {ev['baseline_mw']:.2f} MW baseline -> {ev['status']}")

    seen = 0
    while True:
        d = c.get(f"/events/{ev['id']}").json()
        for t in d["timeline"][seen:]:
            print(f"  {t['at'][11:19]}  {t['kind']:<14} {t['message']}")
        seen = len(d["timeline"])
        status = d["event"]["status"]
        if status == "AWAITING_APPROVAL":
            plan = d["active_plan"]
            for a in plan["actions"]:
                print(f"      plan r{plan['round']}: {a['workload_name']:<26} {a['action_type']:<9} {a['expected_reduction_mw']:.2f} MW  ({a['reason']})")
            c.post(f"/plans/{plan['id']}/approve", json={"user_id": "operator_demo"},
                   headers={"Idempotency-Key": str(uuid.uuid4())})
        elif status in ("COMPLETED", "CANCELLED", "FAILED", "REQUIRES_OPERATOR", "BLOCKED"):
            break
        time.sleep(1)

    v = d.get("verification")
    if v:
        print(f"\nverification: {v['status']}  baseline {v['baseline_mw']:.2f}  actual {v['actual_mw']:.2f}  "
              f"verified reduction {v['verified_reduction_mw']:.2f} MW  target met={v['target_met']}  "
              f"critical impacted={v['critical_workloads_impacted']}")
    print(f"final status: {d['event']['status']}")


if __name__ == "__main__":
    main()
