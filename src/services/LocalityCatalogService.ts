import { api, type ApiFailure } from "../lib/api";
import type {
  LocalityCoverage,
  Municipality,
  MunicipalityList,
  ProducerDeliveryScope,
} from "../../shared/contracts/locality";
import { MunicipalityListSchema } from "../../shared/contracts/locality";

export type { LocalityCoverage, Municipality, ProducerDeliveryScope };

/**
 * Catálogo público de localidades de cobertura.
 * O endpoint é aberto: a tela global consulta antes de qualquer login.
 */
export async function fetchMunicipalities(): Promise<MunicipalityList> {
  return MunicipalityListSchema.parse(await api<unknown>("/v1/localities"));
}

export type CoverageResult = {
  coverage: LocalityCoverage;
  municipality: { id: string; name: string; state: string } | null;
  message: string | null;
};

export async function fetchCoverage(
  state: string,
  municipality: string,
): Promise<CoverageResult> {
  const query =
    "/v1/localities/coverage?state=" +
    encodeURIComponent(state) +
    "&municipality=" +
    encodeURIComponent(municipality);
  return api<CoverageResult>(query);
}

export async function fetchDeliveryScope(): Promise<ProducerDeliveryScope> {
  return api<ProducerDeliveryScope>("/v1/producer/delivery-scope");
}

export async function saveDeliveryScope(input: {
  mode: ProducerDeliveryScope["mode"];
  municipalityIds: string[];
  expectedRevision: number;
  commandId: string;
}): Promise<ProducerDeliveryScope> {
  return api<ProducerDeliveryScope>("/v1/producer/delivery-scope", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function isLocalityFailure(error: unknown): error is ApiFailure {
  const code = (error as { message?: string })?.message ?? "";
  return (
    code === "LOCALITY_DISABLED" ||
    code === "LOCALITY_NOT_COVERED" ||
    code === "LOCALITY_NOT_FOUND" ||
    code === "INVALID_MUNICIPALITY"
  );
}
