export type Criticality = "critical" | "high" | "medium" | "low";
export type ActionType = "suspend" | "throttle" | "defer" | "none";
export type WorkloadState = "running" | "throttled" | "suspended" | "deferred" | "queued";

export interface Workload {
  id: string;
  cluster_id: string;
  name: string;
  scheduler_kind: string;
  namespace: string | null;
  workload_type: string;
  nominal_power_mw: number;
  current_power_mw: number;
  min_power_mw: number;
  criticality: Criticality;
  protected: boolean;
  checkpointable: boolean;
  max_pause_minutes: number;
  max_throttle_percent: number;
  deadline_at: string | null;
  allowed_actions: ActionType[];
  state: WorkloadState;
  throttle_percent: number;
  generation: number;
  owner: string | null;
  labels: Record<string, string>;
  last_seen_at: string | null;
}

export interface FlexibilityUpdate {
  protected?: boolean;
  criticality?: Criticality;
  checkpointable?: boolean;
  max_pause_minutes?: number;
  max_throttle_percent?: number;
  deadline_at?: string | null;
  allowed_actions?: ActionType[];
  owner?: string | null;
}

export type EventStatus =
  | "RECEIVED"
  | "PLANNING"
  | "AWAITING_APPROVAL"
  | "EXECUTING"
  | "VERIFYING"
  | "TARGET_MET"
  | "PARTIAL_EXECUTION"
  | "RESTORING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED"
  | "REQUIRES_OPERATOR"
  | "BLOCKED";

export type PlanStatus =
  | "DRAFT"
  | "AWAITING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"
  | "SUPERSEDED"
  | "INFEASIBLE";

export type ActionStatus = "PENDING" | "EXECUTING" | "SUCCEEDED" | "FAILED" | "RESTORED";

export interface EventTarget {
  type: "percent" | "mw";
  value: number;
}

export interface GridEvent {
  id: string;
  site_id: string;
  cluster_id: string;
  policy_version_id: string;
  source: string;
  external_event_id: string | null;
  target: EventTarget;
  baseline_mw: number;
  target_reduction_mw: number;
  duration_minutes: number;
  response_time_minutes: number;
  status: EventStatus;
  active_plan_id: string | null;
  plan_ids: string[];
  verification_id: string | null;
  simulate_under_delivery: boolean;
  received_at: string;
  started_at: string | null;
  target_met_at: string | null;
  ended_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
}

export interface Action {
  id: string;
  action_plan_id: string;
  workload_id: string;
  workload_name: string;
  action_type: ActionType;
  parameters: Record<string, unknown>;
  expected_reduction_mw: number;
  reason: string;
  user_impact: string;
  recovery: string;
  status: ActionStatus;
  executed_at: string | null;
  restored_at: string | null;
  result: Record<string, unknown> | null;
}

export interface ActionPlan {
  id: string;
  grid_event_id: string;
  round: number;
  workload_snapshot_hash: string;
  workload_snapshot: Record<string, number>;
  target_reduction_mw: number;
  expected_reduction_mw: number;
  disruption_score: number;
  status: PlanStatus;
  actions: Action[];
  protected_workload_ids: string[];
  infeasible_reason: string | null;
  created_at: string;
}

export interface Approval {
  id: string;
  action_plan_id: string;
  plan_hash: string;
  user_id: string;
  decision: "approve" | "reject";
  comment: string | null;
  created_at: string;
}

export interface TelemetrySample {
  site_id: string;
  cluster_id: string;
  it_power_mw: number;
  facility_power_mw: number;
  timestamp: string;
  per_workload_mw: Record<string, number>;
}

export interface VerificationRecord {
  id: string;
  grid_event_id: string;
  baseline_method: string;
  baseline_mw: number;
  actual_mw: number | null;
  target_reduction_mw: number;
  expected_reduction_mw: number;
  verified_reduction_mw: number | null;
  target_met: boolean | null;
  status: "VERIFIED" | "UNVERIFIED";
  critical_workloads_impacted: number;
  deadline_misses: number;
  actions_executed: number;
  calculation: Record<string, unknown>;
  created_at: string;
}

