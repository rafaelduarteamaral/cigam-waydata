import { NextResponse } from "next/server";
import { clearSession } from "../../../auth";

export async function POST() {
  return clearSession(NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }));
}
