"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { mw, pct, minutes, dateTime } from "@/lib/format";
import type { PolicyVersion, SimulationRun } from "@/lib/types";
import { PlanTable } from "@/components/PlanTable";
import { Badge, Button, Card, ErrorNote, Metric, PageTitle, PolicyStatusBadge, Table, td, th } from "@/components/ui";

export default function SimulationResultPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<SimulationRun | null>(null);
  const [version, setVersion] = useState<PolicyVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.simulation(id)
      .then(async (r) => {
        setRun(r);
        setVersion(await api.policyVersion(r.policy_version_id));
      })
      .catch((e) => setError(e.message));
  }, [id]);

  if (error) return <ErrorNote message={error} />;
  if (!run) return <p className="text-muted">Loading simulation…</p>;

  const requestedPct = run.baseline_mw ? (run.target_reduction_mw / run.baseline_mw) * 100 : 0;
  const availablePct = run.baseline_mw ? (run.expected_reduction_mw / run.baseline_mw) * 100 : 0;
  const heroColor = run.result_status === "FEASIBLE" ? "text-success" : run.result_status === "INFEASIBLE" ? "text-risk" : "text-signal-ink";

  function exportEvidence() {
    const blob = new Blob([JSON.stringify({ simulation: run, policy_version: version, generated_at: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gridshift-policy-evidence-${run!.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function publish() {
    if (!version) return;
    setBusy(true);
    try {
      const ref = `EXT-${new Date().toISOString().slice(0, 10)}`;
      setVersion(await api.publishVersion(version.id, ref));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle
        title="Simulation result"
        subtitle={`${run.id} · ${run.scenario} · ${dateTime(run.created_at)}`}
        actions={
          <>
            <Button onClick={exportEvidence}>Generate policy evidence</Button>
            {version && version.status !== "ACTIVE" && (
              <Button variant="primary" onClick={publish} disabled={busy}>{busy ? "Publishing…" : "Publish to registry"}</Button>
            )}
            {version?.status === "ACTIVE" && <Badge tone="success">ACTIVE IN REGISTRY</Badge>}
          </>
        }
      />

      <Card>
        <div className="grid grid-cols-[1fr_2fr] items-center gap-8">
          <div>
            <div className={`text-5xl font-semibold tracking-tight ${heroColor}`}>{run.result_status.replace(/_/g, " ")}</div>
            <p className="mt-2 max-w-[40ch] text-muted">
              {run.result_status === "FEASIBLE" && "The modeled site can meet this rule without touching any protected workload."}
              {run.result_status === "CONDITIONALLY_FEASIBLE" && "The rule can be met, but only with assumptions the text leaves open. Review the risks."}
              {run.result_status === "INFEASIBLE" && "The modeled site does not have enough eligible flexibility to meet this rule."}
            </p>
          </div>
          <div className="grid grid-cols-4 gap-6 border-l border-border pl-8">
            <Metric label="Requested" value={pct(requestedPct)} hint={mw(run.target_reduction_mw)} />
            <Metric label="Available" value={pct(availablePct)} hint={`${mw(run.expected_reduction_mw)} expected`} />
            <Metric label="Critical violations" value={run.critical_workloads_affected} hint="protected workloads touched" />
            <Metric label="Workloads modified" value={run.flexible_workloads_modified} hint={`of ${mw(run.baseline_mw)} baseline`} />
          </div>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-4">
          <Card title="Proposed actions">
            {run.plan && run.plan.actions.length ? <PlanTable actions={run.plan.actions} compact /> : <p className="text-muted">No feasible action set.</p>}
          </Card>
          {run.plan && run.plan.exclusions.length > 0 && (
            <Card title="Excluded from the plan">
              <ul className="space-y-1.5 text-[13px]">
                {run.plan.exclusions.map((x, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-44 shrink-0 font-medium">{x.workload_name}</span>
                    <span className="mono w-28 shrink-0 text-xs text-muted">{x.action_type}</span>
                    <span className="text-muted">{x.reason}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Sensitivity">
            <Table>
              <thead>
                <tr>
                  <th className={th}>Duration</th>
                  <th className={`${th} text-right`}>Reduction</th>
                  <th className={th}>Result</th>
                  <th className={`${th} text-right`}>Expected</th>
                </tr>
              </thead>
              <tbody>
                {run.sensitivity.map((s, i) => (
                  <tr key={i}>
                    <td className={td}>{minutes(s.duration_minutes)}</td>
                    <td className={`${td} num text-right`}>{s.reduction_percent}%</td>
                    <td className={td}><Badge tone={s.status === "FEASIBLE" ? "success" : s.status === "INFEASIBLE" ? "risk" : "signal"}>{s.status.replace(/_/g, " ")}</Badge></td>
                    <td className={`${td} num text-right`}>{mw(s.expected_reduction_mw)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Constraints respected">
            <ul className="list-disc space-y-1 pl-5 text-[13px]">{run.constraints_respected.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </Card>
          <Card title="What would make this fail?">
            {run.failure_conditions.length ? (
              <ul className="list-disc space-y-1 pl-5 text-[13px]">{run.failure_conditions.map((c, i) => <li key={i}>{c}</li>)}</ul>
            ) : <p className="text-muted">No failure conditions found within the tested range.</p>}
          </Card>
          <Card title="Risks and unknowns">
            <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted">{run.risks.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </Card>
          {version && (
            <Card title="Rule version">
              <Link href={`/programs/${version.id}`} className="mono text-xs text-teal hover:underline">{version.id}</Link>
              <div className="mt-2"><PolicyStatusBadge status={version.status} /></div>
              <p className="mt-2 text-[13px] text-muted">{version.structured_rule.summary}</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
