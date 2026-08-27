import path from "node:path";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { NextResponse } from "next/server";
import { requireMonitorSession } from "../../auth";

export const dynamic = "force-dynamic";

export async function GET(request: import("next/server").NextRequest) {
  const denied = requireMonitorSession(request);
  if (denied) return denied;
  const store = new JsonlStore(path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIRECTORY ?? "../../data"));
  const worker = await store.readHealth();
  return NextResponse.json({ status: worker ? "available" : "unknown", worker });
}
