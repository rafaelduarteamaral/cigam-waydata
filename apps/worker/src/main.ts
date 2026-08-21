import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CigamClient } from "@cigam-waydata/cigam-client";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { WayDataClient } from "@cigam-waydata/waydata-client";
import { AlertNotifier } from "@cigam-waydata/notifications";

const repoRootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
process.loadEnvFile?.(process.env.ENV_FILE ?? repoRootEnv);
import { loadConfig } from "./config";
import { IntegrationWorker } from "./worker";

const config = loadConfig();
const store = new JsonlStore(config.dataDirectory);
const cigam = config.cigam ? new CigamClient({ ...config.cigam, paths: Object.fromEntries(Object.entries(config.cigam.paths).filter(([, value]) => value)) as never, timeoutMs: config.timeoutMs, maxRetries: config.maxRetries }) : undefined;
const wayData = config.wayData ? new WayDataClient({ ...config.wayData, timeoutMs: config.timeoutMs, maxRetries: config.maxRetries }) : undefined;
const notifier = config.smtp ? new AlertNotifier(config.smtp) : undefined;
const worker = new IntegrationWorker({ store, enabled: config.enabled, writeEnabled: config.syncMode === "write", concurrency: config.concurrency, deliveryLookbackDays: config.deliveryLookbackDays, logRetentionDays: config.logRetentionDays, routeAllowlist: config.routeAllowlist, maxWriteRoutes: config.maxWriteRoutes, ...(cigam ? { cigam } : {}), ...(wayData ? { wayData } : {}), ...(notifier ? { notifier } : {}) });

let stopped = false;

async function cycle(): Promise<void> {
  if (stopped) return;
  await worker.runCycle();
}

if (notifier) {
  await notifier.verify().catch(() => store.writeLog({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    correlationId: "SMTP:VERIFY",
    direction: "INTERNAL",
    entity: "SYSTEM",
    operation: "SYNC",
    attempt: 1,
    status: "ERROR",
    reference: {},
    message: "SMTP configurado, mas a verificação do servidor de e-mail falhou.",
  }).catch(() => undefined));
}

await cycle();
if (process.env.SYNC_ONCE === "true") process.exit(0);
const timer = setInterval(() => void cycle(), config.intervalMs);

function shutdown(): void {
  stopped = true;
  clearInterval(timer);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
