import path from "node:path";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { sanitizeValue } from "@cigam-waydata/shared";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireMonitorSession } from "../../auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = requireMonitorSession(request);
  if (denied) return denied;
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const parsed = z.object({ from: date, to: date }).safeParse({ from: request.nextUrl.searchParams.get("from"), to: request.nextUrl.searchParams.get("to") });
  if (!parsed.success || parsed.data.from > parsed.data.to) return NextResponse.json({ error: "Período inválido" }, { status: 400 });
  const store = new JsonlStore(path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIRECTORY ?? "../../data"));
  const body = (await store.readLogs(parsed.data.from, parsed.data.to)).map((event) => JSON.stringify(sanitizeValue(event))).join("\n");
  return new NextResponse(body ? `${body}\n` : "", { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Content-Disposition": `attachment; filename="integration-${parsed.data.from}-${parsed.data.to}.jsonl"`, "Cache-Control": "no-store" } });
}
