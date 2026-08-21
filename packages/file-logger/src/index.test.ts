import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonlStore } from "./index";

describe("JsonlStore", () => {
  it("redacts secrets and tolerates truncated lines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cigam-waydata-"));
    const store = new JsonlStore(root);
    await store.writeLog({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), correlationId: "A", direction: "INTERNAL", entity: "SYSTEM", operation: "SYNC", reference: {}, attempt: 1, status: "SUCCESS", message: "Bearer abc.def.ghi", errorCode: "token-hidden" });
    const day = new Date().toISOString().slice(0, 10);
    const events = await store.readLogs(day, day);
    expect(events[0]?.message).toBe("Bearer <REDACTED>");
    await writeFile(path.join(root, "logs", `integration-${day}.jsonl`), '{"incomplete":', { flag: "a" });
    await expect(store.readLogs(day, day)).resolves.toHaveLength(1);
  });

  it("keeps the latest durable queue state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cigam-waydata-"));
    await mkdir(path.join(root, "reprocess"), { recursive: true });
    const store = new JsonlStore(root);
    const item = { id: crypto.randomUUID(), requestedAt: new Date().toISOString(), requestedBy: "qa", originalCorrelationId: "R", entity: "ROUTE" as const, reference: "42", status: "PENDING" as const };
    await store.requestReprocess(item);
    await store.updateReprocess({ ...item, status: "DONE" });
    await expect(store.readReprocessRequests()).resolves.toMatchObject([{ id: item.id, status: "DONE" }]);
  });

  it("persists the WayData external code fallback map", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "cigam-waydata-")));
    await store.setRouteExternalCode("PANEBRAS:36858", 7001);
    await expect(store.getRouteExternalCode("PANEBRAS:36858")).resolves.toBe(7001);
  });

  it("purges log files older than the retention window", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cigam-waydata-"));
    const store = new JsonlStore(root);
    await mkdir(path.join(root, "logs"), { recursive: true });
    await mkdir(path.join(root, "tmp", "receipts"), { recursive: true });
    await writeFile(path.join(root, "logs", "integration-2020-01-01.jsonl"), "{}\n");
    await writeFile(path.join(root, "tmp", "receipts", "leftover.bin"), "x");
    await expect(store.purgeExpired(180)).resolves.toBeGreaterThanOrEqual(2);
  });
});
