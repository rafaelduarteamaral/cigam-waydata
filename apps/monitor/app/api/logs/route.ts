import path from "node:path";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ ?? "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const parsed = z.object({ from: date, to: date }).safeParse({ from: request.nextUrl.searchParams.get("from") ?? today, to: request.nextUrl.searchParams.get("to") ?? request.nextUrl.searchParams.get("from") ?? today });
  if (!parsed.success || parsed.data.from > parsed.data.to) return NextResponse.json({ error: "Período inválido" }, { status: 400 });
  const store = new JsonlStore(path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIRECTORY ?? "../../data"));
  return NextResponse.json({ events: await store.readLogs(parsed.data.from, parsed.data.to) });
}
