import { HttpClient } from "@cigam-waydata/http-client";
import {
  buildAcompanhamento,
  cigamRouteSchema,
  dataUriForReceipt,
  deliveryResultSchema,
  digits,
  mapCargaRowToRoute,
  mapEmpresaToWayDataClient,
  mapIntegrationStatusToSituacao,
  toAsmxDate,
  toAsmxTime,
  unwrapAsmx,
  type AsmxRecord,
  type CigamRoute,
  type DeliveryResult,
  type WayDataClient,
} from "@cigam-waydata/shared";
import { z } from "zod";

export interface CigamPaths {
  pendingRoutes: string;
  route: string;
  status: string;
  tracking: string;
  attachment: string;
  companies: string;
}

export interface CigamAsmxOptions {
  unit: string;
  company?: string;
  lookbackDays?: number;
  page?: number;
}

const restPaths: CigamPaths = {
  pendingRoutes: "/integracoes/waydata/rotas",
  route: "/integracoes/waydata/rotas/{id}",
  status: "/integracoes/waydata/rotas/{id}/status",
  tracking: "/notas-fiscais/{id}/acompanhamentos",
  attachment: "/notas-fiscais/{id}/anexos",
  companies: "/clientes/{id}",
};

const asmxPaths: CigamPaths = {
  pendingRoutes: "/Cargas_Buscar",
  route: "/Cargas_BuscarDetalhes",
  status: "/Cargas_MudaSituacao",
  tracking: "/Acompanhamento_Criar",
  attachment: "/Acompanhamento_Criar",
  companies: "/Empresas",
};

function at(path: string, id: string): string {
  return path.replace("{id}", encodeURIComponent(id));
}

function companyCodesEqual(left: string, right: string): boolean {
  if (left === right) return true;
  const a = left.replace(/^0+/, "") || "0";
  const b = right.replace(/^0+/, "") || "0";
  return a === b;
}

export class CigamClient {
  private readonly http: HttpClient;
  private readonly paths: CigamPaths;
  private readonly asmx: CigamAsmxOptions | undefined;
  private readonly companyByCode = new Map<string, WayDataClient>();
  private companiesIndexed = false;

  constructor(options: { baseUrl: string; token: string; authorizationScheme?: "bearer" | "raw"; timeoutMs?: number; maxRetries?: number; paths?: Partial<CigamPaths>; asmx?: CigamAsmxOptions }) {
    this.http = new HttpClient({ baseUrl: options.baseUrl, ...(options.authorizationScheme === "raw" ? { authorizationHeader: options.token } : { token: options.token }), ...(options.timeoutMs != null ? { timeoutMs: options.timeoutMs } : {}), ...(options.maxRetries != null ? { maxRetries: options.maxRetries } : {}) });
    this.asmx = options.asmx;
    this.paths = { ...(options.asmx ? asmxPaths : restPaths), ...Object.fromEntries(Object.entries(options.paths ?? {}).filter(([, value]) => value)) };
  }

  private rememberCompany(client: WayDataClient): void {
    this.companyByCode.set(client.codigo, client);
    const stripped = client.codigo.replace(/^0+/, "") || "0";
    if (stripped !== client.codigo) this.companyByCode.set(stripped, client);
  }

  private cachedCompany(code: string): WayDataClient | undefined {
    return this.companyByCode.get(code) ?? this.companyByCode.get(code.replace(/^0+/, "") || "0");
  }

  private async fetchEmpresaRows(extra: Record<string, string>): Promise<AsmxRecord[]> {
    const raw = await this.http.request<unknown>(this.paths.companies, {
      method: "POST",
      retry: true,
      body: JSON.stringify({ filtros: { pagina: "1", ...extra } }),
    });
    return unwrapAsmx(raw);
  }

  private findCompanyInRows(rows: AsmxRecord[], code: string): WayDataClient | null {
    for (const row of rows) {
      const rowCode = String(row.cd_empresa ?? row.Cd_empresa ?? "").trim();
      if (!rowCode || !companyCodesEqual(rowCode, code)) continue;
      const mapped = mapEmpresaToWayDataClient(row, code);
      if (mapped) {
        this.rememberCompany(mapped);
        return mapped;
      }
    }
    return null;
  }

  private async indexCompaniesByCode(wanted: string): Promise<WayDataClient | null> {
    if (this.companiesIndexed) return this.cachedCompany(wanted) ?? null;
    let pages = 1;
    let found: WayDataClient | null = null;
    for (let page = 1; page <= pages; page += 1) {
      const rows = await this.fetchEmpresaRows({ pagina: String(page) });
      if (page === 1) {
        const declared = Number(rows[0]?.qtdpaginas ?? rows[0]?.Paginas ?? 1);
        pages = Number.isFinite(declared) && declared > 0 ? Math.min(declared, 500) : 1;
      }
      for (const row of rows) {
        const mapped = mapEmpresaToWayDataClient(row, String(row.cd_empresa ?? row.Cd_empresa ?? ""));
        if (mapped) this.rememberCompany(mapped);
      }
      if (!found) found = this.findCompanyInRows(rows, wanted);
    }
    this.companiesIndexed = true;
    return found ?? this.cachedCompany(wanted) ?? null;
  }

