import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyHttpError, HttpClient, HttpError } from "./index";

afterEach(() => vi.unstubAllGlobals());

describe("HttpClient", () => {
  it("retries transient GET failures", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpClient({ baseUrl: "https://example.test", maxRetries: 1 });
    await expect(client.request("/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient POST failures when retry is requested", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpClient({ baseUrl: "https://example.test", maxRetries: 1 });
    await expect(client.request("/Cargas_Buscar", { method: "POST", retry: true, body: "{}" })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry authentication failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("denied", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpClient({ baseUrl: "https://example.test", maxRetries: 3 });
    await expect(client.request("/health")).rejects.toBeInstanceOf(HttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry validation or conflict responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "payload inválido" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "duplicado" }), { status: 409 }))
      .mockResolvedValueOnce(new Response("missing", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new HttpClient({ baseUrl: "https://example.test", maxRetries: 3 });
    await expect(client.request("/rota")).rejects.toMatchObject({ status: 400 });
    await expect(client.request("/rota")).rejects.toMatchObject({ status: 409 });
    await expect(client.request("/rota")).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("classifies 400, 404, 409 and 500 explicitly", () => {
    expect(classifyHttpError(new HttpError("HTTP 400", 400, { message: "campo obrigatório" }, "/rota"))).toMatchObject({ kind: "VALIDATION", retryable: false, httpStatus: 400 });
    expect(classifyHttpError(new HttpError("HTTP 404", 404, null, "/pedido"))).toMatchObject({ kind: "NOT_FOUND", retryable: false, httpStatus: 404 });
    expect(classifyHttpError(new HttpError("HTTP 409", 409, { message: "já existe" }, "/rota"))).toMatchObject({ kind: "CONFLICT", retryable: false, httpStatus: 409 });
    expect(classifyHttpError(new HttpError("HTTP 500", 500, null, "/rota"))).toMatchObject({
      kind: "SERVER",
      retryable: true,
      httpStatus: 500,
      message: "Falha temporária HTTP 500 em /rota",
    });
    expect(classifyHttpError(new HttpError("HTTP 405", 405, null, "https://wayds.net/integraway/api/v1/Roteirizacao/integracao"))).toMatchObject({
      kind: "UNKNOWN",
      retryable: false,
      httpStatus: 405,
      message: "HTTP 405 em https://wayds.net/integraway/api/v1/Roteirizacao/integracao",
    });
  });
});
