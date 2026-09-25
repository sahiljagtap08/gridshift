"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TelemetrySample } from "@/lib/types";

export function PowerChart({
  samples,
  baseline,
  target,
  height = 260,
  domain,
}: {
  samples: TelemetrySample[];
  baseline?: number;
  target?: number;
  height?: number;
  domain?: [number, number];
}) {
  const data = samples.map((s) => ({
    t: new Date(s.timestamp).getTime(),
    label: new Date(s.timestamp).toLocaleTimeString([], { hour12: false }),
    actual: Number(s.facility_power_mw.toFixed(3)),
  }));
  const values = data.map((d) => d.actual);
  const lo = Math.min(...values, target ?? Infinity, baseline ?? Infinity);
  const hi = Math.max(...values, baseline ?? -Infinity);
  const yDomain: [number, number] =
    domain ?? (values.length ? [Math.floor(lo - 0.6), Math.ceil(hi + 0.4)] : [0, 14]);

  return (
    <div style={{ height }} className="w-full">
      {data.length === 0 ? (
        <div className="flex h-full items-center justify-center text-muted">Waiting for telemetry</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#e4e4d9" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: "#74756e" }}
              axisLine={{ stroke: "#d9d9cf" }}
              tickLine={false}
              minTickGap={48}
            />
            <YAxis
              domain={yDomain}
              tick={{ fontSize: 11, fill: "#74756e" }}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={(v: number) => `${v.toFixed(1)}`}
            />
            <Tooltip
              contentStyle={{
                background: "#fdfcf8",
                border: "1px solid #d9d9cf",
                borderRadius: 6,
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
              }}
              formatter={(v) => [`${Number(v).toFixed(2)} MW`, "Facility power"]}
              labelFormatter={(l) => String(l)}
            />
            {baseline != null && (
              <ReferenceLine
                y={baseline}
                stroke="#74756e"
                strokeDasharray="4 4"
                label={{ value: `Baseline ${baseline.toFixed(2)}`, position: "insideTopRight", fontSize: 11, fill: "#74756e" }}
              />
            )}
            {target != null && (
              <ReferenceLine
                y={target}
                stroke="#9b3f37"
                strokeDasharray="6 3"
                label={{ value: `Target ${target.toFixed(2)}`, position: "insideBottomRight", fontSize: 11, fill: "#9b3f37" }}
              />
            )}
            <Line
              type="stepAfter"
              dataKey="actual"
              stroke="#2f797a"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