  async listPendingRoutes(since?: string): Promise<CigamRoute[]> {
    if (this.asmx) {
      const to = new Date();
      const from = since ? new Date(since) : new Date(to.getTime() - Math.max(0, (this.asmx.lookbackDays ?? 4) - 1) * 86_400_000);
      const raw = await this.http.request<unknown>(this.paths.pendingRoutes, {
        method: "POST",
        retry: true,
        body: JSON.stringify({ filtros: { dt_inicial: toAsmxDate(from), dt_final: toAsmxDate(to), Pagina: String(this.asmx.page ?? 1) } }),
      });
      return unwrapAsmx(raw)
        .filter((row) => row.codigoRoteirizacao != null || row.nome != null)
        .map((row, index) => mapCargaRowToRoute(row, { company: this.asmx!.company ?? "PANEBRAS", branch: this.asmx!.unit, index }));
    }
    const separator = this.paths.pendingRoutes.includes("?") ? "&" : "?";
    const query = since ? `${separator}updatedSince=${encodeURIComponent(since)}` : "";
    const raw = await this.http.request<unknown>(`${this.paths.pendingRoutes}${query}`);
    const list = Array.isArray(raw) ? raw : z.object({ items: z.array(z.unknown()) }).parse(raw).items;
    return z.array(cigamRouteSchema).parse(list);
  }

  async getRoute(id: string): Promise<CigamRoute> {
    if (this.asmx) {
      const raw = await this.http.request<unknown>(this.paths.route, {
        method: "POST",
        retry: true,
        body: JSON.stringify({ filtros: { codigoRoteirizacao: Number(id) || id } }),
      });
      const row = unwrapAsmx(raw)[0];
      if (!row) throw new Error(`Carga ${id} não encontrada no CIGAM`);
      return mapCargaRowToRoute(row, { company: this.asmx.company ?? "PANEBRAS", branch: this.asmx.unit, includeRouting: true });
    }
    return cigamRouteSchema.parse(await this.http.request(at(this.paths.route, id)));
  }

  async getCompany(input: { code?: string; cnpj?: string }): Promise<WayDataClient | null> {
    if (this.asmx) {
      if (input.cnpj) {
        const cnpj = digits(input.cnpj);
        if (cnpj) {
          const rows = await this.fetchEmpresaRows({ cnpjcpf: cnpj });
          const mapped = rows.map((row) => mapEmpresaToWayDataClient(row, input.code ?? cnpj)).find(Boolean) ?? null;
          if (mapped) {
            this.rememberCompany(mapped);
            return mapped;
          }
        }
      }
      if (!input.code) return null;
      const cached = this.cachedCompany(input.code);
      if (cached) return cached;

      // Collection documents cnpjcpf; cd_empresa is often ignored on PANEBRAS and returns page 1.
      const variants = [...new Set([input.code, input.code.replace(/^0+/, "") || ""].filter(Boolean))];
      for (const variant of variants) {
        const rows = await this.fetchEmpresaRows({ cd_empresa: variant });
        const hit = this.findCompanyInRows(rows, input.code);
        if (hit) return hit;
      }

      return this.indexCompaniesByCode(input.code);
    }
    if (!input.code) return null;
    try {
      const raw = await this.http.request<unknown>(at(this.paths.companies, input.code));
      return mapEmpresaToWayDataClient(raw && typeof raw === "object" ? raw as Record<string, unknown> : {}, input.code);
    } catch {
      return null;
    }
  }

  updateIntegrationStatus(id: string, payload: Record<string, unknown>): Promise<unknown> {
    if (this.asmx) {
      const now = new Date();
      return this.http.request(this.paths.status, {
        method: "POST",
        body: JSON.stringify({
          Situacao: {
            carga: String(id),
            situacao: mapIntegrationStatusToSituacao(String(payload.status ?? "A")),
            data: toAsmxDate(now),
            hora: toAsmxTime(now),
          },
        }),
      });
    }
    return this.http.request(at(this.paths.status, id), { method: "PATCH", body: JSON.stringify(payload) });
  }

  addInvoiceTracking(invoiceId: string, result: DeliveryResult, idempotencyKey: string): Promise<unknown> {
    return this.recordInvoiceFollowUp({ invoiceId, result, idempotencyKey });
  }

  attachInvoiceReceipt(invoiceId: string, payload: { filename: string; contentType: string; contentBase64: string }, idempotencyKey: string): Promise<unknown> {
    return this.recordInvoiceFollowUp({ invoiceId, result: { routeCode: 0, orderCode: invoiceId, invoiceId, status: "ENTREGUE" }, receipt: payload, idempotencyKey });
  }

  recordInvoiceFollowUp(input: {
    invoiceId: string;
    result: DeliveryResult;
    receipt?: { filename: string; contentType: string; contentBase64: string };
    idempotencyKey: string;
    titleCode?: string;
    history?: string;
  }): Promise<unknown> {
    if (this.asmx) {
      const acompanhamento = buildAcompanhamento({
        invoiceNumber: input.result.invoiceId || input.invoiceId,
        companyCode: input.result.companyCode ?? input.invoiceId,
        ...(input.result.occurredAt ? { occurredAt: input.result.occurredAt } : {}),
        history: input.history ?? `Status WayData: ${input.result.status}`,
        ...(input.titleCode ? { titleCode: input.titleCode } : {}),
        ...(input.receipt ? { receiptDataUri: dataUriForReceipt(input.receipt.contentType, input.receipt.contentBase64) } : {}),
      });
      return this.http.request(this.paths.tracking, {
        method: "POST",
        headers: { "Idempotency-Key": input.idempotencyKey },
        body: JSON.stringify({ acompanhamento }),
      });
    }
    const tracking = this.http.request(at(this.paths.tracking, input.invoiceId), {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify(deliveryResultSchema.parse(input.result)),
    });
    if (!input.receipt) return tracking;
    return tracking.then(() => this.http.request(at(this.paths.attachment, input.invoiceId), {
      method: "POST",
      headers: { "Idempotency-Key": `${input.idempotencyKey}:receipt` },
      body: JSON.stringify(input.receipt),
    }));
  }
}
