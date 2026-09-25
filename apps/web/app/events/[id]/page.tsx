"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { mw, pct, dateTime, minutes } from "@/lib/format";
import type { EventDetail } from "@/lib/types";
import { PlanTable } from "@/components/PlanTable";
import { Timeline } from "@/components/Timeline";
import { Badge, Card, EventStatusBadge, Metric, PageTitle } from "@/components/ui";

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.event(id).then(setD).catch((e) => setError(e.message));
    const t = setInterval(() => api.event(id).then(setD).catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [id]);

  if (error) return <p className="text-risk">{error}</p>;
  if (!d) return <p className="text-muted">Loading event…</p>;
  const { event: e, verification: v, plans, approvals, timeline, policy_version: pv } = d;
  const achievement =
    v?.verified_reduction_mw != null && v.target_reduction_mw ? (v.verified_reduction_mw / v.target_reduction_mw) * 100 : null;

  return (
    <>
      <PageTitle
        title={`Event ${e.id}`}
        subtitle={`${e.target.type === "percent" ? `${e.target.value}%` : mw(e.target.value)} for ${minutes(e.duration_minutes)} · received ${dateTime(e.received_at)}`}
        actions={<EventStatusBadge status={e.status} />}
      />

      <Card title="Verification record" aside={v && <Badge tone={v.status === "VERIFIED" ? "success" : "signal"}>{v.status}</Badge>}>
        {v ? (
          <>
            <div className="grid grid-cols-5 gap-6">
              <Metric label="Baseline" value={v.baseline_mw.toFixed(2)} unit="MW" hint={v.baseline_method} size="md" />
              <Metric label="Actual during event" value={v.actual_mw?.toFixed(2) ?? "—"} unit="MW" hint="mean of settled samples" />
              <Metric label="Verified reduction" value={v.verified_reduction_mw?.toFixed(2) ?? "—"} unit="MW" hint="baseline − actual" size="lg" />
              <Metric label="Target" value={v.target_reduction_mw.toFixed(2)} unit="MW" hint={achievement != null ? `${pct(achievement, 0)} achieved` : ""} />
              <Metric label="Expected (modeled)" value={v.expected_reduction_mw.toFixed(2)} unit="MW" hint="sum of executed actions" />
            </div>
            <dl className="mt-6 grid grid-cols-4 gap-4 border-t border-border pt-4 text-[13px]">
              <div><dt className="text-xs text-muted">Target met</dt><dd className={`font-medium ${v.target_met ? "text-success" : "text-risk"}`}>{v.target_met == null ? "unverified" : v.target_met ? "yes" : "no"}</dd></div>
              <div><dt className="text-xs text-muted">Critical workloads impacted</dt><dd className="num font-medium">{v.critical_workloads_impacted}</dd></div>
              <div><dt className="text-xs text-muted">Deadline misses</dt><dd className="num font-medium">{v.deadline_misses}</dd></div>
              <div><dt className="text-xs text-muted">Actions executed</dt><dd className="num font-medium">{v.actions_executed}</dd></div>
            </dl>
            <pre className="mono mt-4 overflow-x-auto rounded-md bg-beige/50 p-3 text-[11px] text-muted">{JSON.stringify(v.calculation, null, 2)}</pre>
          </>
        ) : (
          <p className="text-muted">No verification has run yet. Telemetry must settle after execution before GridShift will report a measured number.</p>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          {plans.map((p) => (
            <Card
              key={p.id}
              title={`Plan round ${p.round}`}
              aside={
                <span className="flex items-center gap-3 text-xs text-muted">
                  <span className="num">covers {mw(p.target_reduction_mw)} · expected {mw(p.expected_reduction_mw)}</span>
                  <Badge tone={p.status === "EXECUTED" ? "success" : p.status === "INFEASIBLE" ? "risk" : "neutral"}>{p.status}</Badge>
                </span>
              }
            >
              {p.actions.length ? <PlanTable actions={p.actions} showStatus compact /> : <p className="text-muted">{p.infeasible_reason ?? "No actions."}</p>}
              <div className="mono mt-3 text-[11px] text-muted">snapshot {p.workload_snapshot_hash} · disruption score {p.disruption_score}</div>
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          <Card title="Program used">
            {pv ? (
              <>
                <Link href={`/programs/${pv.id}`} className="mono text-xs text-teal hover:underline">{pv.id}</Link>
                <div className="mt-1 text-[13px]">{pv.structured_rule.summary}</div>
                <div className="mt-2 text-xs text-muted">Immutable version {pv.version} · {pv.status}</div>
              </>
            ) : <p className="text-muted">Unknown</p>}
          </Card>
          <Card title="Approvals">
            {approvals.length ? (
              <ul className="space-y-2 text-[13px]">
                {approvals.map((a) => (
                  <li key={a.id || a.plan_hash}>
                    <span className="font-medium">{a.decision}</span> by {a.user_id}
                    <div className="mono text-[11px] text-muted">plan {a.action_plan_id} · hash {a.plan_hash}</div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted">None recorded.</p>}
          </Card>
          <Card title="Timeline"><Timeline entries={timeline} /></Card>
        </div>
      </div>
    </>
  );
}
