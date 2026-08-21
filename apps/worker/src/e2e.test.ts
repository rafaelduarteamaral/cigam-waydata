import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CigamClient } from "@cigam-waydata/cigam-client";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { WayDataClient } from "@cigam-waydata/waydata-client";
import { afterEach, describe, expect, it } from "vitest";
import { IntegrationWorker } from "./worker";

type RecordedCall = { method: string; url: string; authorization: string | undefined; body: unknown };
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function bodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>): Promise<string> {
  const server = createServer((request, response) => void handler(request, response));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  return `http://127.0.0.1:${address.port}`;
}

describe("client-like end-to-end homologation", () => {
  it("creates a customer and route, returns delivery status, and attaches the signed receipt once", async () => {
    const cigamCalls: RecordedCall[] = [];
    const wayDataCalls: RecordedCall[] = [];
    let receiptUrl = "";
    const route = {
      id: "R-100", company: "01", branch: "01", updatedAt: "2026-08-08T10:00:00-03:00", operation: "UPSERT",
      clients: [{ code: "C-10", changed: false, addressChanged: false, payload: { codigo: "C-10", nome: "Cliente Homologação", classificacao: "A", endereco: { logradouro: "Rua Homolog", bairro: "Centro", numero: 100, cep: "89010000", municipio: "Blumenau", uf: "SC" } } }],
      invoices: [{ id: "NF-500", number: "500" }],
      routing: { nome: "Rota homologacao", codigoClientePartida: "C-10", codigoClienteChegada: "C-10", dataInicial: "2026-08-08T08:00:00", dataFinal: "2026-08-08T18:00:00", veiculosRoteirizacao: [{ placa: "ABC1D23", remessas: [{ numeroRemessa: "PED-20", codigoCliente: "C-10", cnpjEmissor: "12.345.678/0001-90", itensRemessa: [{ codigo: "ITEM-1", descricao: "Produto de homologacao", volumeUnitario: 1, pesoUnitario: 2, valorUnitario: 30, quantidade: 1 }] }] }] },
    };

    const cigamUrl = await listen(async (request, response) => {
      const body = await bodyOf(request);
      cigamCalls.push({ method: request.method ?? "", url: request.url ?? "", authorization: request.headers.authorization, body });
      if (request.method === "GET" && request.url?.startsWith("/integracoes/waydata/rotas")) return json(response, 200, [route]);
      return json(response, 200, { ok: true });
    });
    const wayDataUrl = await listen(async (request, response) => {
      const body = await bodyOf(request);
      wayDataCalls.push({ method: request.method ?? "", url: request.url ?? "", authorization: request.headers.authorization, body });
      if (request.method === "GET" && request.url?.startsWith("/cliente/id")) return json(response, 404, { message: "not found" });
      if (request.method === "PUT" && request.url === "/Roteirizacao/integracao") return json(response, 200, { nome: "Rota homologacao", CodigoRoteirizacao: 7001, veiculoRoteirizacao: [], status: 200 });
      if (request.method === "GET" && request.url?.startsWith("/rota?")) return json(response, 200, [{ routeCode: 7001, orderCode: "PED-20", invoiceId: "NF-500", status: "ENTREGUE", occurredAt: "2026-08-08T14:00:00-03:00", receiptId: "REC-1", receiptUrl }]);
      if (request.method === "GET" && request.url === "/receipt.pdf") { response.writeHead(200, { "Content-Type": "application/pdf" }); response.end(Buffer.from("%PDF-1.4 signed receipt")); return; }
      return json(response, 200, { ok: true });
    });
    receiptUrl = `${wayDataUrl}/receipt.pdf`;

    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "cigam-waydata-e2e-")));
    const worker = new IntegrationWorker({ store, enabled: true, concurrency: 2, cigam: new CigamClient({ baseUrl: cigamUrl, token: "cigam-secret", maxRetries: 0 }), wayData: new WayDataClient({ baseUrl: wayDataUrl, token: "waydata-secret", maxRetries: 0 }) });
    await worker.runCycle();
    await worker.runCycle();

    expect(wayDataCalls.map((call) => `${call.method} ${call.url}`)).toEqual(expect.arrayContaining(["GET /cliente/id?codigo=C-10", "PUT /cliente", "PUT /Roteirizacao/integracao", "GET /receipt.pdf"]));
    expect(cigamCalls.map((call) => `${call.method} ${call.url}`)).toEqual(expect.arrayContaining(["PATCH /integracoes/waydata/rotas/R-100/status", "POST /notas-fiscais/NF-500/acompanhamentos", "POST /notas-fiscais/NF-500/anexos"]));
    expect(cigamCalls.filter((call) => call.url === "/notas-fiscais/NF-500/anexos")).toHaveLength(1);
    expect(cigamCalls.find((call) => call.url === "/notas-fiscais/NF-500/anexos")?.body).toMatchObject({ filename: "canhoto-NF-500.pdf", contentType: "application/pdf" });
    expect(wayDataCalls.every((call) => call.authorization === "Bearer waydata-secret")).toBe(true);
    expect(cigamCalls.every((call) => call.authorization === "Bearer cigam-secret")).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const logs = await store.readLogs(today, today);
    expect(logs.some((event) => event.entity === "RECEIPT" && event.status === "SUCCESS")).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("waydata-secret");
    expect(JSON.stringify(logs)).not.toContain("cigam-secret");
  });
});
