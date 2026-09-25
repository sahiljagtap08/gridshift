/**
 * Runtime proxy to the GridShift API.
 *
 * NEXT_PUBLIC_* values are inlined at build time, which does not work when the
 * container image is built before the API address is known (Azure Container
 * Apps builds from source). This route forwards /backend/* to API_UPSTREAM
 * (read at request time) and streams the body, so Server-Sent Events pass through.
 */

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const upstream = () => (process.env.API_UPSTREAM ?? "http://localhost:8000").replace(/\/$/, "");

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${upstream()}/api/v1/${path.join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const name of ["content-type", "accept", "idempotency-key"]) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }
  const res = await fetch(url, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    cache: "no-store",
    // @ts-expect-error node fetch supports duplex for streaming bodies
    duplex: "half",
  });
  const out = new Headers();
  for (const name of ["content-type", "cache-control"]) {
    const v = res.headers.get(name);
    if (v) out.set(name, v);
  }
  if (res.headers.get("content-type")?.includes("text/event-stream")) {
    out.set("cache-control", "no-cache, no-transform");
    out.set("x-accel-buffering", "no");
  }
  return new Response(res.body, { status: res.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
