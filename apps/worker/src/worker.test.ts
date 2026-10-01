import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { mapIntegraWayDeliveries, type CigamRoute } from "@cigam-waydata/shared";
import { describe, expect, it, vi } from "vitest";
import { IntegrationWorker } from "./worker";
import { WayDataClient } from "@cigam-waydata/waydata-client";
import { randomUUID } from "node:crypto";

const route: CigamRoute = {
  id: "R1", company: "01", branch: "01", updatedAt: new Date().toISOString(), operation: "UPSERT",
  clients: [{ code: "C1", changed: false, addressChanged: false, payload: { codigo: "C1", nome: "Cliente Teste", classificacao: "A", endereco: { logradouro: "Rua A", bairro: "Centro", numero: 1, cep: "89010000", municipio: "Blumenau", uf: "SC" } } }], invoices: [],
  routing: { nome: "Rota teste", codigoClientePartida: "C1", codigoClienteChegada: "C1", dataInicial: "2026-08-08T08:00:00", dataFinal: "2026-08-08T18:00:00", veiculosRoteirizacao: [{ remessas: [{ numeroRemessa: "P1", codigoCliente: "C1", cnpjEmissor: "12.345.678/0001-90", itensRemessa: [{ codigo: "I1", descricao: "Item teste", volumeUnitario: 1, pesoUnitario: 1, valorUnitario: 10, quantidade: 1 }] }] }] },
};

