"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import type { Policy, PolicyVersion, SimulationRun } from "@/lib/types";
import { Badge, Card, Empty, LinkButton, PageTitle, PolicyStatusBadge, Table, td, th } from "@/components/ui";

export default function PolicyLabPage() {
  const [rows, setRows] = useState<Array<{ policy: Policy; versions: PolicyVersion[] }>>([]);
  const [sims, setSims] = useState<SimulationRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.policies().then(setRows).catch((e) => setError(e.message));
    api.simulations().then(setSims).catch(() => {});
  }, []);

  return (
    <>
      <PageTitle
        title="Policy Lab"
        subtitle="Would this rule work? Paste proposed program language, confirm how it was interpreted, and test it against a modeled data center before anyone operates on it."
        actions={<LinkButton href="/policy-lab/new" variant="primary">New policy simulation</LinkButton>}
      />
      {error && <p className="text-risk">{error}</p>}

      <div className="grid grid-cols-[1fr_400px] gap-4">
        <Card title="Policies">
          {rows.length === 0 ? (
            <Empty title="No policies yet" body="Start a simulation to interpret your first rule." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th className={th}>Policy</th>
                  <th className={th}>Versions</th>
                  <th className={th}>Latest status</th>
                  <th className={th}>Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ policy, versions }) => {
                  const latest = versions.at(-1);
                  return (
                    <tr key={policy.id} className="transition-colors duration-150 ease-out hover:bg-beige/60">
                      <td className={td}>
                        <div className="font-medium">{policy.name}</div>
                        <div className="mt-0.5 max-w-[48ch] truncate text-xs text-muted">{policy.source_text}</div>
                      </td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1">
                          {versions.map((v) => (
                            <Link key={v.id} href={`/programs/${v.id}`} className="mono text-xs text-teal hover:underline">v{v.version}</Link>
                          ))}
                        </div>
                      </td>
                      <td className={td}>{latest ? <PolicyStatusBadge status={latest.status} /> : "—"}</td>
                      <td className={`${td} text-muted`}>{dateTime(policy.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <Card title="Recent simulations">
          {sims.length === 0 ? (
            <p className="text-muted">No simulation runs yet.</p>
          ) : (
            <ul className="space-y-2">
              {sims.slice(0, 10).map((s) => (
                <li key={s.id} className="flex items-center justify-between text-[13px]">
                  <Link href={`/policy-lab/${s.id}`} className="mono text-xs text-teal hover:underline">{s.id}</Link>
                  <span className="num text-muted">{s.expected_reduction_mw.toFixed(2)} / {s.target_reduction_mw.toFixed(2)} MW</span>
                  <Badge tone={s.result_status === "FEASIBLE" ? "success" : s.result_status === "INFEASIBLE" ? "risk" : "signal"}>{s.result_status.replace(/_/g, " ")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
