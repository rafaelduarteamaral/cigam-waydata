import { afterEach, describe, expect, it, vi } from "vitest";
import { CigamClient } from "./index";

afterEach(() => vi.unstubAllGlobals());

describe("CigamClient ASMX", () => {
  it("reads all Cargas_Buscar pages with UN and does not treat carga id as WayData code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ d: [{ __type: "ignored", mensagem: "ok", Paginas: "1", nome: "ROTA 1", codigoClientePartida: "1", codigoClienteChegada: "2", dataInicial: "2026-08-08T08:00:00", dataFinal: "2026-08-08T18:00:00", veiculosRoteirizacao: [{ remessas: [] }], codigoRoteirizacao: 81, flagTracking: true }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CigamClient({ baseUrl: "https://cigam.test/API.asmx", token: "raw-secret", authorizationScheme: "raw", asmx: { unit: "001", lookbackDays: 4 }, paths: { pendingRoutes: "/Cargas_Buscar" } });
    const routes = await client.listPendingRoutes();
    expect(routes).toMatchObject([{ id: "81", company: "PANEBRAS", branch: "001", routing: { nome: "ROTA 1" } }]);
    expect(routes[0]?.externalCode).toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ filtros: { Pagina: "1", UN: "001" } });
    expect(fetchMock).toHaveBeenCalledWith("https://cigam.test/API.asmx/Cargas_Buscar", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "raw-secret" }) }));
  });

  it("does not search for routes before CIGAM_START_DATE", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T15:00:00-03:00"));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ d: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CigamClient({ baseUrl: "https://cigam.test/API.asmx", token: "raw-secret", authorizationScheme: "raw", asmx: { unit: "001", lookbackDays: 4, startDate: "2026-08-10" } });
    await client.listPendingRoutes();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ filtros: { dt_inicial: "2026-08-10", dt_final: "2026-08-12" } });
    vi.useRealTimers();
  });

  it("fails visibly when the CIGAM list exposes pages but no valid carga codes", async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Response(JSON.stringify({ d: [{ mensagem: "Página 1", Paginas: "3", nome: "CARGAS", codigoRoteirizacao: 0 }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CigamClient({ baseUrl: "https://cigam.test/API.asmx", token: "raw-secret", authorizationScheme: "raw", asmx: { unit: "001", lookbackDays: 4 }, paths: { pendingRoutes: "/Cargas_Buscar" } });
    await expect(client.listPendingRoutes()).rejects.toThrow("não retornou codigoRoteirizacao nem numeroRemessa válidos");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("discovers remessas when Cargas_Buscar uses zero as its route code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ d: [{ mensagem: "Página 1", Paginas: "1", nome: "CARGAS", codigoClientePartida: "001", codigoClienteChegada: "001", dataInicial: "2026-08-08T08:00:00", dataFinal: "2026-08-08T18:00:00", codigoRoteirizacao: 0, veiculosRoteirizacao: [{ placa: "ABC1D23", remessas: [{ numeroRemessa: "38484", codigoCliente: "001", cnpjEmissor: "11652819000150", itensRemessa: [{ codigo: "I1", descricao: "Item", quantidade: 1 }] }, { numeroRemessa: "38485", codigoCliente: "001", cnpjEmissor: "11652819000150", itensRemessa: [{ codigo: "I2", descricao: "Item", quantidade: 1 }] }] }] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CigamClient({ baseUrl: "https://cigam.test/API.asmx", token: "raw-secret", authorizationScheme: "raw", asmx: { unit: "001", lookbackDays: 4 } });
    await expect(client.listPendingRoutes()).resolves.toMatchObject([
      { id: "38484", routing: { veiculosRoteirizacao: [{ remessas: [{ numeroRemessa: "38484" }] }] } },
      { id: "38485", routing: { veiculosRoteirizacao: [{ remessas: [{ numeroRemessa: "38485" }] }] } },
    ]);
  });

  it("loads Cargas_BuscarDetalhes, Empresas, MudaSituacao and Acompanhamento_Criar", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).endsWith("/Cargas_BuscarDetalhes")) {
        return new Response(JSON.stringify({ d: [{ nome: "CARGAS", codigoClientePartida: "002628", codigoClienteChegada: "002628", dataInicial: "2026-08-08T08:00:00", dataFinal: "2026-08-08T18:00:00", codigoRoteirizacao: 36858, flagTracking: true, veiculosRoteirizacao: [{ placa: "JIU9241", remessas: [{ numeroRemessa: "36858", codigoCliente: "001277", nfe: 434673, cnpjEmissor: "11652819000150", itensRemessa: [{ codigo: "040010001", descricao: "PAO FRANCES CONG.", volumeUnitario: 0, pesoUnitario: 1, valorUnitario: 1, quantidade: 1 }] }] }] }] }), { status: 200 });
      }
      if (String(url).endsWith("/Empresas")) {
        return new Response(JSON.stringify({ d: [{ cd_empresa: "001277", razao_social: "Padaria Centro Ltda", endereco: "Rua A", numero: "10", bairro: "Centro", cep: "89010000", municipio: "Blumenau", uf: "SC", classificacaoParceiro: "A" }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ d: [{ mensagem: "ok" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new CigamClient({ baseUrl: "https://cigam.test/API.asmx", token: "raw-secret", authorizationScheme: "raw", asmx: { unit: "001" } });
    const route = await client.getRoute("36858");
    expect(route.invoices[0]).toMatchObject({ number: "434673", companyCode: "001277" });
    await expect(client.getCompany({ code: "001277" })).resolves.toMatchObject({ codigo: "001277", nome: "Padaria Centro Ltda" });
    await client.recordRoutingCode("36858", 7001);
    await client.updateIntegrationStatus("36858", { status: "INTEGRATED" });
    await client.recordInvoiceFollowUp({ invoiceId: "434673", result: { routeCode: 1, orderCode: "36858", invoiceId: "434673", status: "ENTREGUE", companyCode: "001277", occurredAt: "2026-08-18T09:01:00-03:00", receiptUrl: "https://wayds.net/canhoto.png" }, idempotencyKey: "k1" });
    await client.recordInvoiceFollowUp({ invoiceId: "434673", result: { routeCode: 7001, orderCode: "36858", invoiceId: "434673", status: "INTEGRATED", companyCode: "001277" }, idempotencyKey: "ext-1", titleCode: "INT", history: "WAYDATA codigoRoteirizacao=7001 carga=36858" });
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
    expect(bodies.some((body) => body.Situacao?.situacao === "F" && body.Situacao?.codigoRoteirizacao === "36858" && body.Situacao?.carga === "36858")).toBe(true);
    expect(bodies.some((body) => body.Roteirizacao?.codigoRoteirizacao === 7001 && body.Roteirizacao?.numeroRemessa === "36858")).toBe(true);
    expect(bodies.some((body) => body.acompanhamento?.Codigo_titulo === "CAN" && body.acompanhamento?.Anexos === "https://wayds.net/canhoto.png" && body.acompanhamento?.Hora === "090100" && body.acompanhamento?.Historico === "ANEXO CANHOTO WAYDATA https://wayds.net/canhoto.png | Status WayData: ENTREGUE")).toBe(true);
    expect(bodies.some((body) => body.acompanhamento?.Codigo_titulo === "INT" && body.acompanhamento?.Anexos === "" && String(body.acompanhamento?.Historico).includes("codigoRoteirizacao=7001"))).toBe(true);
  });

  it("finds Empresas by code when cd_empresa filter is ignored", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const pagina = String(body.filtros?.pagina ?? "1");
      const byCode = body.filtros?.cd_empresa;
      if (byCode) {
        return new Response(JSON.stringify({
          d: [
            { qtdpaginas: "2", mensagem: "Página 1 / Linha 1", cd_empresa: "", razao_social: "", bairro: "X", cep: "70000000", municipio: "BRASILIA", uf: "DF" },
            { qtdpaginas: "2", mensagem: "Página 1 / Linha 2", cd_empresa: "000026", razao_social: "Outra Empresa", endereco: "Rua B", numero: "1", bairro: "Centro", cep: "70000001", municipio: "BRASILIA", uf: "DF" },
          ],
        }), { status: 200 });
      }
      if (pagina === "1") {
        return new Response(JSON.stringify({
          d: [
            { qtdpaginas: "2", mensagem: "Página 1 / Linha 1", cd_empresa: "", razao_social: "", bairro: "X", cep: "70000000", municipio: "BRASILIA", uf: "DF" },
            { qtdpaginas: "2", mensagem: "Página 1 / Linha 2", cd_empresa: "000026", razao_social: "Outra Empresa", endereco: "Rua B", numero: "1", bairro: "Centro", cep: "70000001", municipio: "BRASILIA", uf: "DF" },
          ],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        d: [{
          qtdpaginas: "2",
          mensagem: "Página 2 / Linha 1",
          cd_empresa: "002628",
          razao_social: "DONA DE CASA S/A",
          endereco: "QS 1",
          numero: "100",
          bairro: "Sudoeste",
          cep: "71215100",
          municipio: "BRASILIA",
          uf: "DF",
          classificacaoParceiro: "A",
        }],
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new CigamClient({ baseUrl: "https://cigam.test/API.asmx", token: "raw-secret", authorizationScheme: "raw", asmx: { unit: "001" } });
    await expect(client.getCompany({ code: "002628" })).resolves.toMatchObject({
      codigo: "002628",
      nome: "DONA DE CASA S/A",
      endereco: expect.objectContaining({ cep: "71215100", municipio: "BRASILIA", uf: "DF" }),
    });
    await expect(client.getCompany({ code: "002628" })).resolves.toMatchObject({ codigo: "002628" });
    const empresaCalls = fetchMock.mock.calls.filter((call) => String(call[0]).endsWith("/Empresas"));
    expect(empresaCalls.length).toBeGreaterThanOrEqual(3);
    expect(empresaCalls.length).toBeLessThan(6);
  });
});
