"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { useFacilityState } from "@/lib/useFacilityState";
import type { HoverTarget } from "./FacilityScene";

const FacilityScene = dynamic(() => import("./FacilityScene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#eeece6] text-[12px] text-muted">Loading facility model…</div>
  ),
});

const LEGEND: { swatch: string; label: string }[] = [
  { swatch: "#3fb3ad", label: "Running" },
  { swatch: "#dccf2e", label: "Throttled" },
  { swatch: "#5d6164", label: "Suspended" },
  { swatch: "#25282b", label: "Deferred" },
];

export function FacilityView({ height, expandHref, backHref, fit = 1 }: { height?: number | string; expandHref?: string; backHref?: string; fit?: number }) {
  const state = useFacilityState();
  const [hover, setHover] = useState<HoverTarget | null>(null);

  return (
    <div className="relative w-full overflow-hidden rounded-lg border border-border bg-[#eeece6]" style={{ height: height ?? "100%" }}>
      <FacilityScene state={state} onHoverChange={setHover} fit={fit} />

      {/* top-left: title / back */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-1">
        {backHref && (
          <Link href={backHref} className="pointer-events-auto text-[12px] text-muted hover:text-ink">
            ← Back to Live Ops
          </Link>
        )}
        <div className="text-[13px] font-semibold text-ink">Virginia AI Campus</div>
        <div className="text-[11px] text-muted">{hover ? "Click to pin the card" : "Hover any unit for live detail · drag to orbit · scroll to zoom"}</div>
      </div>

      {/* top-right: live facility figure */}
      <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-3 rounded-md border border-border bg-surface/90 px-3 py-2 backdrop-blur-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Facility</div>
          <div className="num text-[18px] font-semibold leading-none text-ink">
            {state.facilityMw.toFixed(2)} <span className="text-[11px] font-normal text-muted">MW</span>
          </div>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${state.connected ? "bg-success live-dot" : "bg-risk"}`} />
          {state.connected ? "live" : "reconnecting"}
        </span>
        {expandHref && (
          <Link href={expandHref} className="pointer-events-auto ml-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-ink hover:bg-beige">
            Expand
          </Link>
        )}
      </div>

      {/* bottom-left legend */}
      <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-3 rounded-md border border-border bg-surface/90 px-3 py-1.5 backdrop-blur-sm">
        <span className="text-[10px] uppercase tracking-wide text-muted">Rack LEDs</span>
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1.5 text-[11px] text-ink">
            <span className="inline-block h-2 w-3 rounded-sm" style={{ background: l.swatch }} />
            {l.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-ink">
          <span className="inline-block h-1 w-3 rounded-sm bg-ink" />
          Protected
        </span>
      </div>

      {/* bottom-right: active event chip */}
      {state.activeEvent && (
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-md border border-border bg-surface/90 px-3 py-2 text-[11px] backdrop-blur-sm">
          <span className="text-muted">Grid event · </span>
          <span className="num font-medium text-ink">{state.activeEvent.target_reduction_mw.toFixed(2)} MW</span>
          <span className="text-muted"> · </span>
          <span className="mono text-[10px] tracking-wide text-ink">{state.activeEvent.status.replace(/_/g, " ")}</span>
        </div>
      )}
    </div>
  );
}