describe("IntegrationWorker", () => {
  it("rescans completed daily covers for late and additional receipt URLs, even if CIGAM listing fails", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-daily-scan-")));
    const url = "https://wayds.net/photo.png";
    const otherUrl = "https://wayds.net/second.png";
    let urls: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (address: string) => new Response(JSON.stringify(
      address.includes("/capa?") ? [{ codigo: 5445535 }] : { codigo: 5445535, entregas: [{ codigoCliente: "008017", pedidos: [{
        codigo: "41561-4227", nfe: 4227, status: { descricao: "Entregue" }, fotos: urls.map(url => ({ codigo: 0, url })),
      }] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const cigam = { usesReceiptLinks: true, listPendingRoutes: vi.fn().mockRejectedValue(new Error("CIGAM listing failed")),
        recordInvoiceFollowUp: vi.fn().mockResolvedValue({}) };
      const worker = new IntegrationWorker({ store, enabled: true, cigam: cigam as never,
        wayData: new WayDataClient({ baseUrl: "https://wayds.net", token: "test", maxRetries: 0 }) });
      await worker.runCycle();
      expect(await store.readPendingReceiptRoutes()).toEqual(["5445535"]);
      urls = [url];
      await worker.runCycle();
      expect(await store.readPendingReceiptRoutes()).toEqual([]);
      urls = [url, otherUrl];
      await worker.runCycle();
      await worker.runCycle();
      expect(fetchMock.mock.calls.filter(call => String(call[0]).includes("/capa?"))).toHaveLength(4);
      expect(fetchMock.mock.calls.filter(call => String(call[0]).includes("/rota?"))).toHaveLength(4);
      const receipts = cigam.recordInvoiceFollowUp.mock.calls.map(call => call[0]).filter(call => call.result.receiptUrl);
      expect(receipts.map(call => call.result.receiptUrl)).toEqual([url, otherUrl]);
      expect(receipts.every(call => call.invoiceId === "4227")).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([false, true])("reprocesses an invoice receipt using the WayData route (legacy queue: %s)", async (legacy) => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-reprocess-receipt-")));
    const correlationId = "DELIVERY:4227:41561-4227:NAO_INFORMADO";
    await store.writeLog({ id: randomUUID(), timestamp: new Date().toISOString(), correlationId,
      status: "SUCCESS", entity: "ORDER", operation: "READ", direction: "WAYDATA_TO_CIGAM", attempt: 1,
      reference: { route: "5445535", invoice: "4227" }, message: "Status não informado sem canhoto" });
    await store.requestReprocess({ id: randomUUID(), requestedAt: new Date().toISOString(), requestedBy: "test",
      originalCorrelationId: correlationId, entity: "ORDER", reference: "4227", status: "PENDING",
      ...(!legacy ? { routeCode: "5445535", invoiceId: "4227" } : {}) });
    const cigam = { usesReceiptLinks: true, listPendingRoutes: vi.fn().mockResolvedValue([]),
      getRoute: vi.fn(), recordInvoiceFollowUp: vi.fn().mockResolvedValue({}) };
    const wayData = { listDeliveryResults: vi.fn().mockResolvedValue([]), getRoute: vi.fn().mockResolvedValue({ codigo: 5445535,
      entregas: [{ codigoCliente: "008017", pedidos: [
        { codigo: "41561-4227", nfe: 4227, status: { descricao: "Entregue" }, fotos: [{ codigo: 0, url: "https://wayds.net/new.png" }] },
        { codigo: "41561-4234", nfe: 4234, status: { descricao: "Entregue" }, fotos: [{ codigo: 0, url: "https://wayds.net/other.png" }] },
      ] }] }) };
    await new IntegrationWorker({ store, enabled: true, cigam: cigam as never, wayData: wayData as never }).runCycle();
    expect(wayData.getRoute).toHaveBeenCalledWith("5445535");
    expect(cigam.getRoute).not.toHaveBeenCalled();
    expect(cigam.recordInvoiceFollowUp).toHaveBeenCalledOnce();
    expect(cigam.recordInvoiceFollowUp).toHaveBeenCalledWith(expect.objectContaining({ invoiceId: "4227" }));
    expect((await store.readReprocessRequests())[0]?.status).toBe("DONE");
    expect(await store.readPendingReceiptRoutes()).toEqual(["5445535"]);
  });

  it("continues with another NF when CIGAM rejects one receipt", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-nf-failure-")));
    const cigam = { usesReceiptLinks: true, listPendingRoutes: vi.fn().mockResolvedValue([]),
      recordInvoiceFollowUp: vi.fn().mockImplementation(async ({ invoiceId }) => {
        if (invoiceId === "1") throw new Error("NF indisponível");
        return {};
      }) };
    const wayData = { listDeliveryResults: vi.fn().mockResolvedValue(["1", "2"].map(invoiceId => ({
      routeCode: Number(invoiceId), invoiceId, orderCode: invoiceId, status: "ENTREGUE",
      receiptUrl: `https://wayds.net/${invoiceId}.png`,
    }))) };
    await new IntegrationWorker({ store, enabled: true, cigam: cigam as never, wayData: wayData as never }).runCycle();
    expect(cigam.recordInvoiceFollowUp).toHaveBeenCalledTimes(2);
    expect(await store.readPendingReceiptRoutes()).toEqual(["1"]);
    expect(await store.hasSuccessfulCorrelation("RECEIPT:2:https://wayds.net/2.png")).toBe(true);
  });

  it("scans the local day near midnight instead of the next UTC day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T01:30:00Z"));
    vi.stubEnv("TZ", "America/Sao_Paulo");
    try {
      const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-local-day-")));
      const cigam = { listPendingRoutes: vi.fn().mockResolvedValue([]) };
      const wayData = { listDeliveryResults: vi.fn().mockResolvedValue([]) };
      await new IntegrationWorker({ store, enabled: true, deliveryLookbackDays: 1, cigam: cigam as never, wayData: wayData as never }).runCycle();
      expect(wayData.listDeliveryResults).toHaveBeenCalledWith("2026-10-01", "2026-10-01", [], expect.any(Function));
    } finally { vi.useRealTimers(); vi.unstubAllEnvs(); }
  });

  it("keeps an explicitly reprocessed route pending when its photo has not arrived", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-reprocess-waiting-")));
    const id = randomUUID();
    await store.requestReprocess({ id, requestedAt: new Date().toISOString(), requestedBy: "test",
      originalCorrelationId: "DELIVERY:4227:41561-4227:NAO_INFORMADO", entity: "ORDER", reference: "4227",
      routeCode: "5445535", invoiceId: "4227", status: "PENDING" });
    const cigam = { listPendingRoutes: vi.fn().mockResolvedValue([]), recordInvoiceFollowUp: vi.fn() };
    const wayData = { listDeliveryResults: vi.fn().mockResolvedValue([]), getRoute: vi.fn().mockResolvedValue({ codigo: 5445535,
      entregas: [{ pedidos: [{ codigo: "41561-4227", nfe: 4227, status: { descricao: "NaoInformado" }, fotos: [] }] }] }) };
    await new IntegrationWorker({ store, enabled: true, cigam: cigam as never, wayData: wayData as never }).runCycle();
    expect(cigam.recordInvoiceFollowUp).not.toHaveBeenCalled();
    expect(await store.readPendingReceiptRoutes()).toEqual(["5445535"]);
    const events = await store.readLogs("0000-01-01", "9999-12-31");
    expect(events.find(event => event.correlationId === `REPROCESS:${id}`)?.message).toContain("ainda indisponível");
  });

  it("validates the client before creating and completing a route", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-")));
    const cigam = { listPendingRoutes: vi.fn().mockResolvedValue([route]), updateIntegrationStatus: vi.fn().mockResolvedValue({}) };
    const wayData = { getClient: vi.fn().mockResolvedValue(null), createClient: vi.fn().mockResolvedValue({}), createRouting: vi.fn().mockResolvedValue({ CodigoRoteirizacao: 99 }), listDeliveryResults: vi.fn().mockResolvedValue([]) };
    const worker = new IntegrationWorker({ store, enabled: true, cigam: cigam as never, wayData: wayData as never });
    await worker.runCycle();
    expect(wayData.getClient).toHaveBeenCalledBefore(wayData.createRouting);
    expect(wayData.createClient).toHaveBeenCalledOnce();
    expect(cigam.updateIntegrationStatus).toHaveBeenCalledWith("R1", expect.objectContaining({ status: "INTEGRATED", externalCode: 99 }));
  });

  it.each([
    [{ ...route, operation: "CANCEL_ROUTE" as const, externalCode: 77 }, "deleteRoute", "77"],
    [{ ...route, operation: "CANCEL_ORDER" as const, orderCode: "P-9" }, "deleteOrder", "P-9"],
  ])("propagates controlled cancellations", async (cancelledRoute, method, expectedCode) => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-cancel-")));
    const cigam = { listPendingRoutes: vi.fn().mockResolvedValue([cancelledRoute]), updateIntegrationStatus: vi.fn().mockResolvedValue({}) };
    const wayData = { deleteRoute: vi.fn().mockResolvedValue({}), deleteOrder: vi.fn().mockResolvedValue({}), listDeliveryResults: vi.fn().mockResolvedValue([]) };
    const worker = new IntegrationWorker({ store, enabled: true, cigam: cigam as never, wayData: wayData as never });
    await worker.runCycle();
    expect(wayData[method as "deleteRoute" | "deleteOrder"]).toHaveBeenCalledWith(expectedCode);
    expect(cigam.updateIntegrationStatus).toHaveBeenCalledWith("R1", expect.objectContaining({ status: "CANCELLED" }));
  });

  it("does not duplicate read-only discovery events across cycles", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-read-only-")));
    const cigam = { listPendingRoutes: vi.fn().mockResolvedValue([route]) };
    const worker = new IntegrationWorker({ store, enabled: true, writeEnabled: false, cigam: cigam as never });
    await worker.runCycle();
    await worker.runCycle();
    const today = new Date().toISOString().slice(0, 10);
    const logs = await store.readLogs(today, today);
    expect(logs.filter((event) => event.correlationId === "DISCOVERY:01:R1")).toHaveLength(1);
  });

  it("loads allowlisted routes directly in read-only mode", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-read-only-allowlist-")));
    const allowlistedRoute = { ...route, id: "38484" };
    const cigam = { listPendingRoutes: vi.fn().mockResolvedValue([]), getRoute: vi.fn().mockResolvedValue(allowlistedRoute) };
    await new IntegrationWorker({ store, enabled: true, writeEnabled: false, routeAllowlist: ["38484"], cigam: cigam as never }).runCycle();
    expect(cigam.getRoute).toHaveBeenCalledWith("38484");
    expect(cigam.listPendingRoutes).not.toHaveBeenCalled();
    const today = new Date().toISOString().slice(0, 10);
    await expect(store.readLogs(today, today)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ correlationId: "DISCOVERY:01:38484", status: "SUCCESS" }),
    ]));
  });

  it("does not retry HTTP 400 and enqueues reprocess for HTTP 500", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-http-")));
    const cigam = { listPendingRoutes: vi.fn().mockResolvedValue([route]), updateIntegrationStatus: vi.fn().mockResolvedValue({}) };
    const wayData400 = {
      getClient: vi.fn().mockResolvedValue({ codigo: "C1", nome: "Cliente Teste", classificacao: "A" }),
      createRouting: vi.fn().mockRejectedValue(Object.assign(new Error("HTTP 400"), { name: "HttpError", status: 400, body: { message: "payload inválido" }, endpoint: "/Roteirizacao/integracao" })),
      listDeliveryResults: vi.fn().mockResolvedValue([]),
    };
    await new IntegrationWorker({ store, enabled: true, cigam: cigam as never, wayData: wayData400 as never }).runCycle();
    expect(await store.readReprocessRequests()).toHaveLength(0);
    const today = new Date().toISOString().slice(0, 10);
    await expect(store.readLogs(today, today)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        correlationId: "ROUTE:01:R1",
        status: "ERROR",
        request: { method: "PUT", endpoint: "/Roteirizacao/integracao" },
        requestPayload: expect.objectContaining({ nome: "R1-0808", codigoRoteirizacao: 0 }),
      }),
    ]));

    const store500 = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-500-")));
    const wayData500 = {
      getClient: vi.fn().mockResolvedValue({ codigo: "C1", nome: "Cliente Teste", classificacao: "A" }),
      createRouting: vi.fn().mockRejectedValue(Object.assign(new Error("HTTP 500"), { name: "HttpError", status: 500, body: null, endpoint: "/Roteirizacao/integracao" })),
      listDeliveryResults: vi.fn().mockResolvedValue([]),
    };
    await new IntegrationWorker({ store: store500, enabled: true, cigam: cigam as never, wayData: wayData500 as never }).runCycle();
    await expect(store500.readReprocessRequests()).resolves.toMatchObject([{ reference: "R1", status: "PENDING" }]);
  });

  it("does not reopen CIGAM when WayData update fails after the route is already mapped", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-mapped-405-")));
    await store.setRouteExternalCode("01:R1", 1277542);
    const cigam = { listPendingRoutes: vi.fn().mockResolvedValue([route]), updateIntegrationStatus: vi.fn().mockResolvedValue({}) };
    const wayData = {
      getClient: vi.fn().mockResolvedValue({ codigo: "C1", nome: "Cliente Teste", classificacao: "A" }),
      updateRouting: vi.fn().mockRejectedValue(Object.assign(new Error("HTTP 500"), { name: "HttpError", status: 500, body: null, endpoint: "https://wayds.net/integraway/api/v1/cliente" })),
      listDeliveryResults: vi.fn().mockResolvedValue([]),
    };
    await new IntegrationWorker({ store, enabled: true, cigam: cigam as never, wayData: wayData as never }).runCycle();
    expect(wayData.updateRouting).toHaveBeenCalledOnce();
    expect(cigam.updateIntegrationStatus).not.toHaveBeenCalled();
    expect(await store.readReprocessRequests()).toHaveLength(0);
  });

  it("marks CIGAM integrated again when WayData omits PATCH on an already mapped route", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-mapped-skip-")));
    await store.setRouteExternalCode("01:R1", 1277542);
    const cigam = { listPendingRoutes: vi.fn().mockResolvedValue([route]), updateIntegrationStatus: vi.fn().mockResolvedValue({}) };
    const wayData = {
      getClient: vi.fn().mockResolvedValue({ codigo: "C1", nome: "Cliente Teste", classificacao: "A" }),
      updateRouting: vi.fn().mockResolvedValue({ nome: "Rota teste", CodigoRoteirizacao: 1277542, veiculoRoteirizacao: [], status: 405 }),
      listDeliveryResults: vi.fn().mockResolvedValue([]),
    };
    await new IntegrationWorker({ store, enabled: true, cigam: cigam as never, wayData: wayData as never }).runCycle();
    expect(cigam.updateIntegrationStatus).toHaveBeenCalledWith("R1", expect.objectContaining({ status: "INTEGRATED", externalCode: 1277542 }));
    const today = new Date().toISOString().slice(0, 10);
    const logs = await store.readLogs(today, today);
    expect(logs.some((event) => event.correlationId === "ROUTE:01:R1" && event.status === "SUCCESS" && event.httpStatus === 405)).toBe(true);
  });

  it("records ASMX receipt links without downloads and retries failures before marking success", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-links-")));
    const cigam = {
      usesReceiptLinks: true,
      listPendingRoutes: vi.fn().mockResolvedValue([]),
      recordInvoiceFollowUp: vi.fn().mockRejectedValueOnce(new Error("CIGAM indisponível")).mockResolvedValue({}),
    };
    const result = { routeCode: 9001, orderCode: "P1", invoiceId: "438694", companyCode: "000835", status: "ENTREGUE", receiptId: "F1", receiptUrl: "https://wayds.net/canhoto.jpg" };
    const wayData = { listDeliveryResults: vi.fn().mockResolvedValue([result]), downloadReceipt: vi.fn() };
    const worker = new IntegrationWorker({ store, enabled: true, cigam: cigam as never, wayData: wayData as never });
    await worker.runCycle();
    await worker.runCycle();
    await worker.runCycle();
    expect(wayData.downloadReceipt).not.toHaveBeenCalled();
    expect(cigam.recordInvoiceFollowUp).toHaveBeenCalledTimes(2);
    expect(cigam.recordInvoiceFollowUp).toHaveBeenLastCalledWith({ invoiceId: "438694", result, idempotencyKey: "RECEIPT:438694:F1" });
  });

  it("records published Panebras photos only for their NF and retries each zero-code photo once", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-panebras-photo-")));
    const cigam = { usesReceiptLinks: true, listPendingRoutes: vi.fn().mockResolvedValue([]),
      recordInvoiceFollowUp: vi.fn().mockResolvedValue({}) };
    const url = "https://restrito.waydatasolution.com.br/proxyway/api/v1/proxy/foto?codigoFoto=29618247&estabelecimento=915";
    const otherUrl = url.replace("29618247", "29618248");
    const results = mapIntegraWayDeliveries({ codigo: 5445535, entregas: [{ codigoCliente: "008017", pedidos: [
      { codigo: "41561-4227", nfe: 4227, tipoStatus: 0, status: { descricao: "Entregue" },
        fotos: [{ codigo: 0, url }, { codigo: 0, url: otherUrl }] },
      { codigo: "41561", nfe: 449650, status: { descricao: "NaoInformado" }, fotos: [] },
    ] }] });
    const wayData = { listDeliveryResults: vi.fn().mockResolvedValue(results), downloadReceipt: vi.fn() };
    const worker = new IntegrationWorker({ store, enabled: true, cigam: cigam as never, wayData: wayData as never });
    await worker.runCycle();
    await worker.runCycle();
    expect(cigam.recordInvoiceFollowUp).toHaveBeenCalledTimes(2);
    for (const receiptUrl of [url, otherUrl]) {
      expect(cigam.recordInvoiceFollowUp).toHaveBeenCalledWith(expect.objectContaining({
        invoiceId: "4227", idempotencyKey: `RECEIPT:4227:${receiptUrl}`,
        result: expect.objectContaining({ invoiceId: "4227", receiptUrl, companyCode: "008017" }),
      }));
    }
    expect(wayData.downloadReceipt).not.toHaveBeenCalled();
  });

  it("persists pending photos across restarts until Realizado, URL and CIGAM success", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "worker-pending-photo-"));
    const store = new JsonlStore(directory);
    const cigam = { usesReceiptLinks: true, listPendingRoutes: vi.fn().mockResolvedValue([]),
      recordInvoiceFollowUp: vi.fn<(input: { result: { receiptUrl?: string } }) => Promise<unknown>>().mockResolvedValue({}) };
    const payload = (statusMarcacao: string, url: string) => mapIntegraWayDeliveries({ codigo: 9001,
      entregas: [{ pedidos: [{ codigo: "P1", nfe: 123, status: { descricao: "Entregue" },
        fotos: [{ codigo: 88, statusMarcacao, url }] }] }] });
    const wayData = { listDeliveryResults: vi.fn().mockResolvedValue(payload("Pendente", "https://example.com/photo.jpg")), downloadReceipt: vi.fn() };
    const run = () => new IntegrationWorker({ store: new JsonlStore(directory), enabled: true,
      cigam: cigam as never, wayData: wayData as never }).runCycle();
    await run();
    expect(await store.readPendingReceiptRoutes()).toEqual(["9001"]);
    expect(cigam.recordInvoiceFollowUp.mock.calls[0]?.[0]?.result.receiptUrl).toBeUndefined();
    wayData.listDeliveryResults.mockResolvedValue([]);
    await run();
    expect(await store.readPendingReceiptRoutes()).toEqual(["9001"]);
    wayData.listDeliveryResults.mockResolvedValue(payload("Realizado", ""));
    await run();
    expect(await store.readPendingReceiptRoutes()).toEqual(["9001"]);
    wayData.listDeliveryResults.mockResolvedValue(payload("Realizado", "https://example.com/photo.jpg"));
    cigam.recordInvoiceFollowUp.mockRejectedValueOnce(new Error("CIGAM indisponível"));
    await run();
    expect(await store.readPendingReceiptRoutes()).toEqual(["9001"]);
    await run();
    expect(wayData.listDeliveryResults).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), ["9001"], expect.any(Function));
    expect(await store.readPendingReceiptRoutes()).toEqual([]);
    const calls = cigam.recordInvoiceFollowUp.mock.calls.length;
    await run();
    expect(cigam.recordInvoiceFollowUp).toHaveBeenCalledTimes(calls);
    expect(wayData.downloadReceipt).not.toHaveBeenCalled();
  });

  it("skips NAO_INFORMADO without receipt and creates a new follow-up for PARCIAL and REENTREGA", async () => {
    const store = new JsonlStore(await mkdtemp(path.join(os.tmpdir(), "worker-delivery-")));
    const cigam = { listPendingRoutes: vi.fn().mockResolvedValue([]), recordInvoiceFollowUp: vi.fn().mockResolvedValue({}) };
    const wayData = {
      listDeliveryResults: vi.fn().mockResolvedValue([
        { routeCode: 1, orderCode: "P1", invoiceId: "NF-1", status: "NAO_INFORMADO" },
        { routeCode: 1, orderCode: "P2", invoiceId: "NF-2", status: "PARCIAL" },
        { routeCode: 1, orderCode: "P2", invoiceId: "NF-2", status: "REENTREGA" },
      ]),
    };
    await new IntegrationWorker({ store, enabled: true, cigam: cigam as never, wayData: wayData as never }).runCycle();
    expect(cigam.recordInvoiceFollowUp).toHaveBeenCalledTimes(2);
    expect(cigam.recordInvoiceFollowUp).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ status: "PARCIAL" }) }));
    expect(cigam.recordInvoiceFollowUp).toHaveBeenCalledWith(expect.objectContaining({ result: expect.objectContaining({ status: "REENTREGA" }) }));
  });
});
