import type { Workload } from "@/lib/types";

/** Scene units are metres. */
export const CAB_W = 0.62;
export const CAB_D = 1.05;
export const CAB_H = 2.1;
export const PITCH = 0.66;
export const GROUP_GAP = 0.55;
export const STRIPS = 8;

export const ROW_BACK_Z = -3.4;
export const ROW_FRONT_Z = 2.6;
export const ROW_X0 = -7.2;

export interface RackGroupLayout {
  workload: Workload;
  cabinets: number;
  x0: number; // left edge of the group
  z: number; // row centre line
  width: number;
}

const BACK_ROW = ["workload_training", "workload_eval", "workload_embeddings"];
const FRONT_ROW = ["workload_inference", "workload_synthetic"];

export function cabinetCount(w: Workload): number {
  return Math.max(3, Math.round(w.nominal_power_mw * 2.2));
}

/** Deterministic placement: two rows, left-aligned, grouped per workload. */
export function layoutRacks(workloads: Workload[]): RackGroupLayout[] {
  const byId = new Map(workloads.map((w) => [w.id, w]));
  const known = new Set([...BACK_ROW, ...FRONT_ROW]);
  const extras = workloads.filter((w) => !known.has(w.id)).map((w) => w.id);
  const rows: [string[], number][] = [
    [BACK_ROW, ROW_BACK_Z],
    [[...FRONT_ROW, ...extras], ROW_FRONT_Z],
  ];
  const out: RackGroupLayout[] = [];
  for (const [ids, z] of rows) {
    let x = ROW_X0;
    for (const id of ids) {
      const w = byId.get(id);
      if (!w) continue;
      const n = cabinetCount(w);
      const width = n * PITCH;
      out.push({ workload: w, cabinets: n, x0: x, z, width });
      x += width + GROUP_GAP;
    }
  }
  return out;
}

export const COOLER_POS: [number, number, number][] = [
  [-10.8, 0, 1.0],
  [-10.8, 0, 4.4],
];
export const SWITCHGEAR_X0 = 9.6;
export const SWITCHGEAR_Z = 4.2;
export const SWITCHGEAR_COUNT = 6;
export const SUBSTATION_CENTER: [number, number, number] = [16.8, 0, -4.8];
export const SUBSTATION_SIZE: [number, number] = [10, 7.5];
export const TOWER_POS: [number, number, number] = [20.6, 0, -7.9];
