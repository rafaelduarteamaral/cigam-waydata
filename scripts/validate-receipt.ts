import path from "node:path";
import { fileURLToPath } from "node:url";
import { CigamClient } from "../packages/cigam-client/src/index";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { mapIntegraWayDeliveries } from "@cigam-waydata/shared";
import { WayDataClient } from "../packages/waydata-client/src/index";
import { loadConfig } from "../apps/worker/src/config";
import { IntegrationWorker } from "../apps/worker/src/worker";

// Defaults to a preview. Writing requires both explicit identifiers and --write.
const args = process.argv.slice(2);
const routeCode = args.find((arg) => arg.startsWith("--route-code="))?.slice("--route-code=".length);
const invoiceId = args.find((arg) => arg.startsWith("--invoice="))?.slice("--invoice=".length);
if (!routeCode || !invoiceId || !/^\d+$/.test(routeCode) || !/^\d+$/.test(invoiceId)
  || args.some((arg) => !/^(--route-code=\d+|--invoice=\d+|--write)$/.test(arg))) {
  throw new Error("Uso: tsx scripts/validate-receipt.ts --route-code=5445535 --invoice=4227 [--write]");
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.loadEnvFile(process.env.ENV_FILE ?? path.join(root, ".env"));
const write = args.includes("--write");
// This process alone needs both clients when writing; the .env is preserved.
if (write) process.env.SYNC_MODE = "write";
const config = write ? loadConfig() : undefined;
if (!process.env.WAYDATA_BASE_URL || !process.env.WAYDATA_TOKEN) throw new Error("Configuração WayData ausente");
const wayData = new WayDataClient({ baseUrl: process.env.WAYDATA_BASE_URL, token: process.env.WAYDATA_TOKEN,
  timeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? 30_000), maxRetries: 0 });
const results = mapIntegraWayDeliveries(await wayData.getRoute(routeCode)).filter((result) =>
  String(result.routeCode) === routeCode && result.invoiceId === invoiceId && result.receiptUrl);
if (!results.length) throw new Error("Nenhum canhoto disponível para a rota e NF informadas");
if (results.some((result) => !result.companyCode)) throw new Error("Cliente da NF não informado pela WayData");
const store = new JsonlStore(config?.dataDirectory ?? path.resolve(process.env.DATA_DIRECTORY ?? "./data"));
const worker = config ? new IntegrationWorker({ store, wayData, enabled: true,
  cigam: new CigamClient({ ...config.cigam!, timeoutMs: config.timeoutMs, maxRetries: 0 }) }) : undefined;
for (const result of results) {
  const receiptKey = `RECEIPT:${result.invoiceId}:${result.receiptId ?? result.receiptUrl}`;
  const alreadyRecorded = await store.hasSuccessfulCorrelation(receiptKey);
  // Verify the actual link even for the ASMX contract, which stores URLs.
  const photo = await wayData.downloadReceipt(result.receiptUrl!);
  console.log(JSON.stringify({ mode: write ? "write" : "preview", routeCode,
    invoiceId, orderCode: result.orderCode, companyCode: result.companyCode, status: result.status,
    contentType: photo.contentType, bytes: photo.bytes.byteLength, alreadyRecorded }));
  if (!worker) continue;
  await worker.processDelivery(result);
  if (!(await store.hasSuccessfulCorrelation(receiptKey))) {
    throw new Error("Registro do canhoto não confirmado; consulte o log de integração");
  }
  console.log(JSON.stringify({ invoiceId, outcome: alreadyRecorded ? "already-recorded" : "recorded" }));
}
