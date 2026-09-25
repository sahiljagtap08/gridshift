"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE } from "./api";
import type { StreamMessage } from "./types";

/** Subscribes to the backend SSE stream. Reconnects automatically. */
export function useStream(onMessage: (msg: StreamMessage) => void) {
  const [connected, setConnected] = useState(false);
  const handler = useRef(onMessage);
  useEffect(() => {
    handler.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const es = new EventSource(`${API_BASE}/stream`);
    const parse = (e: MessageEvent) => {
      try {
        handler.current(JSON.parse(e.data) as StreamMessage);
      } catch {
        /* ignore malformed frames */
      }
    };
    es.addEventListener("hello", () => setConnected(true));
    es.addEventListener("telemetry", parse);
    es.addEventListener("event", parse);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return connected;
}
