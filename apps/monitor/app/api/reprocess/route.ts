import { randomUUID } from "node:crypto";
import path from "node:path";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { integrationEntitySchema } from "@cigam-waydata/shared";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorized, isSameOrigin } from "../security";

const bodySchema = z.object({
  correlationId: z.string().min(1),
  entity: integrationEntitySchema,
  reference: z.string().min(1),
});

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Origem não permitida" }, { status: 403 });
  if (!isAuthorized(request)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Solicitação inválida" }, { status: 400 });
  const store = new JsonlStore(path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIRECTORY ?? "../../data"));
  const item = {
    id: randomUUID(),
    requestedAt: new Date().toISOString(),
    requestedBy: request.headers.get("x-monitor-user")?.slice(0, 100) || "monitor-user",
    originalCorrelationId: parsed.data.correlationId,
    entity: parsed.data.entity,
    reference: parsed.data.reference,
    status: "PENDING" as const,
  };
  await store.requestReprocess(item);
  return NextResponse.json({ request: item }, { status: 202 });
}
