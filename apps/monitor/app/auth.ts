import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const MONITOR_SESSION_COOKIE = "cigam_monitor_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function config() {
  const username = process.env.MONITOR_USERNAME?.trim();
  const password = process.env.MONITOR_PASSWORD;
  const secret = process.env.MONITOR_AUTH_SECRET;
  return { username, password, secret };
}

export function isMonitorLoginEnabled(): boolean {
  const { username, password, secret } = config();
  return Boolean(username && password && secret);
}

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authenticate(username: string, password: string): boolean {
  const expected = config();
  if (!expected.username || !expected.password || !expected.secret) return false;
  return equal(username, expected.username) && equal(password, expected.password);
}

export function createSession(): { value: string; expires: Date } {
  const { username, secret } = config();
  if (!username || !secret) throw new Error("Autenticação do monitor não configurada");
  const expiresAt = Math.floor(Date.now() / 1_000) + SESSION_TTL_SECONDS;
  const payload = `${username}.${expiresAt}`;
  return { value: `${payload}.${signature(payload, secret)}`, expires: new Date(expiresAt * 1_000) };
}

function validSession(value: string | undefined): boolean {
  const { username, secret } = config();
  if (!username || !secret || !value) return false;
  const [sessionUser, expiresRaw, providedSignature, ...extra] = value.split(".");
  const expiresAt = Number(expiresRaw);
  if (extra.length || !sessionUser || !providedSignature || !Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1_000)) return false;
  const payload = `${sessionUser}.${expiresAt}`;
  return equal(sessionUser, username) && equal(providedSignature, signature(payload, secret));
}

export async function hasMonitorSession(): Promise<boolean> {
  if (!isMonitorLoginEnabled()) return true;
  return validSession((await cookies()).get(MONITOR_SESSION_COOKIE)?.value);
}

export function requireMonitorSession(request: NextRequest): NextResponse | null {
  if (!isMonitorLoginEnabled() || validSession(request.cookies.get(MONITOR_SESSION_COOKIE)?.value)) return null;
  return NextResponse.json({ error: "Autenticação necessária" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

export function applySession(response: NextResponse, session: { value: string; expires: Date }): NextResponse {
  response.cookies.set(MONITOR_SESSION_COOKIE, session.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expires,
  });
  return response;
}

export function clearSession(response: NextResponse): NextResponse {
  response.cookies.set(MONITOR_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
