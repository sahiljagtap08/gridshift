import type { TimelineEntry } from "@/lib/types";
import { clock } from "@/lib/format";

const kindColor: Record<string, string> = {
  approved: "bg-teal-dark",
  action: "bg-teal",
  action_failed: "bg-risk",
  shortfall: "bg-signal",
  stale: "bg-signal",
  restore: "bg-aqua",
  received: "bg-ink",
};

export function Timeline({ entries, max }: { entries: TimelineEntry[]; max?: number }) {
  const list = max ? entries.slice(-max) : entries;
  if (list.length === 0) return <p className="text-muted">Nothing has happened yet.</p>;
  return (
    <ol className="space-y-2">
      {list.map((t, i) => {
        const dot = kindColor[t.kind] ?? (t.message.toLowerCase().includes("target met") ? "bg-success" : "bg-border-strong");
        return (
          <li key={i} className="flex items-start gap-3 text-[13px]">
            <span className="mono w-[68px] shrink-0 pt-0.5 text-xs text-muted">{clock(t.at)}</span>
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
            <span>{t.message}</span>
          </li>
        );
      })}
    </ol>
  );
}
