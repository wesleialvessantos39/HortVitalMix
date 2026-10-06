import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../src/lib/api", () => ({ api: m.api }));
import { fetchMunicipalities } from "../../src/services/LocalityCatalogService.ts";
beforeEach(() => vi.resetAllMocks());
describe("fronteira HTTP do catálogo de localidades", () => {
  it("preserva a lista canônica válida", async () => {
    const value = { municipalities: [{ id: "11111111-1111-4111-8111-111111111111", ibgeCode: "1100023", name: "Ariquemes", state: "RO", isActive: true, revision: 1 }], activeMunicipalityIds: ["11111111-1111-4111-8111-111111111111"] };
    m.api.mockResolvedValue(value);
    expect(await fetchMunicipalities()).toEqual(value);
  });
  it.each([{}, null, { municipalities: null, activeMunicipalityIds: [] }, { municipalities: [null], activeMunicipalityIds: [] }, { municipalities: [], activeMunicipalityIds: "invalid" }])("recusa resposta malformada antes de alterar o estado React: %j", async (value) => {
    m.api.mockResolvedValue(value);
    await expect(fetchMunicipalities()).rejects.toThrow();
  });
  it("mantém catálogo vazio válido sem inventar cobertura ativa", async () => {
    m.api.mockResolvedValue({ municipalities: [], activeMunicipalityIds: [] });
    expect((await fetchMunicipalities()).activeMunicipalityIds).toHaveLength(0);
  });
});
