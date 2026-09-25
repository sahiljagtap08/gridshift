"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { EventDetail, PolicyVersion } from "@/lib/types";
import { Button, ErrorNote, Field, inputCls } from "./ui";

export function EventModal({
  policy,
  policyName,
  onClose,
  onCreated,
}: {
  policy: PolicyVersion | null;
  policyName: string;
  onClose: () => void;
  onCreated: (d: EventDetail) => void;
}) {
  const [type, setType] = useState<"percent" | "mw">("percent");
  const [value, setValue] = useState(10);
  const [duration, setDuration] = useState(120);
  const [response, setResponse] = useState(10);
  const [underDeliver, setUnderDeliver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!policy) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.createEvent({
        target: { type, value },
        duration_minutes: duration,
        response_time_minutes: response,
        policy_version_id: policy.id,
        simulate_under_delivery: underDeliver,
      });
      onCreated(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the event");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/40" style={{ isolation: "isolate" }}>
      <form
        onSubmit={submit}
        className="w-[520px] rounded-lg border border-border bg-surface shadow-[0_12px_40px_rgba(28,29,26,0.18)]"
      >
        <header className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold">Simulate grid event</h2>
          <p className="mt-1 text-muted">
            In production this arrives from a utility, CSP, or site energy system. Here you raise it by hand.
          </p>
        </header>
        <div className="grid grid-cols-2 gap-4 px-6 py-5">
          <Field label="Target reduction">
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                step={type === "percent" ? 1 : 0.1}
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
                className={`${inputCls} num`}
              />
              <select value={type} onChange={(e) => setType(e.target.value as "percent" | "mw")} className={`${inputCls} w-28`}>
                <option value="percent">% of load</option>
                <option value="mw">MW</option>
              </select>
            </div>
          </Field>
          <Field label="Duration (minutes)">
            <input type="number" min={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={`${inputCls} num`} />
          </Field>
          <Field label="Response time (minutes)">
            <input type="number" min={1} value={response} onChange={(e) => setResponse(Number(e.target.value))} className={`${inputCls} num`} />
          </Field>
          <Field label="Program">
            <div className={`${inputCls} bg-beige/50`}>
              {policyName}
              <span className="mono ml-2 text-xs text-muted">{policy?.id ?? "none active"}</span>
            </div>
          </Field>
          <label className="col-span-2 flex items-start gap-3 rounded-md border border-border px-4 py-3">
            <input type="checkbox" checked={underDeliver} onChange={(e) => setUnderDeliver(e.target.checked)} className="mt-1 accent-teal-dark" />
            <span>
              <span className="font-medium">Simulate under-delivery</span>
              <span className="block text-xs text-muted">
                The first plan lands at about 75% of its expected reduction, so you can watch GridShift detect the shortfall and replan.
              </span>
            </span>
          </label>
          {error && <div className="col-span-2"><ErrorNote message={error} /></div>}
          {!policy && <div className="col-span-2"><ErrorNote message="No ACTIVE program is mapped to this site. Publish one from Policy Lab first." /></div>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !policy}>{busy ? "Creating…" : "Create event"}</Button>
        </footer>
      </form>
    </div>
  );
}
