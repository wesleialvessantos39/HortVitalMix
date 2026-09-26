import type {
  CreateAddressAdvancedInput,
  GeocodingAccuracy,
} from "../../shared/contracts/addressAdvanced.ts";

type FetchLike = typeof fetch;

type AddressForGeocoding = Pick<
  CreateAddressAdvancedInput,
  | "cep"
  | "street"
  | "number"
  | "neighborhood"
  | "city"
  | "state"
  | "latitude"
  | "longitude"
>;

type ViaCepResult = {
  erro?: boolean;
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  type?: string;
  class?: string;
  addresstype?: string;
};

export type GeocodingResult = {
  latitude: number | null;
  longitude: number | null;
  accuracy: GeocodingAccuracy;
};

const NOMINATIM_TIMEOUT_MS = 3000;
const VIACEP_TIMEOUT_MS = 4000;
const VIA_CEP_ASSIST_WINDOW_MS = 350;
const NOMINATIM_USER_AGENT =
  "HortiVitalMix/1.0 (https://hortvitalmix.vercel.app)";

function sleep(ms: number) {
  return new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
}

async function fetchJson<T>(
  url: string,
  timeoutMs: number,
  fetcher: FetchLike,
  headers?: HeadersInit,
): Promise<T | null> {
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function classifyGeocodingAccuracy(
  result: NominatimResult | null | undefined,
): GeocodingAccuracy {
  if (!result) return "none";
  const type = String(result.addresstype ?? result.type ?? "").toLowerCase();
  const klass = String(result.class ?? "").toLowerCase();
  if (
    ["house", "building", "amenity"].includes(type) ||
    klass === "building"
  )
    return "rooftop";
  if (
    ["road", "street", "residential", "highway"].includes(type) ||
    klass === "highway"
  )
    return "street";
  if (
    ["neighbourhood", "neighborhood", "suburb", "quarter", "city_district"].includes(
      type,
    )
  )
    return "neighborhood";
  return "street";
}

function validCoordinatePair(latitude: unknown, longitude: unknown) {
  return (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

async function lookupViaCep(
  cep: string,
  fetcher: FetchLike,
): Promise<ViaCepResult | null> {
  const digits = cep.replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  const result = await fetchJson<ViaCepResult>(
    `https://viacep.com.br/ws/${digits}/json/`,
    VIACEP_TIMEOUT_MS,
    fetcher,
    { Accept: "application/json" },
  );
  return result?.erro ? null : result;
}

export function buildNominatimQuery(
  input: AddressForGeocoding,
  viaCep?: ViaCepResult | null,
) {
  return [
    input.number,
    input.street || viaCep?.logradouro,
    input.neighborhood || viaCep?.bairro,
    input.city || viaCep?.localidade,
    input.state || viaCep?.uf,
    "Brasil",
    input.cep,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(", ");
}

async function queryNominatim(
  query: string,
  fetcher: FetchLike,
): Promise<NominatimResult | null> {
  const deadline = Date.now() + NOMINATIM_TIMEOUT_MS;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;

    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=" +
      encodeURIComponent(query);
    const result = await fetchJson<NominatimResult[]>(
      url,
      Math.max(1, remaining),
      fetcher,
      {
        Accept: "application/json",
        "Accept-Language": "pt-BR,pt;q=0.9",
        "User-Agent": NOMINATIM_USER_AGENT,
      },
    );

    if (result?.[0]) return result[0];

    if (attempt === 0) {
      const retryBudget = deadline - Date.now();
      if (retryBudget <= 0) return null;
      await sleep(Math.min(1000, retryBudget));
    }
  }

  return null;
}

export class GeocodingHelper {
  static async resolve(
    input: AddressForGeocoding,
    fetcher: FetchLike = fetch,
  ): Promise<GeocodingResult> {
    if (validCoordinatePair(input.latitude, input.longitude)) {
      return {
        latitude: input.latitude as number,
        longitude: input.longitude as number,
        accuracy: "manual",
      };
    }

    // ViaCEP continua assistivo. O backend aproveita uma resposta rápida, mas
    // jamais espera os 4 s completos antes de iniciar a geocodificação.
    const viaCepPromise = lookupViaCep(input.cep, fetcher);
    const fastViaCep = await Promise.race([
      viaCepPromise,
      sleep(VIA_CEP_ASSIST_WINDOW_MS),
    ]);

    const query = buildNominatimQuery(input, fastViaCep);
    const candidate = await queryNominatim(query, fetcher);
    const latitude = candidate?.lat ? Number(candidate.lat) : null;
    const longitude = candidate?.lon ? Number(candidate.lon) : null;

    if (!validCoordinatePair(latitude, longitude)) {
      return { latitude: null, longitude: null, accuracy: "none" };
    }

    return {
      latitude,
      longitude,
      accuracy: classifyGeocodingAccuracy(candidate),
    };
  }
}

export const GEOCODING_LIMITS = Object.freeze({
  nominatimTimeoutMs: NOMINATIM_TIMEOUT_MS,
  viaCepTimeoutMs: VIACEP_TIMEOUT_MS,
  nominatimMaxAttempts: 2,
});
