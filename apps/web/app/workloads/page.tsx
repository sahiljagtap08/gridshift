"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { mw, clock } from "@/lib/format";
import type { ActionType, Criticality, FlexibilityUpdate, Workload } from "@/lib/types";
import {
  Button,
  Card,
  ErrorNote,
  Field,
  PageTitle,
  Table,
  flexibilityBadge,
  inputCls,
  stateBadge,
  td,
  th,
} from "@/components/ui";

const PRESETS: Array<{ label: string; hint: string; patch: FlexibilityUpdate }> = [
  { label: "Critical / never touch", hint: "Protected. No plan can include it.", patch: { protected: true, criticality: "critical", allowed_actions: ["none"] } },
  { label: "Throttle only", hint: "Reduce parallelism, never pause.", patch: { protected: false, allowed_actions: ["throttle"], max_throttle_percent: 0.5 } },
  { label: "Pause if checkpointed", hint: "Suspend and resume from checkpoint.", patch: { protected: false, checkpointable: true, allowed_actions: ["suspend"], max_pause_minutes: 240 } },
  { label: "Delay freely before deadline", hint: "Queue it until the event ends.", patch: { protected: false, allowed_actions: ["defer"], max_pause_minutes: 360 } },
];

export default function WorkloadsPage() {
  const [workloads, setWorkloads] = useState<Workload[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.workloads().then(setWorkloads).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const current = workloads.find((w) => w.id === selected) ?? null;

  return (
    <>
      <PageTitle
        title="Workloads"
        subtitle="GridShift can suggest flexibility from workload metadata, but the operator is the authority. What you set here is what the optimizer is allowed to do."
      />
      {error && <div className="mb-4"><ErrorNote message={error} /></div>}
      <div className={`grid gap-4 ${current ? "grid-cols-[1fr_380px]" : "grid-cols-1"}`}>
        <Card>
          <Table>
            <thead>
              <tr>
                <th className={th}>Workload</th>
                <th className={th}>State</th>
                <th className={`${th} text-right`}>Power</th>
                <th className={th}>Criticality</th>
                <th className={th}>Flexibility</th>
                <th className={th}>Deadline</th>
                <th className={th}>Owner</th>
              </tr>
            </thead>
            <tbody>
              {workloads.map((w) => (
                <tr
                  key={w.id}
                  onClick={() => setSelected(w.id)}
                  className={`cursor-pointer transition-colors duration-150 ease-out hover:bg-beige/60 ${selected === w.id ? "bg-beige/80" : ""}`}
                >
                  <td className={`${td} font-medium`}>
                    {w.name}
                    <span className="mono ml-2 text-xs text-muted">{w.namespace}</span>
                  </td>
                  <td className={td}>{stateBadge(w.state, w.throttle_percent)}</td>
                  <td className={`${td} num text-right`}>{mw(w.current_power_mw)}</td>
                  <td className={td}>{w.criticality}</td>
                  <td className={td}>{flexibilityBadge(w)}</td>
                  <td className={`${td} text-muted`}>{w.deadline_at ? clock(w.deadline_at) : "continuous"}</td>
                  <td className={`${td} text-muted`}>{w.owner ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        {current && (
          <DetailPanel
            key={current.id + current.generation}
            workload={current}
            onClose={() => setSelected(null)}
            onSaved={(w) => setWorkloads((prev) => prev.map((x) => (x.id === w.id ? w : x)))}
          />
        )}
      </div>
    </>
  );
}

function DetailPanel({
  workload: w,
  onClose,
  onSaved,
}: {
  workload: Workload;
  onClose: () => void;
  onSaved: (w: Workload) => void;
}) {
  const [form, setForm] = useState<FlexibilityUpdate>({
    protected: w.protected,
    criticality: w.criticality,
    checkpointable: w.checkpointable,
    max_pause_minutes: w.max_pause_minutes,
    max_throttle_percent: w.max_throttle_percent,
    allowed_actions: w.allowed_actions,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleAction = (a: ActionType) => {
    const cur = new Set(form.allowed_actions ?? []);
    cur.delete("none");
    if (cur.has(a)) cur.delete(a);
    else cur.add(a);
    setForm({ ...form, allowed_actions: cur.size ? [...cur] : ["none"] });
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updateFlexibility(w.id, form);
      onSaved(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={w.name} aside={<button onClick={onClose} className="text-xs text-muted hover:text-ink">Close</button>}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
        <dt className="text-muted">ID</dt><dd className="mono text-xs">{w.id}</dd>
        <dt className="text-muted">Type</dt><dd>{w.workload_type} · {w.scheduler_kind}</dd>
        <dt className="text-muted">Nominal power</dt><dd className="num">{mw(w.nominal_power_mw)}</dd>
        <dt className="text-muted">Labels</dt>
        <dd className="mono text-xs">{Object.entries(w.labels).map(([k, v]) => `${k}=${v}`).join(" ") || "—"}</dd>
      </dl>

      <div className="mt-5 border-t border-border pt-4">
        <div className="text-xs text-muted">Presets</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setForm({ ...form, ...p.patch })}
              className="rounded-md border border-border px-3 py-2 text-left text-[12px] transition-colors duration-150 ease-out hover:border-teal hover:bg-beige/50"
            >
              <span className="block font-medium">{p.label}</span>
              <span className="block text-muted">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-4 border-t border-border pt-4">
        <label className="flex items-center justify-between">
          <span className="font-medium">Protected</span>
          <input type="checkbox" checked={!!form.protected} onChange={(e) => setForm({ ...form, protected: e.target.checked })} className="accent-teal-dark" />
        </label>
        <Field label="Criticality">
          <select value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value as Criticality })} className={inputCls}>
            {(["critical", "high", "medium", "low"] as Criticality[]).map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <label className="flex items-center justify-between">
          <span>Checkpointable</span>
          <input type="checkbox" checked={!!form.checkpointable} onChange={(e) => setForm({ ...form, checkpointable: e.target.checked })} className="accent-teal-dark" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max pause (min)">
            <input type="number" min={0} value={form.max_pause_minutes ?? 0} onChange={(e) => setForm({ ...form, max_pause_minutes: Number(e.target.value) })} className={`${inputCls} num`} disabled={!!form.protected} />
          </Field>
          <Field label="Max throttle (%)">
            <input type="number" min={0} max={100} value={Math.round((form.max_throttle_percent ?? 0) * 100)} onChange={(e) => setForm({ ...form, max_throttle_percent: Number(e.target.value) / 100 })} className={`${inputCls} num`} disabled={!!form.protected} />
          </Field>
        </div>
        <fieldset disabled={!!form.protected}>
          <legend className="text-xs text-muted">Allowed actions</legend>
          <div className="mt-2 flex gap-4">
            {(["throttle", "suspend", "defer"] as ActionType[]).map((a) => (
              <label key={a} className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={form.allowed_actions?.includes(a) ?? false} onChange={() => toggleAction(a)} className="accent-teal-dark" />
                {a}
              </label>
            ))}
          </div>
        </fieldset>
        {error && <ErrorNote message={error} />}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{saved ? "Saved. Any pending plan will be rebuilt." : "Changes bump the workload generation."}</span>
          <Button variant="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save flexibility"}</Button>
        </div>
      </div>
    </Card>
  );
}
