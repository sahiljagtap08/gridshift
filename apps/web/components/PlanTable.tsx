import type { Action, SimulationPlanAction } from "@/lib/types";
import { mw } from "@/lib/format";
import { ActionStatusBadge, Table, td, th } from "./ui";

export function describeAction(a: { action_type: string; parameters: Record<string, unknown> }) {
  if (a.action_type === "throttle") {
    const p = Number(a.parameters.throttle_percent ?? 0);
    return `Throttle to ${Math.round((1 - p) * 100)}%`;
  }
  if (a.action_type === "suspend") return "Suspend (checkpoint)";
  if (a.action_type === "defer") return "Delay until after event";
  return a.action_type;
}

export function PlanTable({
  actions,
  showStatus = false,
  compact = false,
}: {
  actions: Array<Action | SimulationPlanAction>;
  showStatus?: boolean;
  compact?: boolean;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Workload</th>
          <th className={th}>Action</th>
          <th className={`${th} text-right`}>Expected</th>
          {!compact && <th className={th}>User impact</th>}
          {!compact && <th className={th}>Recovery</th>}
          <th className={th}>Why</th>
          {showStatus && <th className={th}>Status</th>}
        </tr>
      </thead>
      <tbody>
        {actions.map((a, i) => (
          <tr key={"id" in a ? a.id : `${a.workload_id}-${i}`}>
            <td className={`${td} font-medium`}>{a.workload_name}</td>
            <td className={td}>{describeAction(a)}</td>
            <td className={`${td} num text-right`}>{mw(a.expected_reduction_mw)}</td>
            {!compact && <td className={td}>{a.user_impact}</td>}
            {!compact && <td className={td}>{a.recovery}</td>}
            <td className={`${td} text-muted`}>{a.reason}</td>
            {showStatus && "status" in a && <td className={td}><ActionStatusBadge status={a.status} /></td>}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
