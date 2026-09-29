import { describe, expect, it } from "vitest";
import { integraWayV3Sanitized } from "./fixtures/integraway-v3-sanitized";
import { buildAcompanhamento, formatCnpj, mapCargaDetalhesToRouting, mapCargaRowToRoute, mapEmpresaToWayDataClient, mapIntegraWayDeliveries, mapIntegrationStatusToSituacao, parseMicrosoftDate, shouldCreateDeliveryFollowUp, toLocalDateTime, uniqueRouteName, unwrapAsmx } from "./mapping";

const detalhes = {
  nome: "CARGAS",
  codigoClientePartida: "002628",
  codigoClienteChegada: "002628",
  dataInicial: "/Date(1785726000000)/",
  dataFinal: "/Date(1785726000000)/",
  veiculosRoteirizacao: [
    {
      placa: "JIU9241",
      codigoMotorista: "002727",
      remessas: [
        {
          numeroRemessa: "36858",
          codigoCliente: "001277",
          nfe: 434673,
          cte: 0,
          cnpjEmissor: "11652819000150",
          itensRemessa: [{ codigo: "040010001", descricao: "PAO FRANCES CONG. 06H 1X10KG / 70G POR UND", volumeUnitario: 0, pesoUnitario: 100, valorUnitario: 7.02, quantidade: 100 }],
        },
      ],
    },
  ],
  codigoRoteirizacao: 36858,
  flagTracking: true,
};

