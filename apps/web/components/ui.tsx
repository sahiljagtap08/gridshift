import Link from "next/link";
import type { ActionStatus, EventStatus, PolicyVersionStatus, WorkloadState } from "@/lib/types";

export function Card({
  children,
  className = "",
  title,
  aside,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  aside?: React.ReactNode;
}) {
  return (
    <section className={`rounded-lg border border-border bg-surface ${className}`}>
      {(title || aside) && (
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
          {aside}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageTitle({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-end justify-between gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-[70ch] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-[13px] font-medium transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50";
const buttonVariants = {
  primary: "bg-teal-dark text-white hover:bg-[#274450] active:bg-[#1f3740]",
  secondary: "border border-border-strong bg-surface text-ink hover:bg-beige active:bg-[#dedecf]",
  danger: "border border-risk/40 bg-surface text-risk hover:bg-[#f4e6e4] active:bg-[#eed9d6]",
  ghost: "text-muted hover:bg-beige hover:text-ink",
};

export function Button({ variant = "secondary", className = "", ...rest }: ButtonProps) {
  return <button className={`${buttonBase} ${buttonVariants[variant]} ${className}`} {...rest} />;
}

export function LinkButton({
  href,
  variant = "secondary",
  className = "",
  children,
}: {
  href: string;
  variant?: keyof typeof buttonVariants;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={`${buttonBase} ${buttonVariants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

const tone = {
  neutral: "bg-beige text-ink",
  teal: "bg-[#dcebe9] text-teal-dark",
  success: "bg-[#dcefe3] text-success",
  signal: "bg-[#f3efb9] text-signal-ink",
  risk: "bg-[#f1dedb] text-risk",
  ink: "bg-ink text-white",
};

export function Badge({ children, tone: t = "neutral" }: { children: React.ReactNode; tone?: keyof typeof tone }) {
  return (
    <span className={`mono inline-block rounded px-1.5 py-0.5 text-[11px] tracking-wide ${tone[t]}`}>
      {children}
    </span>
  );
}

export function flexibilityBadge(w: { protected: boolean; allowed_actions: string[] }) {
  if (w.protected) return <Badge tone="ink">PROTECTED</Badge>;
  const badges: React.ReactNode[] = [];
  if (w.allowed_actions.includes("throttle")) badges.push(<Badge key="t" tone="teal">THROTTLE</Badge>);
  if (w.allowed_actions.includes("suspend")) badges.push(<Badge key="s" tone="teal">SUSPEND</Badge>);
  if (w.allowed_actions.includes("defer")) badges.push(<Badge key="d" tone="teal">DELAY</Badge>);
  return <span className="flex flex-wrap gap-1">{badges.length ? badges : <Badge>NONE</Badge>}</span>;
}

export function stateBadge(state: WorkloadState, throttle = 0) {
  switch (state) {
    case "running":
      return <Badge tone="success">RUNNING</Badge>;
    case "throttled":
      return <Badge tone="signal">THROTTLED {Math.round((1 - throttle) * 100)}%</Badge>;
    case "suspended":
      return <Badge tone="signal">SUSPENDED</Badge>;
    case "deferred":
    case "queued":
      return <Badge tone="signal">DEFERRED</Badge>;
  }
}

export const eventTone: Record<EventStatus, keyof typeof tone> = {
  RECEIVED: "neutral",
  PLANNING: "neutral",
  AWAITING_APPROVAL: "signal",
  EXECUTING: "teal",
  VERIFYING: "teal",
  TARGET_MET: "success",
  PARTIAL_EXECUTION: "signal",
  RESTORING: "teal",
  COMPLETED: "success",
  CANCELLED: "neutral",
  FAILED: "risk",
  REQUIRES_OPERATOR: "signal",
  BLOCKED: "risk",
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  return <Badge tone={eventTone[status]}>{status.replace(/_/g, " ")}</Badge>;
}

export function ActionStatusBadge({ status }: { status: ActionStatus }) {
  const t: Record<ActionStatus, keyof typeof tone> = {
    PENDING: "neutral",
    EXECUTING: "teal",
    SUCCEEDED: "success",
    FAILED: "risk",
    RESTORED: "neutral",
  };
  return <Badge tone={t[status]}>{status}</Badge>;
}

export function Metric({
  label,
  value,
  unit,
  hint,
  size = "md",
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  size?: "md" | "lg" | "xl";
}) {
  const sizes = { md: "text-2xl", lg: "text-4xl", xl: "text-6xl" };
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-1 font-semibold leading-none tracking-tight ${sizes[size]}`}>
        {value}
        {unit && <span className="ml-1 text-[0.5em] font-medium text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Table({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export const th = "px-3 py-2 text-left text-xs font-medium text-muted border-b border-border whitespace-nowrap";
export const td = "px-3 py-2.5 border-b border-border align-top";

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong px-6 py-12 text-center">
      <div className="font-medium">{title}</div>
      <p className="mx-auto mt-1 max-w-[50ch] text-muted">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-md border border-risk/40 bg-[#f7ecea] px-4 py-3 text-[13px] text-risk">
      {message}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-[13px] text-ink transition-colors duration-150 ease-out hover:border-muted focus:border-teal disabled:bg-beige/50";

const policyTone: Record<PolicyVersionStatus, keyof typeof tone> = {
  AI_INTERPRETED: "signal",
  HUMAN_CONFIRMED: "teal",
  SIMULATED: "teal",
  EXTERNALLY_APPROVED: "teal",
  ACTIVE: "success",
  RETIRED: "neutral",
};

export function PolicyStatusBadge({ status }: { status: PolicyVersionStatus }) {
  return <Badge tone={policyTone[status]}>{status.replace(/_/g, " ")}</Badge>;
}
