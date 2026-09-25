"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { mw, pct, minutes, clock } from "@/lib/format";
import type { EventDetail, Overview, StreamMessage, TelemetrySample, Workload } from "@/lib/types";
import { useTelemetry } from "@/lib/useTelemetry";
import { EventModal } from "@/components/EventModal";
import { PlanTable } from "@/components/PlanTable";
import { PowerChart } from "@/components/PowerChart";
import { Timeline } from "@/components/Timeline";
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  EventStatusBadge,
  LinkButton,
  Metric,
  PageTitle,
  Table,
  flexibilityBadge,
  stateBadge,
  td,
  th,
} from "@/components/ui";

const LIVE_STATES = new Set(["EXECUTING", "VERIFYING", "TARGET_MET", "RESTORING", "COMPLETED"]);
const STUCK_STATES = new Set(["REQUIRES_OPERATOR", "BLOCKED", "PARTIAL_EXECUTION", "FAILED", "CANCELLED"]);

export default function LiveOpsPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [workloads, setWorkloads] = useState<Workload[]>([]);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventIdRef = useRef<string | null>(null);

  const refreshEvent = useCallback(async (id: string) => {
    try {
      const d = await api.event(id);
      setDetail(d);
      setWorkloads(d.workloads);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const refreshOverview = useCallback(async () => {
    try {
      const o = await api.overview();
      setOv(o);
      setWorkloads(await api.workloads());
      if (o.active_event && o.active_event.id !== eventIdRef.current) {
        eventIdRef.current = o.active_event.id;
        await refreshEvent(o.active_event.id);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [refreshEvent]);

  useEffect(() => {
    void Promise.resolve().then(refreshOverview);
  }, [refreshOverview]);

  const onEvent = useCallback(
    (msg: Extract<StreamMessage, { type: "event" }>) => {
      if (msg.event_id === eventIdRef.current) refreshEvent(msg.event_id);
    },
    [refreshEvent],
  );
  const { samples } = useTelemetry(240, onEvent);
  const live = samples.at(-1)?.facility_power_mw ?? ov?.current_load_mw ?? null;

  async function act(label: string, fn: () => Promise<EventDetail>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const d = await fn();
      eventIdRef.current = d.event.id;
      setDetail(d);
      setWorkloads(d.workloads);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && (e.detail as { new_plan_id?: string })?.new_plan_id) {
        setNotice("Workloads changed since planning. The plan was rebuilt against the current snapshot; review it again.");
        if (eventIdRef.current) await refreshEvent(eventIdRef.current);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(null);
    }
  }

  function clearToIdle() {
    eventIdRef.current = null;
    setDetail(null);
    refreshOverview();
  }

  async function resetDemo() {
    setBusy("reset");
    try {
      await api.resetDemo();
      eventIdRef.current = null;
      setDetail(null);
      setNotice(null);
      await refreshOverview();
    } finally {
      setBusy(null);
    }
  }

  const ev = detail?.event;
  const plan = detail?.active_plan ?? null;
  const policyName = ov?.active_policy?.name ?? "No active program";

  return (
    <>
      <PageTitle
        title="Live Ops"
        subtitle="Receive a grid event, review the least-disruptive plan, approve it, and verify the megawatts actually moved."
        actions={
          !ev || ev.status === "COMPLETED" || ev.status === "CANCELLED" ? (
            <Button variant="primary" onClick={() => setModal(true)} disabled={!ov}>
              Simulate grid event
            </Button>
          ) : null
        }
      />

      {error && <div className="mb-4"><ErrorNote message={error} /></div>}
      {notice && (
        <div className="mb-4 rounded-md border border-signal bg-[#f7f4cf] px-4 py-3 text-[13px] text-signal-ink">{notice}</div>
      )}

      {!ev && <IdleView live={live} workloads={workloads} />}

      {ev && ev.status === "AWAITING_APPROVAL" && plan && (
        <ApprovalView
          detail={detail!}
          busy={busy}
          onApprove={() => act("approve", () => api.approvePlan(plan.id))}
          onReject={() => act("reject", () => api.rejectPlan(plan.id, "rejected by operator"))}
        />
      )}

      {ev && (ev.status === "RECEIVED" || ev.status === "PLANNING") && (
        <Card><p className="text-muted">Snapshot frozen; building plan…</p></Card>
      )}

      {ev && STUCK_STATES.has(ev.status) && (
        <StuckView
          detail={detail!}
          busy={busy}
          onEnd={() => act("end", () => api.endEvent(ev.id))}
          onCancel={() => act("cancel", () => api.cancelEvent(ev.id))}
          onNew={clearToIdle}
        />
      )}

      {ev && LIVE_STATES.has(ev.status) && (
        <ExecutionView
          detail={detail!}
          samples={samples}
          workloads={workloads}
          busy={busy}
          onEnd={() => act("end", () => api.endEvent(ev.id))}
          onNew={clearToIdle}
        />
      )}

      <div className="mt-8 flex items-center justify-between border-t border-border pt-4 text-xs text-muted">
        <span>Demo controls · seeded simulator, PUE 1.0, event window compressed for the demo</span>
        <Button variant="ghost" onClick={resetDemo} disabled={busy === "reset"}>Reset demo</Button>
      </div>

      {modal && (
        <EventModal
          policy={ov?.active_policy_version ?? null}
          policyName={policyName}
          onClose={() => setModal(false)}
          onCreated={(d) => {
            setModal(false);
            eventIdRef.current = d.event.id;
            setDetail(d);
            setWorkloads(d.workloads);
          }}
        />
      )}
    </>
  );
}

/* ---------------------------------------------------------------- idle */

function IdleView({ live, workloads }: { live: number | null; workloads: Workload[] }) {
  const protectedMw = workloads.filter((w) => w.protected).reduce((s, w) => s + w.current_power_mw, 0);
  const flexibleMw = workloads.filter((w) => !w.protected).reduce((s, w) => s + w.current_power_mw, 0);
  return (
    <>
      <Card>
        <div className="flex items-end justify-between">
          <Metric label="Current facility demand" value={live?.toFixed(1) ?? "—"} unit="MW" size="xl" hint="live from cluster telemetry" />
          <dl className="grid grid-cols-2 gap-x-8 text-right">
            <dt className="text-xs text-muted">Protected</dt>
            <dt className="text-xs text-muted">Flexible</dt>
            <dd className="num text-xl font-semibold">{mw(protectedMw, 1)}</dd>
            <dd className="num text-xl font-semibold">{mw(flexibleMw, 1)}</dd>
          </dl>
        </div>
      </Card>
      <Card className="mt-4" title="Workloads on this cluster" aside={<Link href="/workloads" className="text-xs text-teal hover:underline">Edit flexibility</Link>}>
        <WorkloadTable workloads={workloads} />
      </Card>
    </>
  );
}

function WorkloadTable({ workloads, highlight }: { workloads: Workload[]; highlight?: Set<string> }) {
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Workload</th>
          <th className={th}>State</th>
          <th className={`${th} text-right`}>Power</th>
          <th className={th}>Criticality</th>
          <th className={th}>Flexibility</th>
          <th className={th}>Deadline</th>
        </tr>
      </thead>
      <tbody>
        {workloads.map((w) => (
          <tr key={w.id} className={highlight?.has(w.id) ? "bg-[#f3efb9]/40 transition-colors duration-300 ease-out" : "transition-colors duration-300 ease-out"}>
            <td className={`${td} font-medium`}>{w.name}<span className="mono ml-2 text-xs text-muted">{w.workload_type}</span></td>
            <td className={td}>{stateBadge(w.state, w.throttle_percent)}</td>
            <td className={`${td} num text-right`}>{mw(w.current_power_mw)}</td>
            <td className={td}>{w.criticality}</td>
            <td className={td}>{flexibilityBadge(w)}</td>
            <td className={`${td} text-muted`}>{w.deadline_at ? clock(w.deadline_at) : "continuous"}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/* ------------------------------------------------------------ approval */

function ApprovalView({
  detail,
  busy,
  onApprove,
  onReject,
}: {
  detail: EventDetail;
  busy: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { event, active_plan: plan, workloads } = detail;
  if (!plan) return null;
  const protectedWs = workloads.filter((w) => plan.protected_workload_ids.includes(w.id));
  const share = event.baseline_mw ? (plan.expected_reduction_mw / event.baseline_mw) * 100 : 0;
  const isReplan = plan.round > 1;

  return (
    <div className="rounded-lg border border-border bg-surface">
      {isReplan && (
        <div className="border-b border-signal bg-[#f7f4cf] px-6 py-3 text-[13px] text-signal-ink">
          Replan round {plan.round}: covering a {mw(plan.target_reduction_mw)} shortfall measured after the previous round.
        </div>
      )}
      <div className="grid grid-cols-[240px_1fr_240px]">
        <div className="border-r border-border p-6">
          <div className="mono text-[11px] tracking-wide text-muted">GRID EVENT</div>
          <div className="num mt-3 text-4xl font-semibold leading-none">
            {event.target.type === "percent" ? `${event.target.value}%` : mw(event.target.value, 1)}
          </div>
          <div className="mt-1 text-muted">reduction · {mw(event.target_reduction_mw)}</div>
          <dl className="mt-6 space-y-3 text-[13px]">
            <div><dt className="text-xs text-muted">Duration</dt><dd className="font-medium">{minutes(event.duration_minutes)}</dd></div>
            <div><dt className="text-xs text-muted">Response needed in</dt><dd className="font-medium">{event.response_time_minutes} min</dd></div>
            <div><dt className="text-xs text-muted">Baseline</dt><dd className="num font-medium">{mw(event.baseline_mw)}</dd></div>
            <div><dt className="text-xs text-muted">Program</dt><dd className="mono text-xs">{event.policy_version_id}</dd></div>
          </dl>
        </div>

        <div className="p-6">
          <h2 className="text-[13px] font-semibold">Plan · what will change</h2>
          <div className="mt-3">
            <PlanTable actions={plan.actions} />
          </div>
          <div className="mt-5 rounded-md border border-border bg-beige/50 px-4 py-3">
            <div className="text-xs text-muted">Not touched</div>
            <ul className="mt-1 space-y-1 text-[13px]">
              {protectedWs.map((w) => (
                <li key={w.id} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">{w.name} <Badge tone="ink">PROTECTED</Badge></span>
                  <span className="num">{mw(w.current_power_mw)}</span>
                </li>
              ))}
            </ul>
          </div>
          {(plan.exclusions ?? []).filter((e) => !plan.protected_workload_ids.includes(e.workload_id)).length > 0 && (
            <div className="mt-3 rounded-md border border-border px-4 py-3">
              <div className="text-xs text-muted">Not eligible for this event</div>
              <ul className="mt-1 space-y-1 text-[13px]">
                {(plan.exclusions ?? [])
                  .filter((e) => !plan.protected_workload_ids.includes(e.workload_id))
                  .map((e) => (
                    <li key={`${e.workload_id}-${e.action_type}`} className="flex items-baseline justify-between gap-4">
                      <span>{e.workload_name} <span className="mono text-[11px] text-muted">{e.action_type}</span></span>
                      <span className="text-right text-xs text-muted">{e.reason}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-l border-border p-6">
          <div className="mono text-[11px] tracking-wide text-muted">EXPECTED</div>
          <div className="num mt-3 text-4xl font-semibold leading-none">{plan.expected_reduction_mw.toFixed(2)}</div>
          <div className="mt-1 text-muted">MW reduction (modeled)</div>
          <dl className="mt-6 space-y-3 text-[13px]">
            <div><dt className="text-xs text-muted">Share of baseline</dt><dd className="num font-medium">{pct(share)}</dd></div>
            <div><dt className="text-xs text-muted">Critical workloads affected</dt><dd className="num font-medium text-success">0</dd></div>
            <div><dt className="text-xs text-muted">Actions</dt><dd className="num font-medium">{plan.actions.length}</dd></div>
            <div><dt className="text-xs text-muted">Snapshot</dt><dd className="mono text-xs">{plan.workload_snapshot_hash}</dd></div>
          </dl>
        </div>
      </div>
      <footer className="flex items-center justify-between border-t border-border px-6 py-4">
        <span className="text-xs text-muted">Approval is bound to this exact plan and workload snapshot. If anything changes, you will be asked again.</span>
        <div className="flex gap-2">
          <Button variant="danger" onClick={onReject} disabled={busy !== null}>Reject</Button>
          <Button variant="primary" onClick={onApprove} disabled={busy !== null}>
            {busy === "approve" ? "Approving…" : "Approve & execute"}
          </Button>
        </div>
      </footer>
    </div>
  );
}

/* --------------------------------------------------------------- stuck */

function StuckView({
  detail,
  busy,
  onEnd,
  onCancel,
  onNew,
}: {
  detail: EventDetail;
  busy: string | null;
  onEnd: () => void;
  onCancel: () => void;
  onNew: () => void;
}) {
  const { event, timeline, active_plan: plan } = detail;
  const last = timeline.at(-1);
  const canEnd = ["REQUIRES_OPERATOR", "PARTIAL_EXECUTION"].includes(event.status) &&
    detail.plans.some((p) => p.actions.some((a) => a.status === "SUCCEEDED"));
  const terminal = event.status === "CANCELLED" || event.status === "FAILED";
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <EventStatusBadge status={event.status} />
          <h2 className="mt-3 text-lg font-semibold">{last?.message ?? event.status}</h2>
          {plan?.infeasible_reason && <p className="mt-1 max-w-[70ch] text-muted">{plan.infeasible_reason}</p>}
          {event.status === "REQUIRES_OPERATOR" && (
            <p className="mt-2 max-w-[70ch] text-muted">
              GridShift will not claim megawatts it cannot deliver. Lower the target, widen workload flexibility, or cancel the event.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {canEnd && <Button onClick={onEnd} disabled={busy !== null}>End event & restore</Button>}
          {!terminal && <Button variant="danger" onClick={onCancel} disabled={busy !== null}>Cancel event</Button>}
          {terminal && <Button variant="primary" onClick={onNew}>Start new event</Button>}
        </div>
      </div>
      {plan && plan.actions.length > 0 && (
        <div className="mt-5"><PlanTable actions={plan.actions} showStatus /></div>
      )}
      <div className="mt-6"><Timeline entries={timeline} /></div>
    </Card>
  );
}

/* ----------------------------------------------------------- execution */

function ExecutionView({
  detail,
  samples,
  workloads,
  busy,
  onEnd,
  onNew,
}: {
  detail: EventDetail;
  samples: TelemetrySample[];
  workloads: Workload[];
  busy: string | null;
  onEnd: () => void;
  onNew: () => void;
}) {
  const { event, verification, timeline, plans } = detail;
  const since = event.received_at ? new Date(event.received_at).getTime() - 30_000 : 0;
  const window = samples.filter((s) => new Date(s.timestamp).getTime() >= since);
  const expected = plans
    .filter((p) => p.status === "EXECUTED")
    .flatMap((p) => p.actions)
    .filter((a) => a.status === "SUCCEEDED" || a.status === "RESTORED")
    .reduce((s, a) => s + a.expected_reduction_mw, 0);
  const measured = verification?.verified_reduction_mw ?? null;
  const margin = measured != null ? measured - event.target_reduction_mw : null;
  const touched = new Set(plans.flatMap((p) => p.actions).map((a) => a.workload_id));
  const targetLine = event.baseline_mw - event.target_reduction_mw;

  const pill = (() => {
    switch (event.status) {
      case "TARGET_MET":
        return <span className="mono rounded-md bg-success px-3 py-1.5 text-[12px] tracking-wide text-white">TARGET MET</span>;
      case "RESTORING":
        return <span className="mono rounded-md bg-teal px-3 py-1.5 text-[12px] tracking-wide text-white">RESTORING</span>;
      case "COMPLETED":
        return <span className="mono rounded-md bg-ink px-3 py-1.5 text-[12px] tracking-wide text-white">COMPLETED</span>;
      case "VERIFYING":
        return <span className="mono rounded-md bg-teal-dark px-3 py-1.5 text-[12px] tracking-wide text-white">VERIFYING</span>;
      default:
        return <span className="mono rounded-md bg-teal-dark px-3 py-1.5 text-[12px] tracking-wide text-white">EXECUTING</span>;
    }
  })();

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card className="col-span-2" title="Facility power" aside={pill}>
        <PowerChart samples={window} baseline={event.baseline_mw} target={targetLine} height={280} />
        <div className="mt-5 grid grid-cols-4 gap-4 border-t border-border pt-5">
          <Metric label="Target" value={event.target_reduction_mw.toFixed(2)} unit="MW" hint="required reduction" />
          <Metric label="Expected" value={expected.toFixed(2)} unit="MW" hint="modeled, from executed actions" />
          <Metric
            label="Measured"
            value={measured != null ? measured.toFixed(2) : "—"}
            unit={measured != null ? "MW" : undefined}
            hint={verification ? `${verification.status.toLowerCase()} · ${verification.calculation && "samples_used" in verification.calculation ? `${verification.calculation.samples_used} samples` : ""}` : "unverified until telemetry settles"}
          />
          <Metric
            label="Margin"
            value={margin != null ? `${margin >= 0 ? "+" : ""}${margin.toFixed(2)}` : "—"}
            unit={margin != null ? "MW" : undefined}
            hint={margin != null ? (margin >= 0 ? "above target" : "shortfall") : ""}
          />
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
          <span className="text-xs text-muted">
            Expected is a model. Measured comes only from telemetry after actions settle. They are never the same number.
          </span>
          <div className="flex gap-2">
            {event.status === "TARGET_MET" && (
              <Button variant="primary" onClick={onEnd} disabled={busy !== null}>{busy === "end" ? "Ending…" : "End event & restore"}</Button>
            )}
            {event.status === "COMPLETED" && (
              <>
                <LinkButton href={`/events/${event.id}`}>View verification record</LinkButton>
                <Button variant="primary" onClick={onNew}>Start new event</Button>
              </>
            )}
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Workload state">
          <ul className="space-y-2.5">
            {workloads.map((w) => (
              <li key={w.id} className={`flex items-center justify-between rounded-md px-2 py-1.5 transition-colors duration-300 ease-out ${touched.has(w.id) && w.state !== "running" ? "bg-[#f3efb9]/40" : ""}`}>
                <span className="flex min-w-0 items-center gap-2 text-[13px]">
                  {w.name}
                  {w.protected && <Badge tone="ink">PROTECTED</Badge>}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="num text-xs text-muted">{mw(w.current_power_mw)}</span>
                  {stateBadge(w.state, w.throttle_percent)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Event timeline">
          <Timeline entries={timeline} />
        </Card>
      </div>
    </div>
  );
}