describe("CIGAM / IntegraWay mapping", () => {
  it("maps production route deliveries, descriptive status and untyped order photos", () => {
    const results = mapIntegraWayDeliveries([{
      codigo: 9001,
      entregas: [{ codigoCliente: "000123", pedidos: [
        { codigo: "P1", nfe: 123, tipoStatus: 0,
          status: { descricao: "Entregue", data: "2026-09-23T17:50:45" },
          fotos: [{ codigo: 88, statusMarcacao: "Realizado", url: "https://example.com/receipt.png" },
            { codigo: 89, url: "https://example.com/other.png", formatoImagem: 1 }] },
        { codigo: "P2", nfe: 124, tipoStatus: 0, status: { descricao: "NaoInformado" }, fotos: [] },
        { codigo: "P3", nfe: 125, tipoStatus: 0, status: { descricao: "NaoEntregue" }, fotos: [] },
      ] }],
    }]);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ routeCode: "9001", orderCode: "P1", invoiceId: "123",
      companyCode: "000123", status: "ENTREGUE", occurredAt: "2026-09-23T17:50:45",
      receiptId: "88", receiptUrl: "https://example.com/receipt.png" });
    expect(results[1]).toMatchObject({ status: "NAO_INFORMADO" });
    expect(results[2]).toMatchObject({ status: "NAO_ENTREGUE" });
  });

  it.each([
    ["Pendente", "https://example.com/photo.jpg", false],
    [undefined, "https://example.com/photo.jpg", false],
    ["Realizado", "", false],
    ["Realizado", "https://example.com/photo.jpg", true],
  ])("requires Realizado and a URL for a photo (%s, %s)", (statusMarcacao, url, ready) => {
    const [result] = mapIntegraWayDeliveries({ codigo: 9001, entregas: [{ pedidos: [{
      codigo: "P1", nfe: 123, status: { descricao: "Entregue" },
      fotos: [{ codigo: 88, statusMarcacao, url }],
    }] }] });
    expect(result?.receiptUrl).toBe(ready ? url : undefined);
    expect(result?.receiptPending).toBe(!ready);
  });

  it("keeps a route pending when only some photos are ready", () => {
    const [result] = mapIntegraWayDeliveries({ codigo: 9001, entregas: [{ pedidos: [{
      codigo: "P1", nfe: 123, statusMarcacao: "Realizado", status: { descricao: "Entregue" },
      fotos: [{ codigo: 88, url: "https://example.com/ready.jpg" },
        { codigo: 89, statusMarcacao: "Pendente", url: "https://example.com/pending.jpg" }],
    }] }] });
    expect(result).toMatchObject({ receiptUrl: "https://example.com/ready.jpg", receiptPending: true });
  });

  it("parses Microsoft dates and CNPJ", () => {
    expect(parseMicrosoftDate("/Date(1785726000000)/")?.toISOString()).toBe("2026-08-03T03:00:00.000Z");
    expect(formatCnpj("11652819000150")).toBe("11.652.819/0001-50");
    expect(toLocalDateTime("/Date(1785726000000)/")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });

  it("maps Cargas_BuscarDetalhes to a WayData routing payload", () => {
    const routing = mapCargaDetalhesToRouting(detalhes);
    expect(routing.nome).toBe("36858-0803");
    expect(routing.nome.length).toBeLessThanOrEqual(30);
    expect(routing.codigoClientePartida).toBe("002628");
    expect(routing.veiculosRoteirizacao[0]?.placa).toBe("JIU9241");
    expect(routing.veiculosRoteirizacao[0]?.codigoMotorista).toBe(2727);
    expect(routing.dataFinal).toBe("2026-08-03T23:59:00");
    expect(routing.veiculosRoteirizacao[0]?.remessas[0]).toMatchObject({ numeroRemessa: "36858", cnpjEmissor: "11.652.819/0001-50", nfe: 434673 });
    const route = mapCargaRowToRoute(detalhes, { company: "PANEBRAS", branch: "001", includeRouting: true });
    expect(route.id).toBe("36858");
    expect(route.invoices).toEqual([{ id: "434673", number: "434673", companyCode: "001277" }]);
    expect(route.clients.map((item) => item.code).sort()).toEqual(["001277", "002628"]);
  });

  it("uses the shipment client when CIGAM omits route origin and destination", () => {
    const routing = mapCargaDetalhesToRouting({
      ...detalhes,
      codigoClientePartida: null,
      codigoClienteChegada: null,
      veiculosRoteirizacao: detalhes.veiculosRoteirizacao,
    });
    expect(routing.codigoClientePartida).toBe("001277");
    expect(routing.codigoClienteChegada).toBe("001277");
  });

  it("does not treat the CIGAM carga id as a WayData external code", () => {
    const route = mapCargaRowToRoute(detalhes, { company: "PANEBRAS", branch: "001" });
    expect(route.externalCode).toBeUndefined();
    expect(route.operation).toBe("UPSERT");
  });

  it("maps Empresas rows and empty ASMX results", () => {
    expect(mapEmpresaToWayDataClient({ mensagem: "Nenhum registro encontrado.", cd_empresa: null }, "001277")).toBeNull();
    expect(mapEmpresaToWayDataClient({
      cd_empresa: "001277",
      razao_social: "Padaria Centro Ltda",
      endereco: "Rua A",
      numero: "100",
      bairro: "Centro",
      cep: "89010-000",
      municipio: "Blumenau",
      uf: "sc",
      classificacaoParceiro: "A",
    }, "001277")).toMatchObject({ codigo: "001277", nome: "Padaria Centro Ltda", endereco: { uf: "SC", cep: "89010000", numero: 100 } });
    expect(unwrapAsmx({ d: { cd_empresa: "002628", razao_social: "Cliente Partida" } })).toMatchObject([{ cd_empresa: "002628" }]);
  });

  it("extracts IntegraWay v3 receipts only when FormatoImagem is 3", () => {
    const results = mapIntegraWayDeliveries({
      CodigoRota: 940148,
      Pedidos: [
        {
          codigoPedido: "36858",
          nfe: 434673,
          codigoCliente: "001277",
          TipoStatus: 1,
          DataEntrega: "2026-08-03T14:00:00",
          Marcacao: {
            Fotos: [
              { Tipo: { FormatoImagem: 1 }, Url: "https://wayds.net/foto-comum.jpg" },
              { Id: "canhoto-1", statusMarcacao: "Realizado", Tipo: { FormatoImagem: 3 }, Url: "https://wayds.net/canhoto.png" },
            ],
          },
        },
        { codigoPedido: "36859", NotaFiscal: "434674", TipoStatus: "parcial" },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ invoiceId: "434673", status: "ENTREGUE", receiptId: "canhoto-1", receiptUrl: "https://wayds.net/canhoto.png", companyCode: "001277" });
    expect(results[1]).toMatchObject({ invoiceId: "434674", status: "PARCIAL" });
    expect(results[1]?.receiptUrl).toBeUndefined();
  });

  it("keeps route names unique per day and maps IntegraWay v3 N:N deliveries", () => {
    expect(uniqueRouteName("36858", "2026-08-03T00:00:00")).toBe("36858-0803");
    expect(uniqueRouteName("36858", "2026-08-04T00:00:00")).toBe("36858-0804");
    const results = mapIntegraWayDeliveries(integraWayV3Sanitized);
    expect(results.filter((item) => item.orderCode === "36858")).toHaveLength(4);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ invoiceId: "434673", receiptId: "canhoto-1", status: "ENTREGUE" }),
      expect.objectContaining({ invoiceId: "434675", receiptId: "canhoto-2", status: "ENTREGUE" }),
      expect.objectContaining({ invoiceId: "434674", status: "PARCIAL" }),
      expect.objectContaining({ invoiceId: "434676", status: "REENTREGA" }),
    ]));
    expect(results.some((item) => item.invoiceId === "434677")).toBe(true);
    expect(shouldCreateDeliveryFollowUp("NAO_INFORMADO", false)).toBe(false);
    expect(shouldCreateDeliveryFollowUp("NAO_INFORMADO", true)).toBe(true);
    expect(shouldCreateDeliveryFollowUp("PARCIAL", false)).toBe(true);
    expect(shouldCreateDeliveryFollowUp("REENTREGA", false)).toBe(true);
  });

  it("rejects inverted dates and more than 199 unique clients per vehicle", () => {
    expect(() => mapCargaDetalhesToRouting({ ...detalhes, dataInicial: "2026-08-08T18:00:00", dataFinal: "2026-08-08T08:00:00" })).toThrow(/dataFinal/);
    const remessas = Array.from({ length: 200 }, (_, index) => ({
      numeroRemessa: `P${index}`,
      codigoCliente: String(index + 1).padStart(6, "0"),
      nfe: 1000 + index,
      cnpjEmissor: "11652819000150",
      itensRemessa: [{ codigo: "I1", descricao: "Item teste", volumeUnitario: 1, pesoUnitario: 1, valorUnitario: 1, quantidade: 1 }],
    }));
    expect(() => mapCargaDetalhesToRouting({ ...detalhes, veiculosRoteirizacao: [{ placa: "JIU9241", remessas }] })).toThrow(/199 clientes/);
  });

  it("maps integration status to Cargas_MudaSituacao codes and builds acompanhamento", () => {
    expect(mapIntegrationStatusToSituacao("INTEGRATED")).toBe("F");
    expect(mapIntegrationStatusToSituacao("CANCELLED")).toBe("C");
    expect(mapIntegrationStatusToSituacao("ERROR")).toBe("A");
    const payload = buildAcompanhamento({ invoiceNumber: "434673", companyCode: "001277", history: "Canhoto WayData", occurredAt: "2026-08-03T09:01:00-03:00" });
    expect(payload).toMatchObject({ Cd_empresa: "001277", Contato_os_lanc: "434673", Codigo_titulo: "CAN", Hora: "090100", Anexos: "" });
  });
});
