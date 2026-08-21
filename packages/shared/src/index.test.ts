import { describe, expect, it } from "vitest";
import { sanitizeValue, wayDataRoutingSchema } from "./index";

describe("sanitizeValue", () => {
  it("redacts nested secrets", () => {
    expect(sanitizeValue({ headers: { Authorization: "Bearer abc" }, ok: true })).toEqual({
      headers: { Authorization: "<REDACTED>" },
      ok: true,
    });
  });
});

describe("wayDataRoutingSchema", () => {
  it("rejects an empty route", () => {
    expect(
      wayDataRoutingSchema.safeParse({
        nome: "Rota",
        codigoClientePartida: "1",
        codigoClienteChegada: "2",
        dataInicial: "2026-07-18T08:00:00",
        dataFinal: "2026-07-18T18:00:00",
        veiculosRoteirizacao: [],
      }).success,
    ).toBe(false);
  });
});
