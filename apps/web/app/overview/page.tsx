"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { mw, pct, minutes, dateTime, humanClass } from "@/lib/format";
import type { Overview } from "@/lib/types";
import { useTelemetry } from "@/lib/useTelemetry";
import { PowerChart } from "@/components/PowerChart";
import { Card, EventStatusBadge, LinkButton, Metric, PageTitle } from "@/components/ui";

export default function OverviewPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.overview().then(setOv).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const { samples } = useTelemetry(180, () => load());
  const live = samples.at(-1)?.facility_power_mw ?? ov?.current_load_mw;

  if (error) return <p className="text-risk">Backend unreachable: {error}. Start the API on port 8000.</p>;
  if (!ov) return <p className="text-muted">Loading site…</p>;

  const total = ov.protected_load_mw + ov.flexible_load_mw;
  const flexShare = total ? (ov.flexible_load_mw / total) * 100 : 0;
  const rule = ov.active_policy_version?.structured_rule;
  const cluster = ov.clusters[0];
  const lastVer = ov.last_verification;

  return (
    <>
      <PageTitle
        title={ov.site.name}
        subtitle={`${ov.site.region} · ${ov.workload_count} workloads · PUE ${ov.site.pue.toFixed(2)} (demo assumption)`}
        actions={<LinkButton href="/live-ops" variant="primary">Open Live Ops</LinkButton>}
      />

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <Metric label="Current facility demand" value={live?.toFixed(2) ?? "—"} unit="MW" size="lg" hint="live telemetry" />
        </Card>
        <Card>
          <Metric label="Flexible load" value={ov.flexible_load_mw.toFixed(2)} unit="MW" size="lg" hint={`${pct(flexShare)} of IT load can move`} />
        </Card>
        <Card>
          <Metric label="Protected load" value={ov.protected_load_mw.toFixed(2)} unit="MW" size="lg" hint="never touched by any plan" />
        </Card>
        <Card>
          <div className="text-xs text-muted">Active grid event</div>
          {ov.active_event ? (
            <div className="mt-2">
              <EventStatusBadge status={ov.active_event.status} />
              <div className="num mt-2 text-lg font-semibold">{mw(ov.active_event.target_reduction_mw)} target</div>
              <Link href="/live-ops" className="text-xs text-teal hover:underline">Go to Live Ops</Link>
            </div>
          ) : (
            <div className="mt-2">
              <div className="text-lg font-semibold">None</div>
              <div className="mt-1.5 text-xs text-muted">Site is in normal operation</div>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Card className="col-span-2" title="Facility power, last 3 minutes">
          <PowerChart samples={samples} />
        </Card>
        <Card title="Flexibility composition">
          <div className="flex h-6 w-full overflow-hidden rounded">
            <div className="bg-ink" style={{ width: `${100 - flexShare}%` }} title="Protected" />
            <div className="bg-aqua" style={{ width: `${flexShare}%` }} title="Flexible" />
          </div>
          <dl className="mt-4 space-y-3 text-[13px]">
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-ink" />Protected</dt>
              <dd className="num font-medium">{mw(ov.protected_load_mw)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-aqua" />Flexible</dt>
              <dd className="num font-medium">{mw(ov.flexible_load_mw)}</dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3">
              <dt className="text-muted">Modeled IT load</dt>
              <dd className="num font-medium">{mw(ov.it_load_mw)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted">
            Flexible load is what the operator has marked as eligible to throttle, suspend, or delay. Protected load is a hard gate in code.
          </p>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <Card title="Active program" aside={<Link href="/programs" className="text-xs text-teal hover:underline">Registry</Link>}>
          {rule && ov.active_policy_version ? (
            <>
              <div className="font-medium">{ov.active_policy?.name}</div>
              <div className="mono mt-0.5 text-xs text-muted">{ov.active_policy_version.id} · v{ov.active_policy_version.version} · ACTIVE</div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                <dt className="text-muted">Reduction</dt>
                <dd className="num">{rule.reduction_target.type === "percent_of_baseline" ? `${rule.reduction_target.value}% of baseline` : mw(rule.reduction_target.value)}</dd>
                <dt className="text-muted">Duration</dt>
                <dd>up to {minutes(rule.duration_minutes)}</dd>
                <dt className="text-muted">Approval</dt>
                <dd>{rule.operator_approval_required ? "manual" : "automatic"}</dd>
                <dt className="text-muted">Protected</dt>
                <dd>{rule.protected_workload_classes.map(humanClass).join(", ") || "—"}</dd>
              </dl>
            </>
          ) : (
            <p className="text-muted">No active program is mapped to this site.</p>
          )}
        </Card>
        <Card title="Last event result" aside={ov.last_completed_event && <Link href={`/events/${ov.last_completed_event.id}`} className="text-xs text-teal hover:underline">Record</Link>}>
          {lastVer && ov.last_completed_event ? (
            <>
              <div className="flex items-baseline justify-between">
                <Metric label="Verified reduction" value={lastVer.verified_reduction_mw?.toFixed(2) ?? "—"} unit="MW" />
                <span className={`mono text-[11px] ${lastVer.target_met ? "text-success" : "text-risk"}`}>
                  {lastVer.target_met ? "TARGET MET" : "SHORTFALL"}
                </span>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                <dt className="text-muted">Target</dt><dd className="num">{mw(lastVer.target_reduction_mw)}</dd>
                <dt className="text-muted">Expected</dt><dd className="num">{mw(lastVer.expected_reduction_mw)}</dd>
                <dt className="text-muted">Critical impacted</dt><dd className="num">{lastVer.critical_workloads_impacted}</dd>
                <dt className="text-muted">Completed</dt><dd>{dateTime(ov.last_completed_event.completed_at)}</dd>
              </dl>
            </>
          ) : (
            <p className="text-muted">No completed events yet. Run one from Live Ops.</p>
          )}
        </Card>
        <Card title="Cluster health">
          {cluster ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-muted">Cluster</dt><dd>{cluster.name}</dd>
              <dt className="text-muted">Adapter</dt><dd className="mono text-xs">{cluster.adapter_type}</dd>
              <dt className="text-muted">Status</dt>
              <dd className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${cluster.status === "connected" ? "bg-success" : "bg-risk"}`} />{cluster.status}</dd>
              <dt className="text-muted">Observe</dt><dd>{cluster.observe_enabled ? "granted" : "not granted"}</dd>
              <dt className="text-muted">Actuate</dt><dd>{cluster.actuation_enabled ? "granted" : "not granted"}</dd>
              <dt className="text-muted">Last seen</dt><dd>{dateTime(cluster.last_seen_at)}</dd>
            </dl>
          ) : (
            <p className="text-muted">No cluster connected.</p>
          )}
        </Card>
      </div>
    </>
  );
}
