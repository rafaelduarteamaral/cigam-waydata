import { NextRequest, NextResponse } from "next/server";
import { authenticate, applySession, createSession, isMonitorLoginEnabled } from "../../../auth";

export async function POST(request: NextRequest) {
  if (!isMonitorLoginEnabled()) return NextResponse.json({ error: "Autenticação não configurada" }, { status: 503 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Solicitação inválida" }, { status: 400 }); }
  const { username, password } = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (typeof username !== "string" || typeof password !== "string" || !authenticate(username, password)) {
    return NextResponse.json({ error: "Usuário ou senha inválidos" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return applySession(NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }), createSession());
}
