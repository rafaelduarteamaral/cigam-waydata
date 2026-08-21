import { appendFile, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { logEventSchema, reprocessRequestSchema, sanitizeValue, type LogEvent, type ReprocessRequest } from "@cigam-waydata/shared";

function localDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ ?? "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export class JsonlStore {
  private writeChain = Promise.resolve();

  constructor(private readonly dataDirectory: string) {}

  private async append(directory: string, prefix: string, value: unknown): Promise<void> {
    const dir = path.resolve(this.dataDirectory, directory);
    await mkdir(dir, { recursive: true });
    const filename = path.join(dir, `${prefix}-${localDateKey(new Date())}.jsonl`);
    const line = `${JSON.stringify(sanitizeValue(value))}\n`;
    this.writeChain = this.writeChain.then(() => appendFile(filename, line, { encoding: "utf8", mode: 0o640 }));
    await this.writeChain;
  }

  async writeLog(event: LogEvent): Promise<void> {
    await this.append("logs", "integration", logEventSchema.parse(event));
  }

  async requestReprocess(request: ReprocessRequest): Promise<void> {
    await this.append("reprocess", "queue", reprocessRequestSchema.parse(request));
  }

  async readReprocessRequests(): Promise<ReprocessRequest[]> {
    const dir = path.resolve(this.dataDirectory, "reprocess");
    let files: string[];
    try { files = (await readdir(dir)).filter((file) => file.startsWith("queue-") && file.endsWith(".jsonl")).sort(); }
    catch { return []; }
    const latest = new Map<string, ReprocessRequest>();
    for (const file of files) {
      for (const line of (await readFile(path.join(dir, file), "utf8")).split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = reprocessRequestSchema.safeParse(JSON.parse(line));
          if (parsed.success) latest.set(parsed.data.id, parsed.data);
        } catch { /* tolerate an incomplete final line */ }
      }
    }
    return [...latest.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  async updateReprocess(request: ReprocessRequest): Promise<void> {
    await this.requestReprocess(request);
  }

  async heartbeat(payload: Record<string, unknown>): Promise<void> {
    const dir = path.resolve(this.dataDirectory, "runtime");
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, "worker-health.json");
    const temp = `${target}.${process.pid}.tmp`;
    const handle = await open(temp, "w", 0o640);
    try {
      await handle.writeFile(JSON.stringify(sanitizeValue(payload), null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  }

  async readHealth(): Promise<Record<string, unknown> | null> {
    try {
      return JSON.parse(await readFile(path.resolve(this.dataDirectory, "runtime", "worker-health.json"), "utf8"));
    } catch {
      return null;
    }
  }

  private routeMapPath(): string {
    return path.resolve(this.dataDirectory, "runtime", "route-map.json");
  }

  async readRouteMap(): Promise<Record<string, number>> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.routeMapPath(), "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
    } catch {
      return {};
    }
  }

  async getRouteExternalCode(key: string): Promise<number | undefined> {
    const value = (await this.readRouteMap())[key];
    return typeof value === "number" ? value : undefined;
  }

  async setRouteExternalCode(key: string, code: number): Promise<void> {
    const current = await this.readRouteMap();
    current[key] = code;
    const dir = path.resolve(this.dataDirectory, "runtime");
    await mkdir(dir, { recursive: true });
    const target = this.routeMapPath();
    const temp = `${target}.${process.pid}.tmp`;
    const handle = await open(temp, "w", 0o640);
    try {
      await handle.writeFile(JSON.stringify(current));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  }

  async readLogs(dateFrom: string, dateTo: string): Promise<LogEvent[]> {
    const dir = path.resolve(this.dataDirectory, "logs");
    let files: string[];
    try {
      files = await readdir(dir);
    } catch {
      return [];
    }
    const selected = files
      .filter((file) => file.startsWith("integration-") && file.endsWith(".jsonl"))
      .filter((file) => {
        const key = file.slice("integration-".length, -".jsonl".length);
        return key >= dateFrom && key <= dateTo;
      })
      .sort();
    const events: LogEvent[] = [];
    for (const file of selected) {
      const content = await readFile(path.join(dir, file), "utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = logEventSchema.safeParse(JSON.parse(line));
          if (parsed.success) events.push(parsed.data);
        } catch { /* tolerate a truncated line after interruption */ }
      }
    }
    return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async hasSuccessfulCorrelation(correlationId: string): Promise<boolean> {
    const today = localDateKey(new Date());
    const from = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    return (await this.readLogs(from, today)).some((event) => event.correlationId === correlationId && event.status === "SUCCESS");
  }

  async successfulCorrelationIds(prefix: string): Promise<Set<string>> {
    const today = localDateKey(new Date());
    const from = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    return new Set((await this.readLogs(from, today)).filter((event) => event.status === "SUCCESS" && event.correlationId.startsWith(prefix)).map((event) => event.correlationId));
  }

  async purgeExpired(retentionDays: number): Promise<number> {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
    const cutoff = localDateKey(new Date(Date.now() - retentionDays * 86_400_000));
    let removed = 0;
    for (const directory of ["logs", "reprocess", "tmp/receipts"] as const) {
      const dir = path.resolve(this.dataDirectory, directory);
      let files: string[];
      try { files = await readdir(dir); }
      catch { continue; }
      for (const file of files) {
        const match = file.match(/(\d{4}-\d{2}-\d{2})/);
        const day = match?.[1];
        const stale = day ? day < cutoff : directory.startsWith("tmp/");
        if (!stale) continue;
        try {
          await unlink(path.join(dir, file));
          removed += 1;
        } catch { /* ignore files already removed */ }
      }
    }
    return removed;
  }
}
