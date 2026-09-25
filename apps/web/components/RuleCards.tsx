import type { PolicyRule } from "@/lib/types";
import { humanClass, minutes, mw } from "@/lib/format";

export function RuleCards({ rule }: { rule: PolicyRule }) {
  const items: Array<[string, React.ReactNode]> = [
    ["Reduction target", rule.reduction_target.type === "percent_of_baseline" ? `${rule.reduction_target.value}% of baseline` : mw(rule.reduction_target.value)],
    ["Duration", minutes(rule.duration_minutes)],
    ["Response time", minutes(rule.response_time_minutes)],
    ["Trigger", humanClass(rule.trigger.type)],
    ["Protected classes", rule.protected_workload_classes.map(humanClass).join(", ") || "none named"],
    ["Flexible classes", rule.flexible_workload_classes.map(humanClass).join(", ") || "none named"],
    ["Allowed actions", rule.allowed_actions.join(", ") || "none named"],
    ["Approval", rule.operator_approval_required ? "manual operator approval" : "automatic"],
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map(([k, v]) => (
        <div key={k} className="rounded-md border border-border px-4 py-3">
          <div className="text-xs text-muted">{k}</div>
          <div className="mt-0.5 font-medium">{v}</div>
        </div>
      ))}
    </div>
  );
}
