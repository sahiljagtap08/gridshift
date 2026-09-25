import type {
  AuditEvent,
  EventDetail,
  EventTarget,
  FlexibilityUpdate,
  GridEvent,
  Overview,
  Policy,
  PolicyRule,
  PolicyVersion,
  SimulationRun,
  TelemetrySample,
  Workload,
} from "./types";

// Direct API URL when set at build time; otherwise the same-origin /backend proxy,
// which reads API_UPSTREAM at runtime (see app/backend/[...path]/route.ts).
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/backend";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(
      typeof detail === "string"
        ? detail
        : ((detail as { message?: string })?.message ?? `Request failed (${status})`),
    );
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(
  path: string,
  init: RequestInit & { idempotent?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.idempotent) headers["Idempotency-Key"] = crypto.randomUUID();
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: "no-store" });
  if (!res.ok) {
    let detail: unknown = res.statusText;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* no body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body: unknown, idempotent = false) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body), idempotent });

export const api = {
  overview: () => request<Overview>("/overview"),
  telemetry: (limit = 180) => request<TelemetrySample[]>(`/telemetry?limit=${limit}`),
  workloads: () => request<Workload[]>("/workloads"),
  updateFlexibility: (id: string, body: FlexibilityUpdate) =>
    request<Workload>(`/workloads/${id}/flexibility`, { method: "PATCH", body: JSON.stringify(body) }),
  events: () => request<GridEvent[]>("/events"),
  event: (id: string) => request<EventDetail>(`/events/${id}`),
  createEvent: (body: {
    target: EventTarget;
    duration_minutes: number;
    response_time_minutes: number;
    policy_version_id: string;
    simulate_under_delivery: boolean;
  }) => post<EventDetail>("/events", body, true),
  approvePlan: (planId: string, userId = "operator_demo") =>
    post<EventDetail>(`/plans/${planId}/approve`, { user_id: userId }, true),
  rejectPlan: (planId: string, comment?: string) =>
    post<EventDetail>(`/plans/${planId}/reject`, { user_id: "operator_demo", comment }),
  endEvent: (id: string) => post<EventDetail>(`/events/${id}/end`, { user_id: "operator_demo" }),
  cancelEvent: (id: string) => post<EventDetail>(`/events/${id}/cancel`, { user_id: "operator_demo" }),
  audit: () => request<AuditEvent[]>("/audit"),
  resetDemo: () => post<{ status: string }>("/demo/reset", {}),

  policies: () => request<Array<{ policy: Policy; versions: PolicyVersion[] }>>("/policies"),
  createPolicy: (body: { name: string; source_text: string }) => post<Policy>("/policies", body),
  interpretPolicy: (id: string) => post<PolicyVersion>(`/policies/${id}/interpret`, {}),
  confirmVersion: (id: string, rule: PolicyRule) =>
    post<PolicyVersion>(`/policy-versions/${id}/confirm`, { structured_rule: rule, confirmed_by: "analyst_demo" }),
  publishVersion: (id: string, external_reference: string) =>
    post<PolicyVersion>(`/policy-versions/${id}/publish`, { external_reference }),
  policyVersion: (id: string) => request<PolicyVersion>(`/policy-versions/${id}`),
  registry: () => request<Array<{ version: PolicyVersion; policy_name: string }>>("/policy-registry"),
  simulations: () => request<SimulationRun[]>("/simulations"),
  simulation: (id: string) => request<SimulationRun>(`/simulations/${id}`),
  runSimulation: (body: { policy_version_id: string; site_id: string; scenario: string }) =>
    post<SimulationRun>("/simulations", body),
};
