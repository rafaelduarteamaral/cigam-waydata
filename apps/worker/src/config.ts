import path from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

export function loadConfig() {
  const syncMode = process.env.SYNC_MODE ?? (process.env.SYNC_ENABLED === "true" ? "write" : "disabled");
  const enabled = syncMode !== "disabled";
  return {
    enabled,
    syncMode,
    dataDirectory: path.resolve(process.env.DATA_DIRECTORY ?? "./data"),
    intervalMs: Number(process.env.SYNC_INTERVAL_SECONDS ?? 300) * 1_000,
    timeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? 30_000),
    maxRetries: Number(process.env.MAX_RETRIES ?? 5),
    concurrency: Number(process.env.SYNC_CONCURRENCY ?? 4),
    deliveryLookbackDays: Number(process.env.DELIVERY_LOOKBACK_DAYS ?? 4),
    logRetentionDays: Number(process.env.LOG_RETENTION_DAYS ?? 180),
    routeAllowlist: (process.env.SYNC_ROUTE_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    maxWriteRoutes: Number(process.env.SYNC_MAX_ROUTES ?? 0),
    smtp: process.env.SMTP_HOST && process.env.ALERT_RECIPIENTS ? {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      from: process.env.SMTP_FROM ?? "cigam-waydata@localhost",
      recipients: process.env.ALERT_RECIPIENTS.split(",").map((value) => value.trim()).filter(Boolean),
      ...(process.env.SMTP_USER ? { user: process.env.SMTP_USER, password: process.env.SMTP_PASSWORD ?? "" } : {}),
    } : null,
    cigam: enabled
      ? { baseUrl: required("CIGAM_BASE_URL"), token: required("CIGAM_TOKEN"), paths: Object.fromEntries(([
          ["pendingRoutes", process.env.CIGAM_PENDING_ROUTES_PATH],
          ["route", process.env.CIGAM_ROUTE_PATH],
          ["status", process.env.CIGAM_STATUS_PATH],
          ["tracking", process.env.CIGAM_TRACKING_PATH],
          ["attachment", process.env.CIGAM_ATTACHMENT_PATH],
          ["companies", process.env.CIGAM_COMPANIES_PATH],
        ] as const).filter((entry): entry is [typeof entry[0], string] => Boolean(entry[1]))), authorizationScheme: process.env.CIGAM_AUTH_SCHEME === "raw" ? "raw" as const : "bearer" as const, ...(process.env.CIGAM_API_STYLE === "asmx" ? { asmx: { unit: process.env.CIGAM_UNIT ?? "001", lookbackDays: Number(process.env.CIGAM_LOOKBACK_DAYS ?? 4), page: 1 } } : {}) }
      : null,
    wayData: syncMode === "write"
      ? { baseUrl: required("WAYDATA_BASE_URL"), token: required("WAYDATA_TOKEN") }
      : null,
  };
}
