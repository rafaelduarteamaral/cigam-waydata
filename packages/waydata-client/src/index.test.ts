import { afterEach, describe, expect, it, vi } from "vitest";
import { WayDataClient } from "./index";

afterEach(() => vi.unstubAllGlobals());

describe("WayDataClient", () => {
  it("keeps scanning today's covers when an older pending route fails", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ codigo: 5445535 }]), { status: 200 }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ codigo: 5445535, entregas: [{ pedidos: [{
        codigo: "41561-4227", nfe: 4227, status: { descricao: "Entregue" },
        fotos: [{ codigo: 0, url: "https://wayds.net/photo.png" }],
      }] }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onError = vi.fn().mockResolvedValue(undefined);
    const client = new WayDataClient({ baseUrl: "https://wayds.net", token: "secret", maxRetries: 0 });
    await expect(client.listDeliveryResults("2026-10-01", "2026-10-01", ["9001"], onError))
      .resolves.toMatchObject([{ invoiceId: "4227", receiptUrl: "https://wayds.net/photo.png" }]);
    expect(onError).toHaveBeenCalledWith("9001", expect.objectContaining({ status: 404 }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses codigo from production covers to fetch delivery details", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ codigo: 9001 }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ codigo: 9001, entregas: [
        { codigoCliente: "000123", pedidos: [{ codigo: "P1", nfe: 123, status: { descricao: "Entregue" } }] },
      ] }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WayDataClient({ baseUrl: "https://wayds.net", token: "secret", maxRetries: 0 });
    await expect(client.listDeliveryResults("2026-09-29", "2026-09-29")).resolves.toMatchObject([
      { routeCode: "9001", invoiceId: "123", companyCode: "000123", status: "ENTREGUE" },
    ]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://wayds.net/rota?codigorota=9001");
  });

  it("parses nested IntegraWay v3 delivery results", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ codigorota: 9, CodigoRoteirizacao: 7001 }, { CodigoRota: 9 }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
      items: [{ CodigoRota: 9, Pedidos: [{ nfe: 100, codigoPedido: "P1", TipoStatus: 1, Marcacao: { Fotos: [{ statusMarcacao: "Realizado", Tipo: { FormatoImagem: 3 }, Url: "https://wayds.net/canhoto.png" }] } }] }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WayDataClient({ baseUrl: "https://wayds.net/integraway/api/v1", token: "secret", maxRetries: 0 });
    await expect(client.listDeliveryResults("2026-08-01", "2026-08-04")).resolves.toMatchObject([{ routeCode: "9", invoiceId: "100", status: "ENTREGUE", receiptUrl: "https://wayds.net/canhoto.png" }]);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://wayds.net/integraway/api/v1/rota/capa?dataInicial=2026-08-01&dataFinal=2026-08-04",
      "https://wayds.net/integraway/api/v1/rota?codigorota=9",
    ]);
  });

  it("does not use CodigoRoteirizacao as CodigoRota when a cover is invalid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ CodigoRoteirizacao: 7001 }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WayDataClient({ baseUrl: "https://wayds.net", token: "secret", maxRetries: 0 });
    await expect(client.listDeliveryResults("2026-08-01", "2026-08-01")).rejects.toThrow("Capa WayData sem CodigoRota válido");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("fetches pending routes even outside the cover date window", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WayDataClient({ baseUrl: "https://wayds.net", token: "secret", maxRetries: 0 });
    await client.listDeliveryResults("2026-09-29", "2026-09-29", ["9001", "9001"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://wayds.net/rota?codigorota=9001");
  });

  it("rejects receipt downloads from hosts outside the allow-list", async () => {
    const client = new WayDataClient({ baseUrl: "https://wayds.net/integraway/api/v1", token: "secret", maxRetries: 0 });
    await expect(client.downloadReceipt("https://evil.example/file.pdf")).rejects.toThrow(/não autorizada/);
  });

  it("treats an existing client as found even when the address is incomplete", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ codigo: "001277", nome: "Padaria Centro", classificacao: "A", endereco: { logradouro: "Rua A", cep: "89010" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WayDataClient({ baseUrl: "https://wayds.net/integraway/api/v1", token: "secret", maxRetries: 0 });
    await expect(client.getClient("001277")).resolves.toMatchObject({ codigo: "001277", nome: "Padaria Centro" });
  });

  it("creates routing with codigoRoteirizacao 0 and recovers HTTP 409", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ nome: "36858-0803", CodigoRoteirizacao: 7001, status: 200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ mensagem: "já existe" }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ nome: "36858-0803", CodigoRota: 9, CodigoRoteirizacao: 7001 }]), { status: 200 }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WayDataClient({ baseUrl: "https://wayds.net/integraway/api/v1", token: "secret", maxRetries: 0 });
    const routing = {
      nome: "36858-0803",
      codigoClientePartida: "C1",
      codigoClienteChegada: "C1",
      dataInicial: "2026-08-03T08:00:00",
      dataFinal: "2026-08-03T18:00:00",
      veiculosRoteirizacao: [{ remessas: [{ numeroRemessa: "P1", codigoCliente: "C1", cnpjEmissor: "12.345.678/0001-90", itensRemessa: [{ codigo: "I1", descricao: "Item teste", volumeUnitario: 1, pesoUnitario: 1, valorUnitario: 1, quantidade: 1 }] }] }],
    };
    await expect(client.createRouting(routing)).resolves.toMatchObject({ CodigoRoteirizacao: 7001 });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ codigoRoteirizacao: 0 });
    await expect(client.createRouting(routing)).resolves.toMatchObject({ CodigoRoteirizacao: 7001, status: 409 });
    await expect(client.deleteRoute("7001")).resolves.toMatchObject({ alreadyAbsent: true });
  });

  it("keeps an existing routing code when PATCH is rejected with HTTP 405", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("Method Not Allowed", { status: 405 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new WayDataClient({ baseUrl: "https://wayds.net/integraway/api/v1", token: "secret", maxRetries: 0 });
    await expect(client.updateRouting({
      nome: "36858-0803",
      codigoRoteirizacao: 1277542,
      codigoClientePartida: "C1",
      codigoClienteChegada: "C1",
      dataInicial: "2026-08-03T08:00:00",
      dataFinal: "2026-08-03T18:00:00",
      veiculosRoteirizacao: [{ remessas: [{ numeroRemessa: "P1", codigoCliente: "C1", cnpjEmissor: "12.345.678/0001-90", itensRemessa: [{ codigo: "I1", descricao: "Item teste", volumeUnitario: 1, pesoUnitario: 1, valorUnitario: 1, quantidade: 1 }] }] }],
    })).resolves.toMatchObject({ CodigoRoteirizacao: 1277542, status: 405 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "PATCH" });
  });
});
