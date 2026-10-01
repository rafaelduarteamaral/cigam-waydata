import {
  cigamRouteSchema,
  deliveryResultSchema,
  wayDataClientSchema,
  wayDataRoutingSchema,
  type CigamRoute,
  type DeliveryResult,
  type WayDataClient,
  type WayDataRouting,
} from "./schemas";

const ASMX_META = new Set(["__type", "mensagem", "Paginas", "qtdpaginas"]);
const RECEIPT_IMAGE_FORMAT = 3;
const STATUS_BY_CODE: Record<number, string> = {
  0: "NAO_INFORMADO",
  1: "ENTREGUE",
  2: "NAO_ENTREGUE",
  3: "PARCIAL",
  4: "REENTREGA",
};

export type AsmxRecord = Record<string, unknown>;

export function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function formatCnpj(value: unknown): string | undefined {
  const raw = digits(value);
  if (raw.length !== 14) return undefined;
  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
}

export function parseMicrosoftDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value !== "string" || !value.trim()) return undefined;
  const microsoft = value.match(/\/Date\((-?\d+)(?:[+-]\d+)?\)\//);
  if (microsoft?.[1]) return new Date(Number(microsoft[1]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function formatInTimeZone(date: Date, timeZone = process.env.TZ ?? "America/Sao_Paulo"): { date: string; time: string; dateTime: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  const year = read("year");
  const month = read("month");
  const day = read("day");
  const hour = read("hour");
  const minute = read("minute");
  const second = read("second");
  return { date: `${year}-${month}-${day}`, time: `${hour}${minute}${second}`, dateTime: `${year}-${month}-${day}T${hour}:${minute}:${second}` };
}

export function toLocalDateTime(value: unknown): string | undefined {
  const parsed = parseMicrosoftDate(value);
  return parsed ? formatInTimeZone(parsed).dateTime : undefined;
}

export function toAsmxDate(date = new Date()): string {
  return formatInTimeZone(date).date;
}

export function toAsmxTime(date = new Date()): string {
  return formatInTimeZone(date).time;
}

export function unwrapAsmx(raw: unknown): AsmxRecord[] {
  if (Array.isArray(raw)) return raw.filter((item): item is AsmxRecord => Boolean(item) && typeof item === "object");
  if (raw && typeof raw === "object") {
    const nested = (raw as { d?: unknown }).d;
    if (Array.isArray(nested)) return nested.filter((item): item is AsmxRecord => Boolean(item) && typeof item === "object");
    if (nested && typeof nested === "object") return [nested as AsmxRecord];
  }
  return [];
}

export function mapIntegrationStatusToSituacao(status: string): "A" | "F" | "C" {
  const normalized = status.trim().toUpperCase();
  if (normalized === "CANCELLED" || normalized === "C" || normalized === "CANCELADO") return "C";
  if (normalized === "INTEGRATED" || normalized === "SUCCESS" || normalized === "F" || normalized === "FECHADO") return "F";
  return "A";
}

function asRecord(value: unknown): AsmxRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AsmxRecord) : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function clip(value: string, max: number): string {
  return value.slice(0, max);
}

function uniqueClients(codes: string[]): string[] {
  return [...new Set(codes.filter(Boolean))];
}

export function uniqueRouteName(cargaId: string, when?: unknown): string {
  const local = typeof when === "string" ? when.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  const day = local ? `${local[2]}${local[3]}` : formatInTimeZone(parseMicrosoftDate(when) ?? new Date()).date.replace(/-/g, "").slice(4);
  const id = clip((cargaId.replace(/\W/g, "") || "ROTA"), 25);
  return clip(`${id}-${day}`, 30);
}

export function routingClientCodes(routing: WayDataRouting): string[] {
  return uniqueClients([
    routing.codigoClientePartida,
    routing.codigoClienteChegada,
    ...routing.veiculosRoteirizacao.flatMap((vehicle) => vehicle.remessas.map((item) => item.codigoCliente)),
  ]);
}

export function shouldCreateDeliveryFollowUp(status: string, hasReceipt: boolean): boolean {
  return status !== "NAO_INFORMADO" || hasReceipt;
}

function mapItems(raw: unknown): WayDataRouting["veiculosRoteirizacao"][number]["remessas"][number]["itensRemessa"] {
  const items = [];
  for (const item of asArray(raw)) {
    const record = asRecord(item);
    if (!record) continue;
    const codigo = stringValue(record.codigo) ?? "";
    const descricao = clip((stringValue(record.descricao) ?? codigo).padEnd(3, "."), 120);
    const quantidade = Number(record.quantidade);
    if (!codigo || !Number.isInteger(quantidade) || quantidade <= 0) continue;
    items.push({
      codigo,
      descricao,
      volumeUnitario: Math.max(0, Number(record.volumeUnitario) || 0),
      pesoUnitario: Math.max(0, Number(record.pesoUnitario) || 0),
      valorUnitario: Math.max(0, Number(record.valorUnitario) || 0),
      quantidade,
    });
  }
  return items;
}

function mapShipments(raw: unknown): WayDataRouting["veiculosRoteirizacao"][number]["remessas"] {
  const shipments = [];
  const usedNumbers = new Set<string>();
  for (const item of asArray(raw)) {
    const record = asRecord(item);
    if (!record) continue;
    const cnpjEmissor = formatCnpj(record.cnpjEmissor);
    const itensRemessa = mapItems(record.itensRemessa);
    let numeroRemessa = stringValue(record.numeroRemessa);
    const codigoCliente = clip(stringValue(record.codigoCliente) ?? "", 18);
    if (!cnpjEmissor || !numeroRemessa || !codigoCliente || itensRemessa.length === 0) continue;
    const nfe = Number(record.nfe);
    if (usedNumbers.has(numeroRemessa)) {
      const suffix = Number.isInteger(nfe) && nfe > 0 ? String(nfe) : codigoCliente;
      numeroRemessa = clip(`${numeroRemessa}-${suffix}`, 40);
    }
    usedNumbers.add(numeroRemessa);
    const cte = Number(record.cte);
    const observacao = stringValue(record.observacaoPedido);
    shipments.push({
      numeroRemessa,
      codigoCliente,
      ...(Number.isInteger(nfe) && nfe > 0 ? { nfe } : {}),
      ...(Number.isInteger(cte) && cte > 0 ? { cte } : {}),
      ...(stringValue(record.manifesto) ? { manifesto: stringValue(record.manifesto) } : {}),
      ...(toLocalDateTime(record.dataEmissao) ? { dataEmissao: toLocalDateTime(record.dataEmissao) } : {}),
      cnpjEmissor,
      ...(stringValue(record.codigoVendedor) ? { codigoVendedor: stringValue(record.codigoVendedor) } : {}),
      ...(Number.isInteger(Number(record.tipoPagamento)) ? { tipoPagamento: Number(record.tipoPagamento) } : {}),
      itensRemessa,
      ...(Number.isFinite(Number(record.frete)) ? { frete: Math.max(0, Number(record.frete)) } : {}),
      ...(toLocalDateTime(record.dataFaturamento) ? { dataFaturamento: toLocalDateTime(record.dataFaturamento) } : {}),
      ...(Number.isInteger(Number(record.tipo)) ? { tipo: Number(record.tipo) } : {}),
      ...(stringValue(record.nomeEmissor) ? { nomeEmissor: stringValue(record.nomeEmissor) } : {}),
      ...(Number.isInteger(Number(record.roteirizacao)) ? { roteirizacao: Number(record.roteirizacao) } : {}),
      ...(stringValue(record.tipoPedido) ? { tipoPedido: stringValue(record.tipoPedido) } : {}),
      ...(toLocalDateTime(record.dataEntrega) ? { dataEntrega: toLocalDateTime(record.dataEntrega) } : {}),
      ...(toLocalDateTime(record.dataSaida) ? { dataSaida: toLocalDateTime(record.dataSaida) } : {}),
      ...(stringValue(record.tipoCarga) ? { tipoCarga: clip(stringValue(record.tipoCarga) ?? "", 20) } : {}),
      ...(observacao ? { observacaoPedido: clip(observacao, 80) } : {}),
    });
  }
  return shipments;
}

export function mapCargaDetalhesToRouting(row: AsmxRecord, externalCode = 0): WayDataRouting {
  const vehicles = [];
  for (const vehicle of asArray(row.veiculosRoteirizacao ?? row.veiculoRoteirizacao)) {
    const record = asRecord(vehicle);
    if (!record) continue;
    const remessas = mapShipments(record.remessas);
    if (remessas.length === 0) continue;
    const clients = uniqueClients(remessas.map((item) => item.codigoCliente));
    if (clients.length > 199) throw new Error("A roteirização excede 199 clientes únicos por veículo");
    const driver = Number.parseInt(String(record.codigoMotorista ?? ""), 10);
    vehicles.push({
      ...(stringValue(record.placa) ? { placa: stringValue(record.placa) } : {}),
      ...(Number.isInteger(driver) ? { codigoMotorista: driver } : {}),
      remessas,
    });
  }
  if (vehicles.length === 0) throw new Error("Carga sem remessas válidas para a WayData");
  const dataInicial = toLocalDateTime(row.dataInicial);
  let dataFinal = toLocalDateTime(row.dataFinal);
  if (!dataInicial || !dataFinal) throw new Error("Carga sem data inicial/final válida");
  if (dataFinal < dataInicial) throw new Error("dataFinal anterior a dataInicial");
  // WayData exige dataFinal posterior à inicial; CIGAM às vezes manda o mesmo instante (meia-noite).
  if (dataFinal === dataInicial) dataFinal = `${dataInicial.slice(0, 10)}T23:59:00`;
  const cargaId = stringValue(row.codigoRoteirizacao) ?? stringValue(row.carga) ?? stringValue(row.nome) ?? "ROTA";
  const nome = uniqueRouteName(cargaId, dataInicial);
  // Algumas cargas do ASMX chegam sem os códigos de origem/destino. A remessa
  // contém o cliente efetivamente atendido e é a melhor referência disponível
  // para manter a roteirização válida na WayData nesses casos.
  const shipmentClient = vehicles.flatMap((vehicle) => vehicle.remessas.map((shipment) => shipment.codigoCliente))[0] ?? "";
  const codigoClientePartida = clip(
    stringValue(row.codigoClientePartida)
      ?? stringValue(row.codigoClienteOrigem)
      ?? stringValue(row.codigoCliente)
      ?? shipmentClient,
    18,
  );
  const codigoClienteChegada = clip(
    stringValue(row.codigoClienteChegada)
      ?? stringValue(row.codigoClienteDestino)
      ?? stringValue(row.codigoCliente)
      ?? shipmentClient,
    18,
  );
  return wayDataRoutingSchema.parse({
    nome,
    codigoClientePartida,
    codigoClienteChegada,
    dataInicial,
    dataFinal,
    veiculosRoteirizacao: vehicles,
    codigoRoteirizacao: externalCode,
    flagTracking: row.flagTracking !== false,
  });
}

function invoicesFromRouting(routing: WayDataRouting): CigamRoute["invoices"] {
  const invoices = [];
  const seen = new Set<string>();
  for (const vehicle of routing.veiculosRoteirizacao) {
    for (const shipment of vehicle.remessas) {
      if (shipment.nfe == null || shipment.nfe <= 0) continue;
      const id = String(shipment.nfe);
      if (seen.has(id)) continue;
      seen.add(id);
      invoices.push({ id, number: id, companyCode: shipment.codigoCliente });
    }
  }
  return invoices;
}

function clientsFromRouting(routing: WayDataRouting): CigamRoute["clients"] {
  const codes = routingClientCodes(routing);
  return codes.map((code) => ({
    code,
    changed: false,
    addressChanged: false,
    payload: { codigo: code, nome: clip(`Cliente ${code}`, 70), classificacao: "A" },
  }));
}

function operationFromRow(row: AsmxRecord): CigamRoute["operation"] {
  const situacao = String(row.situacao ?? row.Situacao ?? "").trim().toUpperCase();
  if (situacao === "C" || situacao === "CANCELADO") return "CANCEL_ROUTE";
  return "UPSERT";
}

export function mapCargaRowToRoute(row: AsmxRecord, options: { company: string; branch: string; index?: number; includeRouting?: boolean }): CigamRoute {
  const cargaId = stringValue(row.codigoRoteirizacao) ?? stringValue(row.carga) ?? `${stringValue(row.nome) ?? "route"}:${(options.index ?? 0) + 1}`;
  const now = new Date().toISOString();
  const base = {
    id: cargaId,
    company: options.company,
    branch: options.branch,
    updatedAt: now,
    operation: operationFromRow(row),
    clients: [] as CigamRoute["clients"],
    invoices: [] as CigamRoute["invoices"],
  };
  if (!options.includeRouting) {
    const clean = Object.fromEntries(Object.entries(row).filter(([key]) => !ASMX_META.has(key)));
    return cigamRouteSchema.parse({ ...base, routing: clean });
  }
  const routing = mapCargaDetalhesToRouting(row, 0);
  return cigamRouteSchema.parse({ ...base, clients: clientsFromRouting(routing), invoices: invoicesFromRouting(routing), routing });
}

export function mapEmpresaToWayDataClient(row: AsmxRecord, fallbackCode: string): WayDataClient | null {
  if (String(row.mensagem ?? "").toLowerCase().includes("nenhum registro")) return null;
  const codigo = clip(stringValue(row.cd_empresa) ?? stringValue(row.Cd_empresa) ?? fallbackCode, 18);
  const nome = clip(stringValue(row.razao_social) ?? stringValue(row.nome) ?? stringValue(row.nome_fantasia) ?? stringValue(row.fantasia) ?? "", 70);
  if (!codigo || nome.length < 3) return null;
  const cep = digits(row.cep);
  const numero = Number.parseInt(digits(row.numero) || "0", 10);
  const uf = stringValue(row.uf)?.slice(0, 2).toUpperCase();
  const logradouro = stringValue(row.endereco);
  const bairro = stringValue(row.bairro);
  const municipio = stringValue(row.municipio);
  const classificacaoRaw = stringValue(row.classificacaoParceiro) ?? "A";
  const classificacao = /^(\d{2}|[A-Z])$/.test(classificacaoRaw) ? classificacaoRaw : "A";
  const endereco = logradouro && bairro && municipio && uf && cep.length === 8
    ? {
        logradouro,
        bairro,
        numero: Number.isInteger(numero) && numero >= 0 ? numero : 0,
        cep,
        municipio,
        uf,
        ...(stringValue(row.complemento) ? { complemento: stringValue(row.complemento) } : {}),
      }
    : undefined;
  return wayDataClientSchema.parse({
    codigo,
    nome,
    classificacao,
    ...(endereco ? { endereco } : {}),
  });
}

export function dataUriForReceipt(contentType: string, contentBase64: string): string {
  return `data:${contentType};base64,${contentBase64}`;
}

export function buildAcompanhamento(input: {
  invoiceNumber: string;
  companyCode: string;
  occurredAt?: string;
  history: string;
  titleCode?: string;
}): AsmxRecord {
  const when = parseMicrosoftDate(input.occurredAt) ?? new Date();
  const stamp = formatInTimeZone(when);
  return {
    Data: stamp.date,
    Hora: stamp.time.replace(/:/g, ""),
    Cd_empresa: input.companyCode,
    Embarque_pedido: "",
    Contato_os_lanc: input.invoiceNumber,
    Sequencia_item: "0",
    Tipo_acompanham: "N",
    Codigo_titulo: input.titleCode ?? "CAN",
    Historico: input.history,
    Anexos: "",
  };
}

function normalizeStatus(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value)) return STATUS_BY_CODE[value] ?? String(value);
  const raw = stringValue(value);
  if (!raw) return "NAO_INFORMADO";
  const key = raw.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (/nao[ _]*informado/.test(key)) return "NAO_INFORMADO";
  if (/nao[ _]*entregue/.test(key) || key.includes("recusa") || key.includes("devol")) return "NAO_ENTREGUE";
  if (key.includes("parcial")) return "PARCIAL";
  if (key.includes("reentrega")) return "REENTREGA";
  if (key.includes("entreg")) return "ENTREGUE";
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && STATUS_BY_CODE[numeric]) return STATUS_BY_CODE[numeric];
  return raw.toUpperCase();
}

