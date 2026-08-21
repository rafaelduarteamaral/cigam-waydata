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
  try { return new URL(origin).origin === request.nextUrl.origin; }
  catch { return false; }
}
