import { HttpClient, HttpError } from "@cigam-waydata/http-client";
import { mapIntegraWayDeliveries, wayDataClientSchema, wayDataRoutingSchema, type DeliveryResult, type WayDataClient as WayDataClientPayload, type WayDataRoutingInput } from "@cigam-waydata/shared";

export interface RoutingResponse {
  nome: string;
  CodigoRoteirizacao: number;
  veiculoRoteirizacao: Array<{
    placa: string;
    remessas: Array<{ numeroRemessa: string; situacao: string }>;
  }>;
  status: number;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function routingCodeOf(raw: unknown): number | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;
  const code = Number(record.CodigoRoteirizacao ?? record.codigoRoteirizacao);
  return Number.isInteger(code) && code > 0 ? code : undefined;
}

function parseRoutingResponse(raw: unknown, fallbackNome: string, status = 200): RoutingResponse {
  const record = asRecord(raw) ?? {};
  const code = routingCodeOf(raw);
  const vehicles = Array.isArray(record.veiculoRoteirizacao)
    ? record.veiculoRoteirizacao as RoutingResponse["veiculoRoteirizacao"]
    : Array.isArray(record.veiculosRoteirizacao)
      ? record.veiculosRoteirizacao as RoutingResponse["veiculoRoteirizacao"]
      : [];
  if (!code) {
    const accepted = vehicles.some((vehicle) => (vehicle.remessas ?? []).some((item) => String(item.situacao ?? "").toLowerCase().includes("sucesso")));
    throw new Error(accepted
      ? "WayData aceitou remessas, mas não retornou CodigoRoteirizacao (>0)"
      : "WayData não retornou CodigoRoteirizacao");
  }
  return {
    nome: String(record.nome ?? record.Nome ?? fallbackNome),
    CodigoRoteirizacao: code,
    veiculoRoteirizacao: vehicles,
    status: Number(record.status) || status,
  };
}

export class WayDataClient {
  readonly baseUrl: string;
  lastDeliveryScan: { covers: number; routeCodes: string[]; results: number } | undefined;
  private readonly http: HttpClient;
  private readonly token: string;
  private readonly allowedReceiptHosts: Set<string>;
  private readonly maxConcurrentDownloads: number;
  private activeDownloads = 0;
  private readonly downloadWaiters: Array<() => void> = [];

  constructor(options: { baseUrl: string; token: string; timeoutMs?: number; maxRetries?: number; allowedReceiptHosts?: string[]; maxConcurrentDownloads?: number }) {
    this.baseUrl = options.baseUrl;
    this.http = new HttpClient(options);
    this.token = options.token;
    this.maxConcurrentDownloads = Math.max(1, options.maxConcurrentDownloads ?? 2);
    this.allowedReceiptHosts = new Set([
      hostOf(options.baseUrl) ?? "",
      "wayds.net",
      "restrito.waydatasolution.com.br",
      ...(options.allowedReceiptHosts ?? []),
    ].filter(Boolean));
  }

  async getClient(code: string): Promise<WayDataClientPayload | null> {
    try {
      const raw = await this.http.request(`/cliente/id?codigo=${encodeURIComponent(code)}`);
      const parsed = wayDataClientSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      const record = asRecord(raw);
      const codigo = String(record?.codigo ?? code);
      if (!codigo) return null;
      const nome = String(record?.nome ?? `Cliente ${codigo}`).slice(0, 70);
      const classificacao = /^(\d{2}|[A-Z])$/.test(String(record?.classificacao ?? "")) ? String(record?.classificacao) : "A";
      return { codigo, nome: nome.length >= 3 ? nome : `Cliente ${codigo}`.slice(0, 70), classificacao };
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  }

  createClient(client: WayDataClientPayload): Promise<unknown> {
    return this.http.request("/cliente", { method: "PUT", body: JSON.stringify(wayDataClientSchema.parse(client)) });
  }

  updateClient(client: WayDataClientPayload, withoutAddress = false): Promise<unknown> {
    return this.http.request(withoutAddress ? "/cliente/dados" : "/cliente", {
      method: "PATCH",
      body: JSON.stringify(wayDataClientSchema.parse(client)),
    });
  }

  async createRouting(routing: WayDataRoutingInput): Promise<RoutingResponse> {
    const payload = wayDataRoutingSchema.parse({ ...routing, codigoRoteirizacao: 0 });
    try {
      return parseRoutingResponse(await this.http.request("/Roteirizacao/integracao", {
        method: "PUT",
        body: JSON.stringify(payload),
      }), payload.nome);
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        const recovered = routingCodeOf(error.body) ?? await this.findRoutingCode(payload.nome, payload.dataInicial);
        if (!recovered) throw error;
        return { nome: payload.nome, CodigoRoteirizacao: recovered, veiculoRoteirizacao: [], status: 409 };
      }
      // Homologação às vezes responde 200 com codigoRoteirizacao=0; tenta reconciliar pela capa/rota do dia.
      if (error instanceof Error && /CodigoRoteirizacao/i.test(error.message)) {
        const recovered = await this.findRoutingCode(payload.nome, payload.dataInicial);
        if (recovered) return { nome: payload.nome, CodigoRoteirizacao: recovered, veiculoRoteirizacao: [], status: 200 };
      }
      throw error;
    }
  }

