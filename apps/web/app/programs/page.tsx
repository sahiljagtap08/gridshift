"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import type { PolicyVersion } from "@/lib/types";
import { Card, Empty, LinkButton, PageTitle, PolicyStatusBadge, Table, td, th } from "@/components/ui";

export default function ProgramsPage() {
  const [rows, setRows] = useState<Array<{ version: PolicyVersion; policy_name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.registry().then(setRows).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageTitle
        title="Programs"
        subtitle="The policy registry. Only ACTIVE versions can drive a live event, and every event links to the immutable version it used."
        actions={<LinkButton href="/policy-lab/new" variant="primary">New policy simulation</LinkButton>}
      />
      {error && <p className="text-risk">{error}</p>}
      {rows.length === 0 && !error ? (
        <Empty title="Registry is empty" body="Interpret and confirm a rule in Policy Lab, then publish it here." />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th className={th}>Program</th>
                <th className={th}>Version</th>
                <th className={th}>Status</th>
                <th className={th}>External reference</th>
                <th className={th}>Rule</th>
                <th className={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ version: v, policy_name }) => (
                <tr key={v.id} className="transition-colors duration-150 ease-out hover:bg-beige/60">
                  <td className={`${td} font-medium`}><Link href={`/programs/${v.id}`} className="hover:underline">{policy_name}</Link></td>
                  <td className={`${td} mono text-xs`}>v{v.version} · {v.id}</td>
                  <td className={td}><PolicyStatusBadge status={v.status} /></td>
                  <td className={`${td} text-muted`}>{v.external_reference ?? "—"}</td>
                  <td className={`${td} max-w-[40ch] text-muted`}>{v.structured_rule.summary}</td>
                  <td className={`${td} text-muted`}>{dateTime(v.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
