"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { humanClass } from "@/lib/format";
import {
  TRIGGER_TYPES,
  WORKLOAD_CLASSES,
  type PolicyRule,
  type PolicyVersion,
  type TriggerType,
  type WorkloadClass,
} from "@/lib/types";
import { Button, Card, ErrorNote, Field, PageTitle, inputCls } from "@/components/ui";

const EXAMPLE =
  "During declared grid stress events, participating large-load customers should reduce non-critical electricity demand by 15% for up to two hours while protecting critical customer-facing services.";

type Step = "text" | "confirm" | "simulate";

export default function NewPolicyPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("text");
  const [name, setName] = useState("Draft large-load flexibility rule");
  const [text, setText] = useState(EXAMPLE);
  const [interpreted, setInterpreted] = useState<PolicyVersion | null>(null);
  const [rule, setRule] = useState<PolicyRule | null>(null);
  const [confirmed, setConfirmed] = useState<PolicyVersion | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function interpret() {
    setBusy("interpret");
    setError(null);
    try {
      const policy = await api.createPolicy({ name, source_text: text });
      const version = await api.interpretPolicy(policy.id);
      setInterpreted(version);
      setRule(structuredClone(version.structured_rule));
      setStep("confirm");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!interpreted || !rule) return;
    setBusy("confirm");
    setError(null);
    try {
      const v = await api.confirmVersion(interpreted.id, rule);
      setConfirmed(v);
      setStep("simulate");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function simulate() {
    if (!confirmed) return;
    setBusy("simulate");
    setError(null);
    try {
      const run = await api.runSimulation({ policy_version_id: confirmed.id, site_id: "site_demo", scenario: "current_peak" });
      router.push(`/policy-lab/${run.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <>
      <PageTitle
        title="New policy simulation"
        subtitle="Microsoft Foundry extracts the rule into fixed fields. Nothing runs until a person confirms every one of them."
      />
      {error && <div className="mb-4"><ErrorNote message={error} /></div>}

      <div className="grid grid-cols-[45fr_55fr] gap-4">
        <Card title="Policy text">
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} disabled={step !== "text"} />
          </Field>
          <div className="mt-4">
            <Field label="Proposed rule, program clause, or draft language">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={14}
                className={`${inputCls} resize-y leading-relaxed`}
                disabled={step !== "text"}
              />
            </Field>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-muted">Sent to Foundry with a strict JSON schema. No credentials, no cluster data.</span>
            {step === "text" ? (
              <Button variant="primary" onClick={interpret} disabled={busy !== null || !text.trim()}>
                {busy === "interpret" ? "Interpreting…" : "Interpret rule"}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => { setStep("text"); setConfirmed(null); }} disabled={busy !== null}>
                Back to policy text
              </Button>
            )}
          </div>
        </Card>

        <Card
          title={step === "text" ? "Interpreted constraints" : "We interpreted the rule like this"}
          aside={interpreted && (
            <span className="mono text-[11px] text-muted">
              {interpreted.interpretation_model}{interpreted.foundry_request_id ? ` · ${interpreted.foundry_request_id}` : ""}
            </span>
          )}
        >
          {!rule ? (
            <p className="text-muted">Interpret the text to see its structured fields here. Every field stays editable before confirmation.</p>
          ) : (
            <RuleEditor rule={rule} onChange={setRule} disabled={step !== "confirm"} />
          )}

          {rule && rule.ambiguities.length > 0 && (
            <div className="mt-4 rounded-md border border-signal bg-[#f7f4cf] px-4 py-3 text-[13px] text-signal-ink">
              <div className="font-medium">The text did not specify</div>
              <ul className="mt-1 list-disc pl-5">
                {rule.ambiguities.map((a, i) => (
                  <li key={i}><span className="mono text-xs">{a.field}</span>: {a.reason}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs">Foundry reports gaps instead of inventing values. Fill them in above or leave them for the simulation to flag.</p>
            </div>
          )}

          {step === "confirm" && (
            <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
              <span className="text-xs text-muted">Confirming creates a HUMAN_CONFIRMED version. The AI-interpreted draft is kept for audit.</span>
              <Button variant="primary" onClick={confirm} disabled={busy !== null}>{busy === "confirm" ? "Confirming…" : "Confirm fields"}</Button>
            </div>
          )}

          {step === "simulate" && confirmed && (
            <div className="mt-5 border-t border-border pt-4">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="h-2 w-2 rounded-full bg-success" />
                Confirmed as <span className="mono text-xs">{confirmed.id}</span> by {confirmed.confirmed_by}
              </div>
              <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-3">
                <Field label="Modeled site">
                  <select className={inputCls} defaultValue="site_demo">
                    <option value="site_demo">Virginia AI Campus – 12.6 MW demo</option>
                  </select>
                </Field>
                <Button variant="primary" onClick={simulate} disabled={busy !== null}>{busy === "simulate" ? "Running…" : "Run simulation"}</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function RuleEditor({ rule, onChange, disabled }: { rule: PolicyRule; onChange: (r: PolicyRule) => void; disabled: boolean }) {
  const set = <K extends keyof PolicyRule>(k: K, v: PolicyRule[K]) => onChange({ ...rule, [k]: v });
  const numOrNull = (s: string) => (s === "" ? null : Number(s));
  const toggleClass = (key: "protected_workload_classes" | "flexible_workload_classes", c: WorkloadClass) => {
    const cur = new Set(rule[key]);
    if (cur.has(c)) cur.delete(c);
    else cur.add(c);
    set(key, [...cur]);
  };
  const toggleAction = (a: "suspend" | "throttle" | "defer") => {
    const cur = new Set(rule.allowed_actions);
    if (cur.has(a)) cur.delete(a);
    else cur.add(a);
    set("allowed_actions", [...cur]);
  };

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <div className="rounded-md border border-border px-4 py-3">
        <div className="text-xs text-muted">Summary</div>
        <div className="mt-0.5 text-[13px]">{rule.summary}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Reduction target">
          <div className="flex gap-2">
            <input type="number" min={0} step={0.5} value={rule.reduction_target.value} onChange={(e) => set("reduction_target", { ...rule.reduction_target, value: Number(e.target.value) })} className={`${inputCls} num`} />
            <select value={rule.reduction_target.type} onChange={(e) => set("reduction_target", { ...rule.reduction_target, type: e.target.value as PolicyRule["reduction_target"]["type"] })} className={`${inputCls} w-36`}>
              <option value="percent_of_baseline">% of baseline</option>
              <option value="absolute_mw">MW</option>
            </select>
          </div>
        </Field>
        <Field label="Trigger">
          <select value={rule.trigger.type} onChange={(e) => set("trigger", { ...rule.trigger, type: e.target.value as TriggerType })} className={inputCls}>
            {TRIGGER_TYPES.map((t) => <option key={t} value={t}>{humanClass(t)}</option>)}
          </select>
        </Field>
        <Field label="Duration (minutes)" hint={rule.duration_minutes == null ? "not specified in the text" : undefined}>
          <input type="number" min={0} value={rule.duration_minutes ?? ""} placeholder="unspecified" onChange={(e) => set("duration_minutes", numOrNull(e.target.value))} className={`${inputCls} num`} />
        </Field>
        <Field label="Response time (minutes)" hint={rule.response_time_minutes == null ? "not specified in the text" : undefined}>
          <input type="number" min={0} value={rule.response_time_minutes ?? ""} placeholder="unspecified" onChange={(e) => set("response_time_minutes", numOrNull(e.target.value))} className={`${inputCls} num`} />
        </Field>
      </div>
      <ClassPicker label="Protected workload classes (never touched)" selected={rule.protected_workload_classes} onToggle={(c) => toggleClass("protected_workload_classes", c)} />
      <ClassPicker label="Flexible workload classes (eligible to move)" selected={rule.flexible_workload_classes} onToggle={(c) => toggleClass("flexible_workload_classes", c)} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-muted">Allowed actions</div>
          <div className="mt-2 flex gap-4">
            {(["throttle", "suspend", "defer"] as const).map((a) => (
              <label key={a} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={rule.allowed_actions.includes(a)} onChange={() => toggleAction(a)} className="accent-teal-dark" />{a}
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Approval mode</div>
          <label className="mt-2 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={rule.operator_approval_required} onChange={(e) => set("operator_approval_required", e.target.checked)} className="accent-teal-dark" />
            Manual operator approval required
          </label>
        </div>
      </div>
    </fieldset>
  );
}

function ClassPicker({ label, selected, onToggle }: { label: string; selected: WorkloadClass[]; onToggle: (c: WorkloadClass) => void }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {WORKLOAD_CLASSES.map((c) => {
          const on = selected.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => onToggle(c)}
              className={`rounded border px-2 py-1 text-[12px] transition-colors duration-150 ease-out ${on ? "border-teal-dark bg-teal-dark text-white" : "border-border bg-surface text-ink hover:border-teal"}`}
            >
              {humanClass(c)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
