"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { mw, dateTime, minutes } from "@/lib/format";
import type { GridEvent, VerificationRecord } from "@/lib/types";
import { Card, Empty, EventStatusBadge, LinkButton, PageTitle, Table, td, th } from "@/components/ui";

export default function EventsPage() {
  const [events, setEvents] = useState<GridEvent[]>([]);
  const [vers, setVers] = useState<Record<string, VerificationRecord | null>>({});

  useEffect(() => {
    api.events().then(async (list) => {
      setEvents(list);
      const entries = await Promise.all(
        list
          .filter((e) => e.verification_id)
          .map(async (e) => [e.id, (await api.event(e.id)).verification] as const),
      );
      setVers(Object.fromEntries(entries));
    });
  }, []);

  return (
    <>
      <PageTitle title="Events" subtitle="Every grid event, the plan rounds it took, and what telemetry verified." />
      {events.length === 0 ? (
        <Empty
          title="No grid events yet"
          body="Raise a simulated event from Live Ops to see a full record here."
          action={<LinkButton href="/live-ops" variant="primary">Open Live Ops</LinkButton>}
        />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th className={th}>Event</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Target</th>
                <th className={`${th} text-right`}>Expected</th>
                <th className={`${th} text-right`}>Measured</th>
                <th className={th}>Duration</th>
                <th className={th}>Program</th>
                <th className={th}>Received</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const v = vers[e.id];
                return (
                  <tr key={e.id} className="transition-colors duration-150 ease-out hover:bg-beige/60">
                    <td className={td}><Link href={`/events/${e.id}`} className="mono text-xs text-teal hover:underline">{e.id}</Link></td>
                    <td className={td}><EventStatusBadge status={e.status} /></td>
                    <td className={`${td} num text-right`}>{mw(e.target_reduction_mw)}</td>
                    <td className={`${td} num text-right text-muted`}>{v ? mw(v.expected_reduction_mw) : "—"}</td>
                    <td className={`${td} num text-right font-medium`}>{v ? mw(v.verified_reduction_mw) : "—"}</td>
                    <td className={td}>{minutes(e.duration_minutes)}</td>
                    <td className={`${td} mono text-xs`}>{e.policy_version_id}</td>
                    <td className={`${td} text-muted`}>{dateTime(e.received_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
