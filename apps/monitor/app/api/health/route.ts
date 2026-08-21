import path from "node:path";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const store = new JsonlStore(path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIRECTORY ?? "../../data"));
  const worker = await store.readHealth();
  return NextResponse.json({ status: worker ? "available" : "unknown", worker });
}
