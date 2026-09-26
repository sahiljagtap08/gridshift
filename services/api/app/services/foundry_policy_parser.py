"""Microsoft Foundry policy interpretation (spec section 11).

Foundry's only job: turn plain-language policy text into the strict `PolicyRule`
schema using Structured Outputs. It never sends an infrastructure command and never
sees infrastructure credentials (INV-10). Missing operational values must be surfaced
as `ambiguities`, never invented.

When Foundry is not configured, a transparent rule-based fallback keeps the demo
working and is labelled as such in `interpretation_model`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.core.config import Settings
from app.models import Ambiguity, PolicyRule, ReductionTarget, Trigger

SYSTEM_PROMPT = """You are a policy-to-constraint extractor for GridShift, a demand-flexibility control layer for AI data centers.

Read the proposed policy or program text and fill the PolicyRule schema.

Rules:
- Extract only what the text states or clearly implies. Do NOT invent operational values.
- If duration, response time, trigger, or protected/flexible workload classes are not specified, leave the field null or empty AND add an entry to `ambiguities` naming the field and why.
- reduction_target.type is "percent_of_baseline" when the text gives a percentage, "absolute_mw" when it gives megawatts. If the text gives NO number ("reasonable efforts", "reduce electricity use"), set value to 0 and add an ambiguity for field "reduction_target".
- Vague protection language ("important workloads", "where reasonable", "critical services" without saying which) must produce an ambiguity for field "protected_workload_classes", even if you also map a best-guess class.
- Map "critical customer-facing services", "production inference", "latency-sensitive APIs" to protected class critical_inference. Map safety/life-safety systems to safety_systems.
- Map training, batch, evaluation/eval, embeddings, synthetic data generation to the matching flexible classes; "non-critical" alone implies training, batch, evaluation, embeddings, synthetic_data.
- allowed_actions: include suspend/throttle/defer only if the text allows pausing, slowing, or delaying work; if the text is silent, include all three and record an ambiguity.
- operator_approval_required is true unless the text explicitly permits automatic curtailment.
- summary: one sentence restating the rule as you interpreted it.
"""


@dataclass
class Interpretation:
    rule: PolicyRule
    model: str
    request_id: str | None


class FoundryPolicyParser:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def configured(self) -> bool:
        return self.settings.foundry_configured

    async def interpret(self, text: str) -> Interpretation:
        if not self.configured:
            return fallback_interpret(text)
        from openai import AsyncAzureOpenAI

        client = AsyncAzureOpenAI(
            azure_endpoint=self.settings.foundry_endpoint,
            api_key=self.settings.foundry_api_key,
            api_version=self.settings.foundry_api_version,
        )
        completion = await client.chat.completions.with_raw_response.parse(
            model=self.settings.foundry_model_deployment,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Policy text:\n\n{text}"},
            ],
            response_format=PolicyRule,
            temperature=0,
        )
        request_id = completion.headers.get("x-request-id") or completion.headers.get("apim-request-id")
        parsed = completion.parse()
        message = parsed.choices[0].message
        if message.parsed is None:
            raise RuntimeError(f"Foundry returned no structured output: {message.refusal or 'unknown'}")
        return Interpretation(rule=message.parsed, model=f"foundry:{parsed.model}", request_id=request_id)


# ---- offline fallback --------------------------------------------------------

_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "six": 6, "twelve": 12}
_NUM = r"(\d+(?:\.\d+)?|one|two|three|four|six|twelve)"
_DURATION_PATTERNS = [
    re.compile(rf"(?:up to|for|lasting|events? of|maximum of|at most)\s*{_NUM}[\s-]*(hour|hr|minute|min)s?", re.I),
    re.compile(rf"{_NUM}-(hour|minute)\b", re.I),
]


def _to_minutes(raw: str, unit: str) -> int:
    n = float(_WORDS.get(raw.lower(), raw if raw.replace(".", "", 1).isdigit() else 0))
    return int(n * 60) if unit.lower().startswith("h") else int(n)


def _minutes(text: str) -> int | None:
    for pat in _DURATION_PATTERNS:
        m = pat.search(text)
        if m:
            return _to_minutes(m.group(1), m.group(2))
    return None


def fallback_interpret(text: str) -> Interpretation:
    t = text.lower()
    ambiguities: list[Ambiguity] = []

    pct = re.search(r"(\d+(?:\.\d+)?)\s*(?:%|percent)", t)
    mw = re.search(r"(\d+(?:\.\d+)?)\s*mw\b", t)
    if pct:
        target = ReductionTarget(type="percent_of_baseline", value=float(pct.group(1)))
    elif mw:
        target = ReductionTarget(type="absolute_mw", value=float(mw.group(1)))
    else:
        target = ReductionTarget(type="percent_of_baseline", value=0)
        ambiguities.append(Ambiguity(field="reduction_target", reason="no percentage or MW figure found in text"))

    duration = _minutes(t)
    if duration is None:
        ambiguities.append(Ambiguity(field="duration_minutes", reason="event duration is not specified"))

    response = None
    r = re.search(r"(?:within|respond(?:ing)?\s+(?:with)?in|notice of|lead time of)\s*(\d+)\s*(minute|min|hour|hr)", t)
    if r:
        response = int(r.group(1)) * (60 if r.group(2).startswith("h") else 1)
    else:
        ambiguities.append(Ambiguity(field="response_time_minutes", reason="policy does not define event notification lead time"))

    if "grid stress" in t or "emergency" in t or "reliability event" in t:
        trigger = Trigger(type="declared_grid_stress_event", description="declared grid stress / reliability event")
    elif "dispatch" in t or "utility request" in t or "when requested" in t:
        trigger = Trigger(type="utility_dispatch", description="utility or CSP dispatch instruction")
    elif "price" in t:
        trigger = Trigger(type="price_signal", description="price-based trigger")
    else:
        trigger = Trigger(type="unspecified", description=None)
        ambiguities.append(Ambiguity(field="trigger", reason="no triggering condition stated"))

    protected = []
    if any(k in t for k in ("customer-facing", "customer facing", "production inference", "critical inference", "latency")):
        protected.append("critical_inference")
    if "safety" in t:
        protected.append("safety_systems")
    if not protected:
        ambiguities.append(Ambiguity(field="protected_workload_classes", reason="text does not say which workloads must never be touched"))

    flexible = []
    for key, cls in (("training", "training"), ("batch", "batch"), ("eval", "evaluation"),
                     ("embedding", "embeddings"), ("synthetic", "synthetic_data")):
        if key in t:
            flexible.append(cls)
    if not flexible and "non-critical" in t:
        flexible = ["training", "batch", "evaluation", "embeddings", "synthetic_data"]
    if not flexible:
        ambiguities.append(Ambiguity(field="flexible_workload_classes", reason="text does not identify which workloads are eligible to move"))

    actions = []
    if any(k in t for k in ("pause", "suspend", "stop")):
        actions.append("suspend")
    if any(k in t for k in ("throttle", "slow", "reduce parallelism", "scale down")):
        actions.append("throttle")
    if any(k in t for k in ("defer", "delay", "shift", "reschedule")):
        actions.append("defer")
    if re.search(r"(do not|don't|never|no)\s+(pause|suspend|stop)", t):
        actions = [a for a in actions if a != "suspend"]
    if not actions:
        actions = ["suspend", "throttle", "defer"]
        ambiguities.append(Ambiguity(field="allowed_actions", reason="text does not restrict how load may be reduced; all actions assumed"))

    approval = not any(k in t for k in ("automatic", "automatically", "without approval", "autonomous"))

    summary_bits = []
    if target.value:
        summary_bits.append(f"reduce {'non-critical ' if 'non-critical' in t else ''}load by {target.value:g}{'%' if target.type == 'percent_of_baseline' else ' MW'}")
    if duration:
        summary_bits.append(f"for up to {duration} minutes")
    summary_bits.append(f"when a {trigger.type.replace('_', ' ')} occurs")
    if protected:
        summary_bits.append("protecting " + ", ".join(p.replace("_", " ") for p in protected))
    summary = "Interpreted: " + ", ".join(summary_bits) + ("; manual approval required" if approval else "; automatic curtailment permitted") + "."

    rule = PolicyRule(
        reduction_target=target, duration_minutes=duration, response_time_minutes=response, trigger=trigger,
        protected_workload_classes=protected, flexible_workload_classes=flexible, allowed_actions=actions,
        operator_approval_required=approval, ambiguities=ambiguities, summary=summary,
    )
    return Interpretation(rule=rule, model="offline-fallback (Foundry not configured)", request_id=None)
