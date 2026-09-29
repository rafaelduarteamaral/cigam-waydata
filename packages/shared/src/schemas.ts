import { z } from "zod";

export const integrationStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "SUCCESS",
  "ERROR",
  "CANCELLED",
]);

export const integrationEntitySchema = z.enum([
  "CLIENT",
  "SHIPMENT",
  "ROUTE",
  "ORDER",
  "RECEIPT",
  "SYSTEM",
]);

export const integrationOperationSchema = z.enum([
  "CREATE",
  "READ",
  "UPDATE",
  "DELETE",
  "REPROCESS",
  "SYNC",
]);

export const integrationDirectionSchema = z.enum([
  "CIGAM_TO_WAYDATA",
  "WAYDATA_TO_CIGAM",
  "INTERNAL",
]);

export const integrationReferenceSchema = z.object({
  company: z.string().optional(),
  branch: z.string().optional(),
  client: z.string().optional(),
  route: z.string().optional(),
  order: z.string().optional(),
  invoice: z.string().optional(),
  shipment: z.string().optional(),
});

export const logEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
  correlationId: z.string().min(1),
  direction: integrationDirectionSchema,
  entity: integrationEntitySchema,
  operation: integrationOperationSchema,
  reference: integrationReferenceSchema.default({}),
  request: z
    .object({
      method: z.string(),
      endpoint: z.string(),
    })
    .optional(),
  attempt: z.number().int().positive().default(1),
  status: integrationStatusSchema,
  httpStatus: z.number().int().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  message: z.string().max(2_000),
  externalCode: z.union([z.string(), z.number()]).optional(),
  errorCode: z.string().optional(),
  // Corpo sanitizado da tentativa que falhou. Nunca contém cabeçalhos ou tokens.
  requestPayload: z.unknown().optional(),
});

export type LogEvent = z.infer<typeof logEventSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
export type IntegrationEntity = z.infer<typeof integrationEntitySchema>;

export const reprocessRequestSchema = z.object({
  id: z.string().uuid(),
  requestedAt: z.string().datetime({ offset: true }),
  requestedBy: z.string().min(1),
  originalCorrelationId: z.string().min(1),
  entity: integrationEntitySchema,
  reference: z.string().min(1),
  status: z.enum(["PENDING", "PROCESSING", "DONE", "ERROR"]),
});

export type ReprocessRequest = z.infer<typeof reprocessRequestSchema>;

export const cigamClientSchema = z.object({
  code: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  changed: z.boolean().default(false),
  addressChanged: z.boolean().default(false),
});

export const cigamInvoiceSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1),
  companyCode: z.string().optional(),
});

export const cigamRouteSchema = z.object({
  id: z.string().min(1),
  company: z.string().min(1),
  branch: z.string().min(1),
  updatedAt: z.string().min(1),
  operation: z.enum(["UPSERT", "CANCEL_ROUTE", "CANCEL_ORDER"]).default("UPSERT"),
  externalCode: z.union([z.string(), z.number()]).optional(),
  orderCode: z.string().optional(),
  clients: z.array(cigamClientSchema).default([]),
  invoices: z.array(cigamInvoiceSchema).default([]),
  routing: z.record(z.string(), z.unknown()).optional(),
});

export const deliveryResultSchema = z.object({
  routeCode: z.union([z.string(), z.number()]),
  orderCode: z.string(),
  invoiceId: z.string().min(1),
  status: z.string().min(1),
  occurredAt: z.string().optional(),
  receiptUrl: z.string().url().optional(),
  receiptId: z.string().optional(),
  receiptPending: z.boolean().optional(),
  companyCode: z.string().optional(),
});

export type CigamRoute = z.infer<typeof cigamRouteSchema>;
export type CigamClientRecord = z.infer<typeof cigamClientSchema>;
export type DeliveryResult = z.infer<typeof deliveryResultSchema>;

