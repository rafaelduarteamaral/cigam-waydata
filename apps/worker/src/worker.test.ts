import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonlStore } from "@cigam-waydata/file-logger";
import type { CigamRoute } from "@cigam-waydata/shared";
import { describe, expect, it, vi } from "vitest";
import { IntegrationWorker } from "./worker";

const route: CigamRoute = {
  id: "R1", company: "01", branch: "01", updatedAt: new Date().toISOString(), operation: "UPSERT",
  clients: [{ code: "C1", changed: false, addressChanged: false, payload: { codigo: "C1", nome: "Cliente Teste", classificacao: "A", endereco: { logradouro: "Rua A", bairro: "Centro", numero: 1, cep: "89010000", municipio: "Blumenau", uf: "SC" } } }], invoices: [],
  routing: { nome: "Rota teste", codigoClientePartida: "C1", codigoClienteChegada: "C1", dataInicial: "2026-08-08T08:00:00", dataFinal: "2026-08-08T18:00:00", veiculosRoteirizacao: [{ remessas: [{ numeroRemessa: "P1", codigoCliente: "C1", cnpjEmissor: "12.345.678/0001-90", itensRemessa: [{ codigo: "I1", descricao: "Item teste", volumeUnitario: 1, pesoUnitario: 1, valorUnitario: 10, quantidade: 1 }] }] }] },
};

describe("IntegrationWorker", () => {
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
