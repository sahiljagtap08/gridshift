#!/usr/bin/env python3
"""Evaluate policy interpretation against a hand-labelled set (spec 11.5 / 33).

Runs each example through the configured parser (Microsoft Foundry Structured Outputs
when FOUNDRY_* env vars are set, otherwise the offline fallback) and scores the fields
we care about. The key property being tested: the model reports ambiguity instead of
inventing operational values.

Usage:
    cd services/api && .venv/bin/python ../../scripts/foundry_eval.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1] / "services" / "api"
sys.path.insert(0, str(API_DIR))

from app.core.config import get_settings  # noqa: E402
from app.services.foundry_policy_parser import FoundryPolicyParser  # noqa: E402


def check(rule, expect) -> list[str]:
    failures = []
    amb = {a.field for a in rule.ambiguities}
    if "reduction_type" in expect and rule.reduction_target.type != expect["reduction_type"]:
        failures.append(f"reduction_type {rule.reduction_target.type} != {expect['reduction_type']}")
    if "reduction_value" in expect and rule.reduction_target.value != expect["reduction_value"]:
        failures.append(f"reduction_value {rule.reduction_target.value} != {expect['reduction_value']}")
    if "duration_minutes" in expect and rule.duration_minutes != expect["duration_minutes"]:
        failures.append(f"duration {rule.duration_minutes} != {expect['duration_minutes']}")
    if "response_time_minutes" in expect and rule.response_time_minutes != expect["response_time_minutes"]:
        failures.append(f"response_time {rule.response_time_minutes} != {expect['response_time_minutes']}")
    if "trigger" in expect and rule.trigger.type != expect["trigger"]:
        failures.append(f"trigger {rule.trigger.type} != {expect['trigger']}")
    if "operator_approval_required" in expect and rule.operator_approval_required != expect["operator_approval_required"]:
        failures.append("operator_approval_required mismatch")
    for f in expect.get("protected_includes", []):
        if f not in rule.protected_workload_classes:
            failures.append(f"protected missing {f}")
    for f in expect.get("flexible_includes", []):
        if f not in rule.flexible_workload_classes:
            failures.append(f"flexible missing {f}")
    for f in expect.get("allowed_includes", []):
        if f not in rule.allowed_actions:
            failures.append(f"allowed missing {f}")
    for f in expect.get("allowed_excludes", []):
        if f in rule.allowed_actions:
            failures.append(f"allowed should exclude {f}")
    for f in expect.get("ambiguous_fields_include", []):
        if f not in amb:
            failures.append(f"ambiguity not reported for {f}")
    return failures


async def main() -> int:
    examples = json.loads((API_DIR / "tests" / "fixtures" / "policy_eval_set.json").read_text())
    parser = FoundryPolicyParser(get_settings())
    print(f"parser: {'Microsoft Foundry (' + get_settings().foundry_model_deployment + ')' if parser.configured else 'offline fallback'}")
    passed = 0
    for ex in examples:
        result = await parser.interpret(ex["text"])
        failures = check(result.rule, ex["expect"])
        status = "PASS" if not failures else "FAIL"
        passed += not failures
        print(f"[{status}] {ex['id']:<32} model={result.model} req={result.request_id or '-'}")
        for f in failures:
            print(f"        - {f}")
    print(f"\n{passed}/{len(examples)} passed")
    return 0 if passed == len(examples) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