  async updateRouting(routing: WayDataRoutingInput): Promise<RoutingResponse> {
    const payload = wayDataRoutingSchema.parse(routing);
    const body = JSON.stringify(payload);
    try {
      return parseRoutingResponse(await this.http.request("/Roteirizacao/integracao", {
        method: "PATCH",
        body,
      }), payload.nome);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 405) throw error;
      // Homologação recusa PATCH e o PUT com código existente responde 500. A rota já criada permanece válida.
      if (payload.codigoRoteirizacao > 0) {
        return { nome: payload.nome, CodigoRoteirizacao: payload.codigoRoteirizacao, veiculoRoteirizacao: [], status: 405 };
      }
      return parseRoutingResponse(await this.http.request("/Roteirizacao/integracao", {
        method: "PUT",
        body,
      }), payload.nome);
    }
  }

  getRoute(code: string): Promise<unknown> {
    return this.http.request(`/rota?codigorota=${encodeURIComponent(code)}`);
  }

  async deleteRoute(code: string): Promise<unknown> {
    try {
      return await this.http.request(`/rota?codigoRota=${encodeURIComponent(code)}`, { method: "DELETE" });
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return { deleted: false, alreadyAbsent: true };
      throw error;
    }
  }

  async deleteOrder(code: string): Promise<unknown> {
    try {
      return await this.http.request(`/pedido?codigoPedido=${encodeURIComponent(code)}`, { method: "DELETE" });
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return { deleted: false, alreadyAbsent: true };
      throw error;
    }
  }

  async listRouteCovers(dateFrom: string, dateTo: string, nome?: string): Promise<Record<string, unknown>[]> {
    const raw = await this.http.request<unknown>(`/rota/capa?dataInicial=${encodeURIComponent(dateFrom)}&dataFinal=${encodeURIComponent(dateTo)}`);
    const record = asRecord(raw);
    const items = Array.isArray(raw) ? raw : Array.isArray(record?.items) ? record.items : raw == null ? [] : [raw];
    return items.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
      .filter((item) => nome == null || String(item.nome ?? item.Nome ?? "") === nome);
  }

  async listDeliveryResults(dateFrom: string, dateTo: string, pendingRouteCodes: string[] = [], onRouteError?: (code: string, error: unknown) => Promise<void>): Promise<DeliveryResult[]> {
    this.lastDeliveryScan = undefined;
    const covers = await this.listRouteCovers(dateFrom, dateTo);
    const codes = new Set<string>(pendingRouteCodes);
    for (const cover of covers) {
      const code = Number(cover.codigorota ?? cover.codigoRota ?? cover.CodigoRota ?? cover.codigo);
      if (!Number.isSafeInteger(code) || code <= 0) throw new Error("Capa WayData sem CodigoRota válido");
      codes.add(String(code));
    }
    const results: DeliveryResult[] = [];
    for (const code of codes) {
      try {
        results.push(...mapIntegraWayDeliveries(await this.getRoute(code)));
      } catch (error) {
        if (!onRouteError) throw error;
        await onRouteError(code, error);
      }
    }
    this.lastDeliveryScan = { covers: covers.length, routeCodes: [...codes], results: results.length };
    return results;
  }

  async downloadReceipt(url: string, maxBytes = 10 * 1024 * 1024): Promise<{ bytes: Uint8Array; contentType: string }> {
    await this.acquireDownload();
    try {
      const parsed = new URL(url);
      if (!this.allowedReceiptHosts.has(parsed.hostname)) throw new Error("Origem do canhoto não autorizada");
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Protocolo de canhoto não autorizado");
      const response = await fetch(url, { headers: { Accept: "application/pdf,image/png,image/jpeg", Authorization: `Bearer ${this.token}` }, redirect: "follow" });
      const finalHost = hostOf(response.url);
      if (!finalHost || !this.allowedReceiptHosts.has(finalHost)) throw new Error("Redirecionamento de canhoto não autorizado");
      if (!response.ok) throw new Error(`Receipt download failed with HTTP ${response.status}`);
      const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
      if (!["application/pdf", "image/png", "image/jpeg"].includes(contentType)) throw new Error("Unsupported receipt content type");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) throw new Error("Receipt size is invalid");
      return { bytes, contentType };
    } finally {
      this.releaseDownload();
    }
  }

  private async findRoutingCode(nome: string, dataInicial: string): Promise<number | undefined> {
    const day = dataInicial.slice(0, 10);
    const covers = await this.listRouteCovers(day, day, nome);
    // CodigoRota identifica a execução; nunca substitui CodigoRoteirizacao.
    const codes = [...new Set(covers.map(routingCodeOf).filter((code): code is number => code != null))];
    if (codes.length === 1) return codes[0];
    return undefined;
  }

  private async acquireDownload(): Promise<void> {
    while (this.activeDownloads >= this.maxConcurrentDownloads) {
      await new Promise<void>((resolve) => this.downloadWaiters.push(resolve));
    }
    this.activeDownloads += 1;
  }

  private releaseDownload(): void {
    this.activeDownloads = Math.max(0, this.activeDownloads - 1);
    this.downloadWaiters.shift()?.();
  }
}
