"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { StreamMessage, TelemetrySample } from "./types";
import { useStream } from "./useStream";

/** Backfills recent telemetry, then appends live samples from the stream. */
export function useTelemetry(keep = 180, onEvent?: (msg: Extract<StreamMessage, { type: "event" }>) => void) {
  const [samples, setSamples] = useState<TelemetrySample[]>([]);

  useEffect(() => {
    api.telemetry(keep).then(setSamples).catch(() => {});
  }, [keep]);

  const handler = useCallback(
    (msg: StreamMessage) => {
      if (msg.type === "telemetry") {
        setSamples((prev) => [...prev.slice(-(keep - 1)), msg.sample]);
      } else if (msg.type === "event" && onEvent) {
        onEvent(msg);
      }
    },
    [keep, onEvent],
  );
  const connected = useStream(handler);
  const reset = useCallback(() => setSamples([]), []);
  return { samples, connected, reset };
}
