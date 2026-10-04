import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  OperatingHoursSchema,
  SaveStoreSettingsSchema,
  StorePublicResponseSchema,
  StoreSlugSchema,
} from "../../shared/contracts/producerStore.ts";
import { sanitizeStoreBio } from "../../server/services/ProducerStoreService.ts";

const days = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  isHarvestDay: true,
  isDeliveryDay: false,
  cutoffTime: "14:00",
}));
const settings = () => ({
  propertyId: randomUUID(),
  storeSlug: "chacara-colheita",
  storeName: "Chácara Colheita",
  bio: "Produção local com cuidado.",
  minOrderAmountCents: 2000,
  cutoffHour: "14:00",
  expectedRevision: 1,
  commandId: randomUUID(),
  operatingHours: days,
});
describe("T12 contratos e apresentação", () => {
  it("aceita configurações e sete dias válidos", () =>
    expect(SaveStoreSettingsSchema.safeParse(settings()).success).toBe(true));
  it.each(["-chacara", "chacara-", "LOJA", "lo", "a/b", "área-rural"])(
    "rejeita slug %s",
    (slug) => expect(StoreSlugSchema.safeParse(slug).success).toBe(false),
  );
  it("impede dias duplicados", () =>
    expect(
      OperatingHoursSchema.safeParse(days.map(() => days[0])).success,
    ).toBe(false));
  it.each(["24:00", "14:60", "4:30"])("rejeita horário %s", (cutoffHour) =>
    expect(
      SaveStoreSettingsSchema.safeParse({ ...settings(), cutoffHour }).success,
    ).toBe(false),
  );
  it("rejeita atribuição de titular, status, revisão e HTML de mídia pelo cliente", () => {
    for (const key of [
      "producerProfileId",
      "personId",
      "status",
      "revision",
      "logoUrl",
    ])
      expect(
        SaveStoreSettingsSchema.safeParse({ ...settings(), [key]: "injected" })
          .success,
      ).toBe(false);
  });
  it("remove script, SVG e handlers, conservando somente texto e quebras", () => {
    expect(
      sanitizeStoreBio(
        "<script>alert(1)</script><p>Produção <strong>local</strong><br>com cuidado.</p><img src=x onerror=alert(1)><svg onload=alert(1)></svg>",
      ),
    ).toBe("Produção local\ncom cuidado.");
  });
  it("não transforma entidades de texto em markup renderizável", () => {
    expect(sanitizeStoreBio("Terra &amp; cuidado &lt;3")).toBe(
      "Terra & cuidado <3",
    );
    expect(sanitizeStoreBio("<script>alert(1)</script>")).toBe("");
  });
  it("não admite campos pessoais ou chaves privadas na resposta pública", () => {
    const publicStore = {
      name: "Chácara",
      slug: "chacara-local",
      bio: "Produção local.",
      avatarUrl: null,
      bannerUrl: null,
      location: "Ariquemes/RO",
      verification: { isVerified: true, trustLevel: 2 },
      minOrderAmountCents: 2000,
      cutoffHour: "14:00",
      operatingHours: days,
    };
    expect(StorePublicResponseSchema.safeParse(publicStore).success).toBe(true);
    expect(
      StorePublicResponseSchema.safeParse({
        ...publicStore,
        cpf: "12345678901",
      }).success,
    ).toBe(false);
  });
});
