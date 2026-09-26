import * as THREE from "three";
import type { Workload } from "@/lib/types";

/** Target LED appearance for a workload, derived from its state and live power. */
export interface LedTarget {
  color: THREE.Color;
  intensity: number;
  standby: boolean; // suspended: one amber standby lamp
  breathe: boolean;
}

export const LED_TEAL = new THREE.Color("#3fb3ad");
export const LED_YELLOW = new THREE.Color("#dccf2e");
export const LED_GREY = new THREE.Color("#5d6164");
export const LED_OFF = new THREE.Color("#25282b");
export const LED_AMBER = new THREE.Color("#e0a030");

export function ledTarget(w: Workload, liveMw: number | undefined): LedTarget {
  const ratio = w.nominal_power_mw > 0 ? Math.min(1, Math.max(0, (liveMw ?? w.current_power_mw) / w.nominal_power_mw)) : 1;
  switch (w.state) {
    case "running":
      return { color: LED_TEAL, intensity: 0.7 + 0.3 * ratio, standby: false, breathe: true };
    case "throttled":
      return { color: LED_YELLOW, intensity: Math.max(0.35, 1 - w.throttle_percent) * (0.7 + 0.3 * ratio), standby: false, breathe: true };
    case "suspended":
      return { color: LED_GREY, intensity: 0.28, standby: true, breathe: false };
    case "deferred":
    case "queued":
    default:
      return { color: LED_OFF, intensity: 0.15, standby: false, breathe: false };
  }
}

export function describeAction(a: { action_type: string; parameters: Record<string, unknown>; expected_reduction_mw: number; status: string }): string {
  const verb =
    a.action_type === "throttle"
      ? `throttle to ${Math.round((1 - Number(a.parameters.throttle_percent ?? 0)) * 100)}%`
      : a.action_type === "suspend"
        ? "suspend"
        : a.action_type === "defer"
          ? "defer"
          : a.action_type;
  const prefix =
    a.status === "SUCCEEDED" ? "Executed" : a.status === "RESTORED" ? "Restored after" : a.status === "FAILED" ? "Failed" : "Planned";
  return `${prefix}: ${verb} (−${a.expected_reduction_mw.toFixed(2)} MW expected)`;
}
