import { describe, expect, it, vi } from "vitest";
import {
  classifyGeocodingAccuracy,
  GEOCODING_LIMITS,
  GeocodingHelper,
} from "../../server/services/GeocodingHelper";

function input(overrides: Record<string, unknown> = {}) {
  return {
    cep: "76870000",
    street: "Rua das Hortas",
    number: "10",
    neighborhood: "Centro",
    city: "Ariquemes",
    state: "RO",
    ...overrides,
  } as any;
}

function response(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => body,
  } as Response);
}

describe("geocodificação assistiva", () => {
  it("pin manual prevalece sem chamar serviço externo", async () => {
    const fetcher = vi.fn();
    const result = await GeocodingHelper.resolve(
      input({ latitude: -9.913, longitude: -63.04 }),
      fetcher as any,
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(result).toEqual({
      latitude: -9.913,
      longitude: -63.04,
      accuracy: "manual",
    });
  });

  it("retorna coordenadas de rua quando o serviço resolve", async () => {
    const fetcher = vi
      .fn()
      .mockImplementationOnce(() =>
        response({
          logradouro: "Rua das Hortas",
          bairro: "Centro",
          localidade: "Ariquemes",
          uf: "RO",
        }),
      )
      .mockImplementationOnce(() =>
        response([{ lat: "-9.91", lon: "-63.03", type: "road" }]),
      );
    const result = await GeocodingHelper.resolve(input(), fetcher as any);
    expect(result.accuracy).toBe("street");
    expect(result.latitude).toBeCloseTo(-9.91);
    expect(result.longitude).toBeCloseTo(-63.03);
  });

  it("classifica resultado de edificação como rooftop", () => {
    expect(classifyGeocodingAccuracy({ type: "house" })).toBe("rooftop");
  });

  it("classifica bairro como neighborhood", () => {
    expect(classifyGeocodingAccuracy({ addresstype: "suburb" })).toBe(
      "neighborhood",
    );
  });

  it("degrada para none e limita Nominatim a duas tentativas", async () => {
    const fetcher = vi.fn().mockImplementation((url: string) => {
      if (url.includes("viacep")) return response({ erro: true });
      return response([], false);
    });
    const result = await GeocodingHelper.resolve(input(), fetcher as any);
    const nominatimCalls = fetcher.mock.calls.filter(([url]) =>
      String(url).includes("nominatim.openstreetmap.org"),
    );
    expect(result).toEqual({
      latitude: null,
      longitude: null,
      accuracy: "none",
    });
    expect(nominatimCalls).toHaveLength(2);
  });

  it("mantém limites gratuitos de 3s, 4s e no máximo um retry", () => {
    expect(GEOCODING_LIMITS).toEqual({
      nominatimTimeoutMs: 3000,
      viaCepTimeoutMs: 4000,
      nominatimMaxAttempts: 2,
    });
  });
});
