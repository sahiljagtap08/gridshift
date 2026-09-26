"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStream } from "@/lib/useStream";

const NAV = [
  { href: "/overview", label: "Overview" },
  { href: "/live-ops", label: "Live Ops" },
  { href: "/facility", label: "Facility" },
  { href: "/policy-lab", label: "Policy Lab" },
  { href: "/programs", label: "Programs" },
  { href: "/workloads", label: "Workloads" },
  { href: "/events", label: "Events" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const connected = useStream(() => {});

  if (path === "/") return <>{children}</>;

  return (
    <div className="flex min-h-full">
      <aside className="fixed inset-y-0 left-0 flex w-56 flex-col border-r border-border bg-beige/60">
        <div className="px-6 pt-7 pb-8">
          <Link href="/overview" className="text-[15px] font-semibold tracking-[0.18em] text-ink">
            GRIDSHIFT
          </Link>
          <p className="mt-1 text-xs text-muted">Grid-responsive control</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((n) => {
            const active = path.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-md px-3 py-2 text-[13px] transition-colors duration-150 ease-out ${
                  active
                    ? "bg-teal-dark text-white"
                    : "text-ink hover:bg-beige"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 pb-6">
          <span className="block rounded-md px-3 py-2 text-[13px] text-muted">Settings</span>
        </div>
      </aside>

      <div className="ml-56 flex min-h-full flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-3 border-b border-border bg-canvas px-8">
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px]">
            <span className="text-muted">Site</span>
            <span className="font-medium">Virginia AI Campus</span>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-[13px]">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                connected ? "bg-success live-dot" : "bg-risk"
              }`}
              aria-hidden
            />
            <span>{connected ? "Telemetry live" : "Reconnecting"}</span>
          </div>
          <span className="mono rounded-md bg-teal-dark px-3 py-1.5 text-[11px] tracking-wide text-white">
            OBSERVE + ACTUATE
          </span>
        </header>
        <main className="flex-1 px-8 py-8">
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