export interface TimelineEntry {
  at: string;
  event_id: string;
  kind: string;
  message: string;
  data: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  actor_type: string;
  actor_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Site {
  id: string;
  name: string;
  region: string;
  facility_power_capacity_mw: number;
  pue: number;
  created_at: string;
}

export interface Cluster {
  id: string;
  site_id: string;
  name: string;
  adapter_type: "mock" | "kubernetes";
  observe_enabled: boolean;
  actuation_enabled: boolean;
  status: "connected" | "disconnected" | "error";
  capabilities: string[];
  last_seen_at: string | null;
  created_at: string;
}

export type PolicyVersionStatus =
  | "AI_INTERPRETED"
  | "HUMAN_CONFIRMED"
  | "SIMULATED"
  | "EXTERNALLY_APPROVED"
  | "ACTIVE"
  | "RETIRED";

export type WorkloadClass =
  | "critical_inference"
  | "safety_systems"
  | "platform_services"
  | "training"
  | "batch"
  | "evaluation"
  | "embeddings"
  | "synthetic_data"
  | "internal_inference";

export const WORKLOAD_CLASSES: WorkloadClass[] = [
  "critical_inference",
  "safety_systems",
  "platform_services",
  "training",
  "batch",
  "evaluation",
  "embeddings",
  "synthetic_data",
  "internal_inference",
];

export type TriggerType =
  | "declared_grid_stress_event"
  | "utility_dispatch"
  | "price_signal"
  | "scheduled_window"
  | "unspecified";

export const TRIGGER_TYPES: TriggerType[] = [
  "declared_grid_stress_event",
  "utility_dispatch",
  "price_signal",
  "scheduled_window",
  "unspecified",
];

export interface PolicyRule {
  reduction_target: { type: "percent_of_baseline" | "absolute_mw"; value: number };
  duration_minutes: number | null;
  response_time_minutes: number | null;
  trigger: { type: TriggerType; description: string | null };
  protected_workload_classes: WorkloadClass[];
  flexible_workload_classes: WorkloadClass[];
  allowed_actions: Array<"suspend" | "throttle" | "defer">;
  operator_approval_required: boolean;
  ambiguities: Array<{ field: string; reason: string }>;
  summary: string;
}

export interface Policy {
  id: string;
  organization_id?: string;
  name: string;
  source_type?: string;
  source_text: string;
  created_by?: string;
  created_at: string;
}

export interface PolicyVersion {
  id: string;
  policy_id: string;
  version: number;
  structured_rule: PolicyRule;
  status: PolicyVersionStatus;
  interpretation_model: string;
  foundry_trace_id: string | null;
  foundry_request_id: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  external_reference: string | null;
  created_at: string;
}

export interface SimulationPlanAction {
  workload_id: string;
  workload_name: string;
  action_type: ActionType;
  parameters: Record<string, unknown>;
  expected_reduction_mw: number;
  reason: string;
  user_impact: string;
  recovery: string;
}

export interface SimulationExclusion {
  workload_id: string;
  workload_name: string;
  action_type: string;
  reason: string;
}

export interface SimulationRun {
  id: string;
  policy_version_id: string;
  site_id: string;
  scenario: string;
  input_snapshot: Record<string, unknown>;
  plan: { actions: SimulationPlanAction[]; exclusions: SimulationExclusion[] } | null;
  result_status: "FEASIBLE" | "CONDITIONALLY_FEASIBLE" | "INFEASIBLE";
  baseline_mw: number;
  target_reduction_mw: number;
  expected_reduction_mw: number;
  critical_workloads_affected: number;
  flexible_workloads_modified: number;
  constraints_respected: string[];
  risks: string[];
  failure_conditions: string[];
  sensitivity: Array<{
    duration_minutes: number;
    reduction_percent: number;
    status: string;
    expected_reduction_mw: number;
  }>;
  created_at: string;
}

export interface EventDetail {
  event: GridEvent;
  plans: ActionPlan[];
  active_plan: ActionPlan | null;
  verification: VerificationRecord | null;
  approvals: Approval[];
  timeline: TimelineEntry[];
  policy_version: PolicyVersion | null;
  workloads: Workload[];
}

export interface Overview {
  site: Site;
  current_load_mw: number;
  it_load_mw: number;
  protected_load_mw: number;
  flexible_load_mw: number;
  workload_count: number;
  clusters: Cluster[];
  active_event: GridEvent | null;
  last_completed_event: GridEvent | null;
  last_verification: VerificationRecord | null;
  active_policy_version: PolicyVersion | null;
  active_policy: Policy | null;
}

export type StreamMessage =
  | { type: "telemetry"; sample: TelemetrySample }
  | {
      type: "event";
      event_id: string;
      status: EventStatus;
      kind: string;
      message: string;
      data: Record<string, unknown>;
    };
