import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.MONITOR_API_KEY;
  if (!expected) return true;
  const actual = request.headers.get("x-monitor-key") ?? "";
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin);
    if (!["http:", "https:"].includes(source.protocol)) return false;
    if (source.origin === request.nextUrl.origin) return true;
    const publicOrigin = process.env.MONITOR_PUBLIC_ORIGIN;
    if (publicOrigin && source.origin === new URL(publicOrigin).origin) return true;
    // IIS/ARR preserves Host but terminates HTTPS before forwarding to Node.
    // Compare the exact host/port; never trust arbitrary forwarded-host headers.
    return source.protocol === "https:" && request.nextUrl.protocol === "http:"
      && source.host === request.headers.get("host");
  }
  catch { return false; }
}