function photoFormat(photo: AsmxRecord): number | undefined {
  const tipo = asRecord(photo.Tipo) ?? asRecord(photo.tipo);
  const value = tipo?.FormatoImagem ?? tipo?.formatoImagem ?? photo.FormatoImagem ?? photo.formatoImagem ?? photo.tipo;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function photoUrl(photo: AsmxRecord): string | undefined {
  return stringValue(photo.Url) ?? stringValue(photo.URL) ?? stringValue(photo.url) ?? stringValue(photo.Link) ?? stringValue(photo.link) ?? stringValue(photo.caminho);
}

function photosOf(node: AsmxRecord): AsmxRecord[] {
  const nested = asRecord(node.Marcacao) ?? asRecord(node.marcacao);
  return [...asArray(nested?.Fotos), ...asArray(nested?.fotos), ...asArray(node.Fotos), ...asArray(node.fotos), ...asArray(node.Marcacoes), ...asArray(node.marcacoes)]
    .map(asRecord)
    .filter((item): item is AsmxRecord => Boolean(item));
}

function invoiceIdsFrom(order: AsmxRecord): string[] {
  const raw = order.nfe ?? order.NFe ?? order.NotaFiscal ?? order.notaFiscal ?? order.invoiceId;
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[;,]/) : raw == null ? [] : [raw];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = typeof value === "number" && Number.isInteger(value) && value > 0
      ? String(value)
      : stringValue(value)?.replace(/^0+(?=\d)/, "");
    if (!id || id === "0" || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function isReceiptReady(photo: AsmxRecord, order: AsmxRecord, productionDetail = false): boolean {
  const marking = asRecord(order.Marcacao) ?? asRecord(order.marcacao);
  const status = stringValue(photo.statusMarcacao ?? photo.StatusMarcacao
    ?? marking?.statusMarcacao ?? marking?.StatusMarcacao ?? order.statusMarcacao ?? order.StatusMarcacao);
  const url = photoUrl(photo);
  // Production entregas[].pedidos[].fotos publishes the URL without statusMarcacao.
  // An explicit marking status still takes precedence, including pending photos.
  const ready = status != null ? status.trim().toLowerCase() === "realizado" : productionDetail && photoFormat(photo) == null;
  return ready && Boolean(url && /^https?:\/\//i.test(url));
}

function receiptsFrom(node: AsmxRecord, allowUntypedPhotos = false): Array<{ receiptUrl: string; receiptId: string }> {
  const receipts: Array<{ receiptUrl: string; receiptId: string }> = [];
  const seen = new Set<string>();
  for (const photo of photosOf(node).filter((item) => photoFormat(item) === RECEIPT_IMAGE_FORMAT || (allowUntypedPhotos && photoFormat(item) == null))) {
    const url = photoUrl(photo);
    if (!isReceiptReady(photo, node, allowUntypedPhotos) || !url || seen.has(url)) continue;
    seen.add(url);
    const id = stringValue(photo.Id) ?? stringValue(photo.id) ?? stringValue(photo.codigo);
    receipts.push({ receiptUrl: url, receiptId: id && id !== "0" ? id : url });
  }
  return receipts;
}

function ordersOf(route: AsmxRecord): AsmxRecord[] {
  return [...asArray(route.Pedidos), ...asArray(route.pedidos), ...asArray(route.Marcacoes), ...asArray(route.pedidosRota)]
    .map(asRecord)
    .filter((item): item is AsmxRecord => Boolean(item));
}

function deliveriesFromOrder(route: AsmxRecord, order: AsmxRecord, productionDetail = false): DeliveryResult[] {
  const invoiceIds = invoiceIdsFrom(order);
  const orderCode = stringValue(order.codigoPedido) ?? stringValue(order.CodigoPedido) ?? stringValue(order.numeroPedido) ?? stringValue(order.NumeroPedido) ?? stringValue(order.orderCode) ?? stringValue(order.codigo) ?? invoiceIds[0];
  const routeCode = stringValue(route.codigorota) ?? stringValue(route.CodigoRota) ?? stringValue(route.codigoRota) ?? stringValue(route.codigo) ?? stringValue(route.codigoRoteirizacao) ?? stringValue(order.routeCode);
  if (!invoiceIds.length || !orderCode || routeCode == null) return [];
  const statusDetail = asRecord(order.status);
  const occurred = toLocalDateTime(order.DataEntrega ?? order.dataEntrega ?? order.occurredAt ?? statusDetail?.data);
  const companyCode = stringValue(order.codigoCliente) ?? stringValue(order.CodigoCliente) ?? stringValue(order.Cd_empresa);
  const status = normalizeStatus(statusDetail?.descricao ?? order.TipoStatus ?? order.tipoStatus ?? order.status ?? order.situacao);
  const receipts = receiptsFrom(order, productionDetail);
  const candidates = photosOf(order).filter((photo) => photoFormat(photo) === RECEIPT_IMAGE_FORMAT || (productionDetail && photoFormat(photo) == null));
  const receiptPending = receipts.length === 0 || candidates.some((photo) => !isReceiptReady(photo, order, productionDetail));
  const bases = invoiceIds.map((invoiceId) => ({
    routeCode,
    orderCode,
    invoiceId,
    status,
    receiptPending,
    ...(occurred ? { occurredAt: occurred } : {}),
    ...(companyCode ? { companyCode } : {}),
  }));
  if (receipts.length === 0) return bases.map((item) => deliveryResultSchema.parse(item));
  return bases.flatMap((item) => receipts.map((receipt) => deliveryResultSchema.parse({ ...item, ...receipt })));
}

export function mapIntegraWayDeliveries(raw: unknown): DeliveryResult[] {
  if (raw == null) return [];
  const candidates = Array.isArray(raw) ? raw : asArray(asRecord(raw)?.items) ;
  const routes = (candidates.length ? candidates : [raw]).map(asRecord).filter((item): item is AsmxRecord => Boolean(item));
  const results: DeliveryResult[] = [];
  for (const route of routes) {
    const flat = deliveryResultSchema.safeParse(route);
    if (flat.success) {
      results.push(flat.data);
      continue;
    }
    for (const rawDelivery of asArray(route.entregas)) {
      const delivery = asRecord(rawDelivery);
      if (!delivery) continue;
      for (const order of ordersOf(delivery)) {
        results.push(...deliveriesFromOrder(route, {
          ...order,
          codigoCliente: order.codigoCliente ?? delivery.codigoCliente,
          statusMarcacao: order.statusMarcacao ?? order.StatusMarcacao ?? delivery.statusMarcacao ?? delivery.StatusMarcacao,
        }, true));
      }
    }
    const orders = ordersOf(route);
    if (orders.length === 0) {
      results.push(...deliveriesFromOrder(route, route));
      continue;
    }
    for (const order of orders) {
      results.push(...deliveriesFromOrder(route, order));
    }
  }
  return results;
}
