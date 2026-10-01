import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, MONITOR_SESSION_COOKIE } from "../../auth";
import { POST } from "./route";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "monitor-proxy-"));
  vi.stubEnv("DATA_DIRECTORY", directory);
  vi.stubEnv("MONITOR_USERNAME", "test");
  vi.stubEnv("MONITOR_PASSWORD", "test-password");
  vi.stubEnv("MONITOR_AUTH_SECRET", "test-secret");
  vi.stubEnv("MONITOR_API_KEY", "server-only-key");
  vi.stubEnv("MONITOR_PUBLIC_ORIGIN", "");
});
afterEach(() => vi.unstubAllEnvs());

function request(origin: string, host = "panebrasportais.cigam.cloud", session = true) {
  return new NextRequest("http://127.0.0.1:3000/WayData/monitor/api/reprocess", {
    method: "POST",
    headers: { host, origin, "Content-Type": "application/json",
      ...(session ? { cookie: `${MONITOR_SESSION_COOKIE}=${createSession().value}` } : {}) },
    body: JSON.stringify({ correlationId: "DELIVERY:4227:41561-4227:ENTREGUE", entity: "ORDER",
      reference: "4227", routeCode: "5445535", invoiceId: "4227" }),
  });
}

describe("reprocess behind IIS HTTPS proxy", () => {
  it("accepts the preserved HTTPS host and signed session without exposing the API key", async () => {
    const response = await POST(request("https://panebrasportais.cigam.cloud"));
    expect(response.status).toBe(202);
    expect(await new JsonlStore(directory).readReprocessRequests()).toMatchObject([
      { status: "PENDING", reference: "4227", routeCode: "5445535", invoiceId: "4227" },
    ]);
  });

  it("accepts an explicitly configured public origin when the backend host is rewritten", async () => {
    vi.stubEnv("MONITOR_PUBLIC_ORIGIN", "https://panebrasportais.cigam.cloud");
    expect((await POST(request("https://panebrasportais.cigam.cloud", "127.0.0.1:3000"))).status).toBe(202);
  });

  it.each(["https://evil.example", "https://panebrasportais.cigam.cloud:8443", "null"])("rejects a different or invalid origin: %s", async (origin) => {
    const response = await POST(request(origin));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Origem não permitida" });
    expect(await new JsonlStore(directory).readReprocessRequests()).toEqual([]);
  });

  it("still requires a valid session", async () => {
    expect((await POST(request("https://panebrasportais.cigam.cloud", "panebrasportais.cigam.cloud", false))).status).toBe(401);
  });

  it("still requires an API key when login is disabled", async () => {
    vi.stubEnv("MONITOR_USERNAME", "");
    expect((await POST(request("https://panebrasportais.cigam.cloud", "panebrasportais.cigam.cloud", false))).status).toBe(401);
  });
});
