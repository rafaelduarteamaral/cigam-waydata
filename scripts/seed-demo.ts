import { randomUUID } from "node:crypto";
import path from "node:path";
import { JsonlStore } from "@cigam-waydata/file-logger";
import type { LogEvent } from "@cigam-waydata/shared";

const store = new JsonlStore(path.resolve(process.env.DATA_DIRECTORY ?? "./data"));
const base = Date.now();

const samples: Array<Omit<LogEvent, "id" | "timestamp">> = [
  {
    correlationId: "CLIENT:01:00231",
    direction: "CIGAM_TO_WAYDATA",
    entity: "CLIENT",
    operation: "UPDATE",
    reference: { company: "01", client: "00231" },
    request: { method: "PATCH", endpoint: "/cliente/dados" },
    attempt: 1,
    status: "SUCCESS",
    httpStatus: 200,
    durationMs: 284,
    message: "Dados cadastrais sincronizados.",
  },
  {
    correlationId: "ROUTE:01:88231",
    direction: "WAYDATA_TO_CIGAM",
    entity: "ROUTE",
    operation: "READ",
    reference: { company: "01", route: "88231" },
    request: { method: "GET", endpoint: "/rota?codigoRota=88231" },
    attempt: 1,
    status: "SUCCESS",
    httpStatus: 200,
    durationMs: 518,
    message: "Rota reconciliada sem alterações.",
  },
  {
    correlationId: "ORDER:01:552310",
    direction: "CIGAM_TO_WAYDATA",
    entity: "ORDER",
    operation: "UPDATE",
    reference: { company: "01", order: "552310" },
    request: { method: "PATCH", endpoint: "/pedido/many" },
    attempt: 3,
    status: "ERROR",
    httpStatus: 503,
    durationMs: 30_001,
    message: "Timeout ao conectar ao host WayData.",
    errorCode: "UPSTREAM_TIMEOUT",
  },
  {
    correlationId: "CLIENT:01:00458",
    direction: "CIGAM_TO_WAYDATA",
    entity: "CLIENT",
    operation: "CREATE",
    reference: { company: "01", client: "00458" },
    request: { method: "PUT", endpoint: "/cliente" },
    attempt: 1,
    status: "SUCCESS",
    httpStatus: 200,
    durationMs: 391,
    message: "Cliente criado na WayData.",
  },
  {
    correlationId: "ROUTE:01:88190",
    direction: "CIGAM_TO_WAYDATA",
    entity: "ROUTE",
    operation: "DELETE",
    reference: { company: "01", route: "88190", invoice: "00012344" },
    request: { method: "DELETE", endpoint: "/rota?codigoRota=88190" },
    attempt: 1,
    status: "SUCCESS",
    httpStatus: 200,
    durationMs: 244,
    message: "Rota inativada após cancelamento da NF.",
  },
  {
    correlationId: "RECEIPT:01:000123456",
    direction: "WAYDATA_TO_CIGAM",
    entity: "RECEIPT",
    operation: "SYNC",
    reference: { company: "01", invoice: "000123456", route: "88231" },
    request: { method: "GET", endpoint: "/rota?codigoRota=88231" },
    attempt: 2,
    status: "PENDING",
    httpStatus: 200,
    durationMs: 427,
    message: "Aguardando disponibilização da imagem do canhoto.",
  },
];

for (const [index, sample] of samples.entries()) {
  await store.writeLog({
    id: randomUUID(),
    timestamp: new Date(base - index * 83_000).toISOString(),
    ...sample,
  });
}

await store.heartbeat({
  status: "IDLE",
  lastCycleAt: new Date(base - 5 * 60_000).toISOString(),
  lastSeenAt: new Date().toISOString(),
  syncEnabled: false,
  mode: "DEMO",
});

console.log(`Dados de demonstração gravados em ${path.resolve(process.env.DATA_DIRECTORY ?? "./data")}`);
