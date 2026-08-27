import { randomUUID } from "node:crypto";
import { CigamClient } from "@cigam-waydata/cigam-client";
import { JsonlStore } from "@cigam-waydata/file-logger";
import { classifyHttpError } from "@cigam-waydata/http-client";
import { cigamRouteSchema, routingClientCodes, sanitizeValue, shouldCreateDeliveryFollowUp, uniqueRouteName, wayDataClientSchema, wayDataRoutingSchema, type CigamRoute, type DeliveryResult, type LogEvent, type WayDataClient as WayDataClientPayload } from "@cigam-waydata/shared";
import { WayDataClient } from "@cigam-waydata/waydata-client";
import type { AlertNotifier } from "@cigam-waydata/notifications";

export interface WorkerDependencies {
  store: JsonlStore;
  cigam?: CigamClient;
  wayData?: WayDataClient;
  enabled: boolean;
  writeEnabled?: boolean;
  concurrency?: number;
  deliveryLookbackDays?: number;
  logRetentionDays?: number;
  routeAllowlist?: string[];
  maxWriteRoutes?: number;
  notifier?: AlertNotifier;
}

export class IntegrationWorker {
  private running = false;
  constructor(private readonly dependencies: WorkerDependencies) {}

  async runCycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const startedAt = new Date();
    const cycleId = `CYCLE:${randomUUID()}`;
    try {
      await this.dependencies.store.purgeExpired(this.dependencies.logRetentionDays ?? 180).catch(() => 0);
      await this.dependencies.store.heartbeat({ status: "RUNNING", cycleId, startedAt: startedAt.toISOString(), lastSeenAt: new Date().toISOString(), syncEnabled: this.dependencies.enabled, syncMode: this.dependencies.writeEnabled === false ? "READ_ONLY" : this.dependencies.enabled ? "WRITE" : "DISABLED" });
      if (!this.dependencies.enabled || !this.dependencies.cigam) {
        await this.log({ correlationId: cycleId, status: "SUCCESS", message: "Worker ativo em modo seguro; sincronização externa desabilitada.", durationMs: Date.now() - startedAt.getTime() });
        return;
      }
      if (this.dependencies.writeEnabled !== false) await this.processReprocessQueue();
      const routes = await this.loadRoutes();
      if (this.dependencies.writeEnabled === false) {
        const known = await this.dependencies.store.successfulCorrelationIds("DISCOVERY:");
        let newRoutes = 0;
        for (const route of routes) {
          const correlationId = `DISCOVERY:${route.company}:${route.id}`;
          if (known.has(correlationId)) continue;
          await this.log({ correlationId, status: "SUCCESS", entity: "ROUTE", operation: "READ", direction: "CIGAM_TO_WAYDATA", message: "Carga real localizada no CIGAM; modo somente leitura, nenhum dado alterado.", reference: this.reference(route), ...(route.externalCode != null ? { externalCode: route.externalCode } : {}) });
          newRoutes += 1;
        }
        await this.log({ correlationId: cycleId, status: "SUCCESS", message: `Leitura real concluída: ${routes.length} carga(s) consultadas, ${newRoutes} nova(s); escrita desabilitada.`, durationMs: Date.now() - startedAt.getTime() });
        return;
      }
      if (!this.dependencies.wayData) throw new Error("WayData não configurada para modo de escrita");
      await this.mapLimited(routes, (route) => this.processRoute(route));
      await this.processDeliveryReturns();
      await this.log({ correlationId: cycleId, status: "SUCCESS", message: `Ciclo concluído: ${routes.length} rota(s) avaliadas.`, durationMs: Date.now() - startedAt.getTime() });
    } catch (error) {
      const classified = classifyHttpError(error);
      await this.log({ correlationId: cycleId, status: "ERROR", message: classified.message, durationMs: Date.now() - startedAt.getTime(), ...(classified.httpStatus != null ? { httpStatus: classified.httpStatus } : {}), errorCode: classified.kind });
    } finally {
      await this.dependencies.store.heartbeat({ status: "IDLE", cycleId, lastCycleAt: startedAt.toISOString(), lastSeenAt: new Date().toISOString(), syncEnabled: this.dependencies.enabled, syncMode: this.dependencies.writeEnabled === false ? "READ_ONLY" : this.dependencies.enabled ? "WRITE" : "DISABLED" });
      this.running = false;
    }
  }

  private async loadRoutes(): Promise<CigamRoute[]> {
    const allowlist = this.dependencies.routeAllowlist ?? [];
    // A allowlist é uma forma segura de homologar uma carga conhecida: também
    // deve funcionar em modo somente leitura, sem depender da listagem geral.
    if (allowlist.length) {
      const loaded: CigamRoute[] = [];
      for (const id of allowlist) {
        try {
          loaded.push(await this.dependencies.cigam!.getRoute(id));
        } catch (error) {
          const classified = classifyHttpError(error);
          await this.log({ correlationId: `ROUTE:ALLOWLIST:${id}`, status: "ERROR", entity: "ROUTE", operation: "READ", message: classified.message, reference: { route: id }, ...(classified.httpStatus != null ? { httpStatus: classified.httpStatus } : {}), errorCode: classified.kind });
        }
      }
      return this.filterRoutes(loaded);
    }
    return this.filterRoutes(await this.dependencies.cigam!.listPendingRoutes());
  }

  private filterRoutes(routes: CigamRoute[]): CigamRoute[] {
    const allowlist = this.dependencies.routeAllowlist ?? [];
    const selected = allowlist.length ? routes.filter((route) => allowlist.includes(route.id)) : routes;
    const limit = this.dependencies.maxWriteRoutes ?? 0;
    return limit > 0 ? selected.slice(0, limit) : selected;
  }

  private async processRoute(input: CigamRoute): Promise<void> {
    const correlationId = `ROUTE:${input.company}:${input.id}`;
    const mapKey = `${input.company}:${input.id}`;
    try {
      const route = await this.resolveRoute(input);
      if (!route) return;
      const mappedCode = await this.dependencies.store.getRouteExternalCode(mapKey);
      const externalCode = mappedCode ?? (typeof route.externalCode === "number" ? route.externalCode : Number(route.externalCode) || 0);
      if (route.operation === "CANCEL_ROUTE") {
        if (!externalCode) throw new Error("Código externo ausente para cancelamento da rota");
        await this.dependencies.wayData!.deleteRoute(String(externalCode));
        await this.completeRoute(route, correlationId, "Rota cancelada na WayData", "CANCELLED");
        return;
      }
      if (route.operation === "CANCEL_ORDER") {
        if (!route.orderCode) throw new Error("Código do pedido ausente para cancelamento");
        await this.dependencies.wayData!.deleteOrder(route.orderCode);
        await this.completeRoute(route, correlationId, "Pedido cancelado na WayData", "CANCELLED");
        return;
      }
      const routing = wayDataRoutingSchema.parse({
        ...route.routing,
        nome: uniqueRouteName(route.id, (route.routing as { dataInicial?: unknown } | undefined)?.dataInicial),
        codigoRoteirizacao: externalCode,
      });
      await this.ensureClients(route, routing);
      const response = externalCode ? await this.dependencies.wayData!.updateRouting(routing) : await this.dependencies.wayData!.createRouting(routing);
      const savedCode = Number(response.CodigoRoteirizacao ?? externalCode);
      if (savedCode) await this.dependencies.store.setRouteExternalCode(mapKey, savedCode);
      await this.dependencies.cigam!.updateIntegrationStatus(route.id, { status: "INTEGRATED", externalCode: savedCode, idempotencyKey: correlationId, synchronizedAt: new Date().toISOString() });
      await this.persistExternalCode(route, savedCode);
      await this.log({
        correlationId,
        status: "SUCCESS",
        entity: "ROUTE",
        operation: externalCode ? "UPDATE" : "CREATE",
        message: response.status === 409
          ? "Rota conciliada após conflito 409."
          : response.status === 405
            ? "Rota já integrada; WayData recusou PATCH e a atualização foi omitida."
            : "Rota sincronizada com sucesso.",
        reference: this.reference(route),
        externalCode: savedCode,
        ...(response.status === 409 || response.status === 405 ? { httpStatus: response.status, errorCode: response.status === 409 ? "CONFLICT" : "UNKNOWN" } : {}),
      });
    } catch (error) {
      const classified = classifyHttpError(error);
      const alreadyIntegrated = Boolean(await this.dependencies.store.getRouteExternalCode(mapKey));
      if (!alreadyIntegrated && this.shouldMarkCigamError(error)) {
        await this.dependencies.cigam!.updateIntegrationStatus(input.id, { status: "ERROR", error: classified.message, attemptedAt: new Date().toISOString() }).catch(() => undefined);
      }
      await this.log({ correlationId, status: "ERROR", entity: "ROUTE", message: classified.message, reference: this.reference(input), ...(classified.httpStatus != null ? { httpStatus: classified.httpStatus } : {}), errorCode: classified.kind });
      if (classified.retryable && !alreadyIntegrated) await this.enqueueRetry(input.id, correlationId);
    }
  }

  private async resolveRoute(input: CigamRoute): Promise<CigamRoute | null> {
    const vehicles = (input.routing as { veiculosRoteirizacao?: unknown[] } | undefined)?.veiculosRoteirizacao;
    const hasRemessas = Array.isArray(vehicles) && vehicles.some((vehicle) => {
      const remessas = vehicle && typeof vehicle === "object" && !Array.isArray(vehicle)
        ? (vehicle as { remessas?: unknown }).remessas
        : undefined;
      return Array.isArray(remessas) && remessas.length > 0;
    });
    if (input.clients.length && hasRemessas) return input;
    try {
      const detailed = await this.dependencies.cigam!.getRoute(input.id);
      return cigamRouteSchema.parse({ ...input, ...detailed, clients: detailed.clients.length ? detailed.clients : input.clients, invoices: detailed.invoices.length ? detailed.invoices : input.invoices, routing: detailed.routing ?? input.routing });
    } catch (error) {
      if (this.isNotFound(error)) {
        await this.log({ correlationId: `ROUTE:${input.company}:${input.id}`, status: "CANCELLED", entity: "ROUTE", operation: "READ", message: "Carga não encontrada no CIGAM; ciclo ignorado.", reference: this.reference(input), httpStatus: 404, errorCode: "NOT_FOUND" });
        return null;
      }
      throw error;
    }
  }

  private async ensureClients(route: CigamRoute, routing: ReturnType<typeof wayDataRoutingSchema.parse>): Promise<void> {
    const byCode = new Map(route.clients.map((client) => [client.code, client]));
    for (const code of routingClientCodes(routing)) {
      const current = byCode.get(code);
      const payload = await this.resolveClient(code, current?.payload ?? {});
      const existing = await this.dependencies.wayData!.getClient(code);
      if (!existing) {
        if (!payload.endereco && !payload.coordenada) {
          throw new Error(`Cliente ${code} sem endereço ou coordenada no CIGAM; a WayData recusa o cadastro`);
        }
        await this.dependencies.wayData!.createClient(payload);
      } else if (current?.changed) await this.dependencies.wayData!.updateClient(payload, !current.addressChanged);
    }
  }

  private async persistExternalCode(route: CigamRoute, savedCode: number): Promise<void> {
    if (!savedCode) return;
    const invoice = route.invoices[0];
    const correlationId = `EXTCODE:${route.company}:${route.id}:${savedCode}`;
    if (!invoice || await this.dependencies.store.hasSuccessfulCorrelation(correlationId)) return;
    await this.dependencies.cigam!.recordInvoiceFollowUp({
      invoiceId: invoice.id,
      result: { routeCode: savedCode, orderCode: route.orderCode ?? route.id, invoiceId: invoice.id, status: "INTEGRATED", ...(invoice.companyCode ? { companyCode: invoice.companyCode } : {}) },
      idempotencyKey: correlationId,
      titleCode: "INT",
      history: `WAYDATA codigoRoteirizacao=${savedCode} carga=${route.id}`,
    });
    await this.log({ correlationId, status: "SUCCESS", entity: "ROUTE", operation: "UPDATE", message: "Código WayData registrado no acompanhamento CIGAM.", reference: { ...this.reference(route), invoice: invoice.id }, externalCode: savedCode });
  }

  private async resolveClient(code: string, payload: Record<string, unknown>): Promise<WayDataClientPayload> {
    const parsed = wayDataClientSchema.safeParse(payload);
    const lookup = this.dependencies.cigam?.getCompany;
    if (typeof lookup === "function") {
      try {
        const company = await lookup.call(this.dependencies.cigam, { code });
        if (company) return company;
      } catch {
        /* Empresas is enrichment; the stub/payload remains usable */
      }
    }
    return parsed.success ? parsed.data : wayDataClientSchema.parse({ codigo: code, nome: `Cliente ${code}`.slice(0, 70), classificacao: "A" });
  }

  private async processDeliveryReturns(): Promise<void> {
    const days = Math.min(4, Math.max(1, this.dependencies.deliveryLookbackDays ?? 4));
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 86_400_000);
    const results = await this.dependencies.wayData!.listDeliveryResults(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10));
    await this.mapLimited(results, (result) => this.processDelivery(result), Math.min(2, this.dependencies.concurrency ?? 4));
  }

  private async processDelivery(result: DeliveryResult): Promise<void> {
    if (!shouldCreateDeliveryFollowUp(result.status, Boolean(result.receiptUrl))) {
      const skipKey = `DELIVERY:${result.invoiceId}:${result.orderCode}:${result.status}`;
      if (!(await this.dependencies.store.hasSuccessfulCorrelation(skipKey))) {
        await this.log({ correlationId: skipKey, status: "SUCCESS", entity: "ORDER", operation: "READ", direction: "WAYDATA_TO_CIGAM", message: "Status não informado sem canhoto; acompanhamento omitido.", reference: { invoice: result.invoiceId, order: result.orderCode, route: String(result.routeCode) } });
      }
      return;
    }
    const trackingKey = `DELIVERY:${result.invoiceId}:${result.orderCode}:${result.status}`;
    const receiptKey = `RECEIPT:${result.invoiceId}:${result.receiptId ?? result.receiptUrl ?? "none"}`;
    const tracked = await this.dependencies.store.hasSuccessfulCorrelation(trackingKey);
    const attached = await this.dependencies.store.hasSuccessfulCorrelation(receiptKey);
    if (tracked && (attached || !result.receiptUrl)) return;

    let receipt: { filename: string; contentType: string; contentBase64: string } | undefined;
    if (result.receiptUrl && !attached) {
      const downloaded = await this.dependencies.wayData!.downloadReceipt(result.receiptUrl);
      const extension = downloaded.contentType === "application/pdf" ? "pdf" : downloaded.contentType === "image/png" ? "png" : "jpg";
      receipt = { filename: `canhoto-${result.invoiceId}.${extension}`, contentType: downloaded.contentType, contentBase64: Buffer.from(downloaded.bytes).toString("base64") };
    }

    try {
      await this.dependencies.cigam!.recordInvoiceFollowUp({ invoiceId: result.invoiceId, result, ...(receipt ? { receipt } : {}), idempotencyKey: receipt ? receiptKey : trackingKey });
    } catch (error) {
      const classified = classifyHttpError(error);
      await this.log({ correlationId: receipt ? receiptKey : trackingKey, status: "ERROR", entity: receipt ? "RECEIPT" : "ORDER", operation: "UPDATE", direction: "WAYDATA_TO_CIGAM", message: classified.message, reference: { invoice: result.invoiceId, order: result.orderCode, route: String(result.routeCode) }, ...(classified.httpStatus != null ? { httpStatus: classified.httpStatus } : {}), errorCode: classified.kind });
      if (classified.kind === "NOT_FOUND") return;
      throw error;
    }
    if (!tracked) {
      await this.log({ correlationId: trackingKey, status: "SUCCESS", entity: "ORDER", operation: "UPDATE", direction: "WAYDATA_TO_CIGAM", message: `Status de entrega atualizado: ${result.status}.`, reference: { invoice: result.invoiceId, order: result.orderCode, route: String(result.routeCode) } });
    }
    if (receipt) {
      await this.log({ correlationId: receiptKey, status: "SUCCESS", entity: "RECEIPT", operation: "CREATE", direction: "WAYDATA_TO_CIGAM", message: "Canhoto anexado ao acompanhamento da NF.", reference: { invoice: result.invoiceId, order: result.orderCode, route: String(result.routeCode) } });
    }
  }

  private async processReprocessQueue(): Promise<void> {
    const pending = (await this.dependencies.store.readReprocessRequests()).filter((item) => item.status === "PENDING");
    for (const item of pending) {
      await this.dependencies.store.updateReprocess({ ...item, status: "PROCESSING" });
      try {
        if (item.entity !== "ROUTE") throw new Error("Reprocessamento automático disponível somente para rotas neste contrato");
        const route = cigamRouteSchema.parse(await this.dependencies.cigam!.getRoute(item.reference));
        await this.processRoute(route);
        await this.dependencies.store.updateReprocess({ ...item, status: "DONE" });
        await this.log({ correlationId: `REPROCESS:${item.id}`, status: "SUCCESS", entity: item.entity, operation: "REPROCESS", message: "Reprocessamento concluído.", reference: { route: item.reference } });
      } catch (error) {
        const classified = classifyHttpError(error);
        await this.dependencies.store.updateReprocess({ ...item, status: "ERROR" });
        await this.log({ correlationId: `REPROCESS:${item.id}`, status: "ERROR", entity: item.entity, operation: "REPROCESS", message: classified.message, reference: { route: item.reference }, ...(classified.httpStatus != null ? { httpStatus: classified.httpStatus } : {}), errorCode: classified.kind });
      }
    }
  }

  private async enqueueRetry(routeId: string, correlationId: string): Promise<void> {
    const pending = await this.dependencies.store.readReprocessRequests();
    if (pending.some((item) => item.reference === routeId && (item.status === "PENDING" || item.status === "PROCESSING"))) return;
    await this.dependencies.store.requestReprocess({
      id: randomUUID(),
      requestedAt: new Date().toISOString(),
      requestedBy: "worker",
      originalCorrelationId: correlationId,
      entity: "ROUTE",
      reference: routeId,
      status: "PENDING",
    });
  }

  private async completeRoute(route: CigamRoute, correlationId: string, message: string, status: "CANCELLED"): Promise<void> {
    await this.dependencies.cigam!.updateIntegrationStatus(route.id, { status, idempotencyKey: correlationId, synchronizedAt: new Date().toISOString() });
    await this.log({ correlationId, status, entity: "ROUTE", operation: "DELETE", message, reference: this.reference(route) });
  }

  private reference(route: CigamRoute): LogEvent["reference"] { return { company: route.company, branch: route.branch, route: route.id, order: route.orderCode }; }
  private isNotFound(error: unknown): boolean {
    return classifyHttpError(error).kind === "NOT_FOUND" || (error instanceof Error && /não encontrad/i.test(error.message));
  }

  private shouldMarkCigamError(error: unknown): boolean {
    const endpoint = error && typeof error === "object" && "endpoint" in error && typeof (error as { endpoint: unknown }).endpoint === "string"
      ? (error as { endpoint: string }).endpoint
      : "";
    return !/wayds\.net|waydatasolution|\/Roteirizacao\/|\/cliente|\/rota\b|\/pedido|\/remessa/i.test(endpoint);
  }

  private async mapLimited<T>(items: T[], action: (item: T) => Promise<void>, limit = this.dependencies.concurrency ?? 4): Promise<void> {
    const queue = [...items];
    const count = Math.min(Math.max(1, limit), queue.length || 1);
    await Promise.all(Array.from({ length: count }, async () => { for (;;) { const item = queue.shift(); if (!item) return; await action(item); } }));
  }

  private async log(input: { correlationId: string; status: LogEvent["status"]; message: string; durationMs?: number; reference?: LogEvent["reference"]; entity?: LogEvent["entity"]; operation?: LogEvent["operation"]; direction?: LogEvent["direction"]; externalCode?: string | number; httpStatus?: number; errorCode?: string }): Promise<void> {
    await this.dependencies.store.writeLog({ id: randomUUID(), timestamp: new Date().toISOString(), direction: input.direction ?? (input.entity && input.entity !== "SYSTEM" ? "CIGAM_TO_WAYDATA" : "INTERNAL"), entity: input.entity ?? "SYSTEM", operation: input.operation ?? "SYNC", attempt: 1, reference: input.reference ?? {}, ...input, message: String(sanitizeValue(input.message)) });
    if (input.status === "ERROR" && this.dependencies.notifier) {
      await this.dependencies.notifier.send({ key: `${input.entity ?? "SYSTEM"}:${input.errorCode ?? input.message}`, subject: `[CIGAM × WayData] Falha em ${input.entity ?? "SYSTEM"}`, text: `Correlação: ${input.correlationId}\nEntidade: ${input.entity ?? "SYSTEM"}\nOperação: ${input.operation ?? "SYNC"}\nHTTP: ${input.httpStatus ?? "-"}\nMensagem: ${input.message}` }).catch(() => undefined);
    }
  }
}