export const wayDataAddressSchema = z.object({
  logradouro: z.string().min(1),
  bairro: z.string().min(1),
  numero: z.number().int().nonnegative(),
  cep: z.string().regex(/^\d{8}$/),
  complemento: z.string().optional(),
  municipio: z.string().min(1),
  uf: z.string().length(2),
});

export const wayDataClientSchema = z.object({
  codigo: z.string().min(1).max(18),
  nome: z.string().min(3).max(70),
  endereco: wayDataAddressSchema.optional(),
  coordenada: z
    .object({ latitude: z.number(), longitude: z.number() })
    .optional(),
  classificacao: z.string().regex(/^(\d{2}|[A-Z])$/),
  inicioAtendimento: z.number().nonnegative().optional(),
  fimAtendimento: z.number().nonnegative().optional(),
  diasAtendimento: z.array(z.string()).optional(),
  telefones: z.array(z.string().regex(/^\d{10,11}$/)).optional(),
  emails: z.array(z.string().email().max(50)).optional(),
});

export const wayDataItemSchema = z.object({
  codigo: z.string().min(1),
  descricao: z.string().min(3).max(120),
  volumeUnitario: z.number().nonnegative(),
  pesoUnitario: z.number().nonnegative(),
  valorUnitario: z.number().nonnegative(),
  quantidade: z.number().int().positive(),
});

export const wayDataShipmentSchema = z.object({
  numeroRemessa: z.string().min(1),
  codigoCliente: z.string().min(1).max(18),
  nfe: z.number().int().optional(),
  cte: z.number().int().optional(),
  manifesto: z.string().optional(),
  dataEmissao: z.string().datetime({ local: true }).optional(),
  cnpjEmissor: z.string().regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/),
  codigoVendedor: z.string().optional(),
  tipoPagamento: z.number().int().optional(),
  itensRemessa: z.array(wayDataItemSchema).min(1),
  frete: z.number().nonnegative().optional(),
  dataFaturamento: z.string().datetime({ local: true }).optional(),
  tipo: z.number().int().optional(),
  nomeEmissor: z.string().optional(),
  roteirizacao: z.number().int().optional(),
  tipoPedido: z.string().optional(),
  dataEntrega: z.string().datetime({ local: true }).optional(),
  dataSaida: z.string().datetime({ local: true }).optional(),
  tipoCarga: z.string().max(20).optional(),
  observacaoPedido: z.string().max(80).optional(),
});

export const wayDataRoutingSchema = z.object({
  nome: z.string().min(1).max(30),
  codigoClientePartida: z.string().min(1).max(18),
  codigoClienteChegada: z.string().min(1).max(18),
  dataInicial: z.string().datetime({ local: true }),
  dataFinal: z.string().datetime({ local: true }),
  veiculosRoteirizacao: z
    .array(
      z.object({
        placa: z.string().optional(),
        codigoMotorista: z.number().int().optional(),
        remessas: z.array(wayDataShipmentSchema).min(1),
      }).superRefine((vehicle, ctx) => {
        const unique = new Set(vehicle.remessas.map((item) => item.codigoCliente));
        if (unique.size > 199) {
          ctx.addIssue({ code: "custom", message: "A roteirização excede 199 clientes únicos por veículo", path: ["remessas"] });
        }
      }),
    )
    .min(1),
  codigoRoteirizacao: z.number().int().default(0),
  flagTracking: z.boolean().default(true),
}).superRefine((routing, ctx) => {
  if (routing.dataFinal < routing.dataInicial) {
    ctx.addIssue({ code: "custom", message: "dataFinal deve ser posterior ou igual a dataInicial", path: ["dataFinal"] });
  }
});

export type WayDataClient = z.infer<typeof wayDataClientSchema>;
export type WayDataRouting = z.infer<typeof wayDataRoutingSchema>;
export type WayDataRoutingInput = z.input<typeof wayDataRoutingSchema>;
