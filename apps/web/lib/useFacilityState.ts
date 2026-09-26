"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Action, GridEvent, Overview, StreamMessage, Workload } from "./types";
import { useStream } from "./useStream";

export interface FacilityState {
  workloads: Workload[];
  /** Live per-workload IT power from the telemetry stream (falls back to workload.current_power_mw). */
  mwById: Record<string, number>;
  facilityMw: number;
  itMw: number;
  protectedMw: number;
  flexibleMw: number;
  pue: number;
  activeEvent: GridEvent | null;
  /** Actions on the active plan keyed by workload id. */
  actionsById: Record<string, Action>;
  connected: boolean;
}

const EMPTY: FacilityState = {
  workloads: [],
  mwById: {},
  facilityMw: 0,
  itMw: 0,
  protectedMw: 0,
  flexibleMw: 0,
  pue: 1,
  activeEvent: null,
  actionsById: {},
  connected: false,
};

/** Everything the 3D facility view needs, kept live from REST + SSE. */
export function useFacilityState(): FacilityState {
  const [state, setState] = useState<FacilityState>(EMPTY);
  const eventIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ov, workloads] = await Promise.all([api.overview(), api.workloads()]);
      let actionsById: Record<string, Action> = {};
      let activeEvent: GridEvent | null = ov.active_event;
      if (ov.active_event) {
        eventIdRef.current = ov.active_event.id;
        const d = await api.event(ov.active_event.id);
        activeEvent = d.event;
        // latest action per workload across all rounds
        for (const plan of d.plans) {
          for (const a of plan.actions) {
            if (plan.status === "INFEASIBLE" || plan.status === "SUPERSEDED" || plan.status === "REJECTED") continue;
            actionsById[a.workload_id] = a;
          }
        }
      } else {
        eventIdRef.current = null;
        actionsById = {};
      }
      setState((prev) => ({
        ...prev,
        workloads,
        mwById: Object.fromEntries(workloads.map((w) => [w.id, prev.mwById[w.id] ?? w.current_power_mw])),
        facilityMw: ov.current_load_mw,
        itMw: ov.it_load_mw,
        protectedMw: ov.protected_load_mw,
        flexibleMw: ov.flexible_load_mw,
        pue: ov.site.pue,
        activeEvent,
        actionsById,
      }));
    } catch {
      /* keep the last good state */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(refresh, 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const onMessage = useCallback(
    (msg: StreamMessage) => {
      if (msg.type === "telemetry") {
        const s = msg.sample;
        setState((prev) => ({
          ...prev,
          mwById: { ...prev.mwById, ...s.per_workload_mw },
          facilityMw: s.facility_power_mw,
          itMw: s.it_power_mw,
        }));
      } else if (msg.type === "event") {
        refresh();
      }
    },
    [refresh],
  );
  const connected = useStream(onMessage);

  return { ...state, connected };
}

export type { Overview };
