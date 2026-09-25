"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import type { PolicyVersion } from "@/lib/types";
import { RuleCards } from "@/components/RuleCards";
import { Card, PageTitle, PolicyStatusBadge } from "@/components/ui";

export default function ProgramDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [v, setV] = useState<PolicyVersion | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.policyVersion(id).then(setV).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <p className="text-risk">{error}</p>;
  if (!v) return <p className="text-muted">Loading…</p>;

  return (
    <>
      <PageTitle title={v.structured_rule.summary} subtitle={`${v.id} · version ${v.version}`} actions={<PolicyStatusBadge status={v.status} />} />
      <Card title="Structured rule">
        <RuleCards rule={v.structured_rule} />
        {v.structured_rule.ambiguities.length > 0 && (
          <div className="mt-4 rounded-md border border-signal bg-[#f7f4cf] px-4 py-3 text-[13px] text-signal-ink">
            <div className="font-medium">Ambiguities recorded at interpretation</div>
            <ul className="mt-1 list-disc pl-5">
              {v.structured_rule.ambiguities.map((a, i) => <li key={i}><span className="mono text-xs">{a.field}</span>: {a.reason}</li>)}
            </ul>
          </div>
        )}
      </Card>
      <Card className="mt-4" title="Provenance">
        <dl className="grid grid-cols-3 gap-4 text-[13px]">
          <div><dt className="text-xs text-muted">Interpretation model</dt><dd className="mono text-xs">{v.interpretation_model}</dd></div>
          <div><dt className="text-xs text-muted">Foundry request</dt><dd className="mono text-xs">{v.foundry_request_id ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Confirmed by</dt><dd>{v.confirmed_by ?? "—"} {v.confirmed_at && `· ${dateTime(v.confirmed_at)}`}</dd></div>
          <div><dt className="text-xs text-muted">External reference</dt><dd>{v.external_reference ?? "—"}</dd></div>
          <div><dt className="text-xs text-muted">Created</dt><dd>{dateTime(v.created_at)}</dd></div>
        </dl>
      </Card>
    </>
  );
}
