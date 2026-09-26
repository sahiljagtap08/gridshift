"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo } from "react";
import { DEMO_TOTAL_MW, DEMO_WORKLOADS } from "@/lib/demoSite";
import { useFacilityState, type FacilityState } from "@/lib/useFacilityState";

const FacilityScene = dynamic(() => import("@/components/facility/FacilityScene"), { ssr: false });

export default function LandingPage() {
  const live = useFacilityState();
  const hasLive = live.workloads.length > 0;

  // Degrade to the seeded campus at nominal power when the API is unreachable.
  const scene: FacilityState = useMemo(
    () =>
      hasLive
        ? live
        : {
            ...live,
            workloads: DEMO_WORKLOADS,
            mwById: Object.fromEntries(DEMO_WORKLOADS.map((w) => [w.id, w.nominal_power_mw])),
            itMw: DEMO_TOTAL_MW,
            facilityMw: DEMO_TOTAL_MW,
          },
    [hasLive, live],
  );

  return (
    <main className="relative isolate h-screen min-h-[640px] overflow-hidden bg-[#eeece6]">
      {/* 3D campus, idling */}
      <div className="absolute inset-x-0 top-0 h-[52%] md:inset-y-0 md:left-[26%] md:right-0 md:h-auto" aria-hidden>
        <FacilityScene state={scene} ambient fit={1.32} />
      </div>

      {/* Edge fades so the copy reads; the only gradient on the page and it is the brand move here */}
      <div className="pointer-events-none absolute inset-0 landing-fade" aria-hidden />

      {/* Copy */}
      <section className="absolute inset-x-0 bottom-0 z-10 px-6 pb-10 md:inset-y-0 md:left-0 md:flex md:w-[46%] md:max-w-[640px] md:flex-col md:justify-center md:px-12 md:pb-0 xl:px-16">
        <span className="text-[14px] font-semibold tracking-[0.2em] text-ink">GRIDSHIFT</span>
        <h1 className="mt-7 max-w-[14ch] text-[38px] font-semibold leading-[1.06] tracking-[-0.02em] text-ink md:text-[44px] xl:text-[56px]">
          Shift AI workloads to reduce peak power demand.
        </h1>
        <p className="mt-6 max-w-[46ch] text-[16px] leading-[1.55] text-muted md:text-[17px]">
          A grid-responsive control layer for AI data centers. Turn demand-flexibility rules into executable, verified megawatts without touching critical workloads.
        </p>

        {hasLive && (
          <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
            <Stat label="Current load" value={live.facilityMw} />
            <Stat label="Flexible" value={live.flexibleMw} />
            <Stat label="Protected" value={live.protectedMw} />
          </dl>
        )}

        <div className="mt-10">
          <Link
            href="/overview"
            className="inline-flex h-12 items-center justify-center rounded-md bg-teal-dark px-5 text-[16px] font-medium text-white transition-colors duration-150 ease-out hover:bg-[#274450] active:bg-[#1f3740]"
          >
            Get started
          </Link>
          <p className="mt-4 text-[12px] text-muted">Microsoft + CCI Innovation Challenge for Virginia · built with Microsoft Foundry</p>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
      <dd className="num text-[20px] font-semibold leading-tight text-ink">
        {value.toFixed(2)} <span className="text-[12px] font-normal text-muted">MW</span>
      </dd>
    </div>
  );
}
