import type { Workload } from "./types";

/** The seeded Virginia AI Campus, used to render the facility when the API is unreachable. */
const base = {
  cluster_id: "cluster_demo",
  scheduler_kind: "mock",
  min_power_mw: 0,
  checkpointable: true,
  max_pause_minutes: 0,
  max_throttle_percent: 0,
  deadline_at: null,
  state: "running" as const,
  throttle_percent: 0,
  generation: 1,
  owner: null,
  last_seen_at: null,
};

export const DEMO_WORKLOADS: Workload[] = [
  { ...base, id: "workload_inference", name: "Production inference", namespace: "prod-inference", workload_type: "Deployment", nominal_power_mw: 3.2, current_power_mw: 3.2, criticality: "critical", protected: true, allowed_actions: ["none"], labels: { class: "critical_inference" } },
  { ...base, id: "workload_training", name: "Model training", namespace: "model-training", workload_type: "Job", nominal_power_mw: 4.5, current_power_mw: 4.5, criticality: "medium", protected: false, allowed_actions: ["throttle", "suspend"], labels: { class: "training" } },
  { ...base, id: "workload_embeddings", name: "Embeddings refresh", namespace: "ai-batch", workload_type: "Job", nominal_power_mw: 1.4, current_power_mw: 1.4, criticality: "low", protected: false, allowed_actions: ["defer"], labels: { class: "embeddings" } },
  { ...base, id: "workload_eval", name: "Evaluation suite", namespace: "ai-batch", workload_type: "Job", nominal_power_mw: 1.1, current_power_mw: 1.1, criticality: "low", protected: false, allowed_actions: ["suspend"], labels: { class: "evaluation" } },
  { ...base, id: "workload_synthetic", name: "Synthetic data generation", namespace: "ai-batch", workload_type: "Job", nominal_power_mw: 2.4, current_power_mw: 2.4, criticality: "low", protected: false, allowed_actions: ["suspend"], labels: { class: "synthetic_data" } },
];

export const DEMO_TOTAL_MW = DEMO_WORKLOADS.reduce((s, w) => s + w.nominal_power_mw, 0);
