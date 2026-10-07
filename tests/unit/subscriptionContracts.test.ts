import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CreateSubscriptionSchema,
  PlanInputSchema,
  ChangeSubscriptionSchema,
  RunBillingCycleSchema,
} from "../../shared/contracts/subscription.ts";
import { nextSubscriptionPeriod } from "../../server/services/SubscriptionService.ts";
const recurrence = () => ({
  dayOfWeek: 2,
  preferredWindowId: randomUUID(),
  basketTemplate: [randomUUID()],
});
describe("T23 contratos e períodos", () => {
  it("consumidor: preserva o contrato do manual e valida dias/produtos", () => {
    const v = {
      planId: randomUUID(),
      deliveryAddressId: randomUUID(),
      recurrence: recurrence(),
    };
    expect(CreateSubscriptionSchema.parse(v)).toEqual(v);
    expect(
      CreateSubscriptionSchema.safeParse({
        ...v,
        recurrence: { ...v.recurrence, dayOfWeek: 7 },
      }).success,
    ).toBe(false);
    expect(
      CreateSubscriptionSchema.safeParse({
        ...v,
        additionalRecurrences: [v.recurrence],
      }).success,
    ).toBe(false);
    expect(
      CreateSubscriptionSchema.safeParse({
        ...v,
        recurrence: {
          ...v.recurrence,
          basketTemplate: [
            v.recurrence.basketTemplate[0],
            v.recurrence.basketTemplate[0],
          ],
        },
      }).success,
    ).toBe(false);
  });
  it("produtor pode assinar sem endereço/cesta; campos extras e IDs inválidos falham", () => {
    expect(
      CreateSubscriptionSchema.parse({ planId: randomUUID() }),
    ).toBeTruthy();
    expect(
      CreateSubscriptionSchema.safeParse({ planId: "x", status: "active" })
        .success,
    ).toBe(false);
    expect(
      ChangeSubscriptionSchema.safeParse({ expectedRevision: 0 }).success,
    ).toBe(false);
    expect(RunBillingCycleSchema.safeParse({ cycleIndex: 0 }).success).toBe(
      false,
    );
  });
  it("planos separam os públicos e não permitem preços negativos", () => {
    const p = {
      slug: "horta-semanal",
      name: "Cesta de teste",
      targetAudience: "consumer",
      deliveriesPerWeek: 1,
      priceCents: 1000,
      billingPeriod: "weekly",
      description: "Somente teste local",
      storeId: randomUUID(),
      isActive: true,
    };
    expect(PlanInputSchema.parse(p)).toBeTruthy();
    expect(PlanInputSchema.safeParse({ ...p, priceCents: -1 }).success).toBe(
      false,
    );
    expect(
      PlanInputSchema.safeParse({ ...p, targetAudience: "producer" }).success,
    ).toBe(false);
    expect(
      PlanInputSchema.parse({
        ...p,
        targetAudience: "producer",
        deliveriesPerWeek: 0,
        storeId: null,
      }),
    ).toBeTruthy();
  });
  it("mensal preserva a hora e limita o dia no mês curto; semana e quinzena são exatas", () => {
    expect(
      nextSubscriptionPeriod(
        new Date("2026-02-28T13:14:15Z"),
        "monthly",
        31,
      ).toISOString(),
    ).toBe("2026-03-31T13:14:15.000Z");
    expect(
      nextSubscriptionPeriod(
        new Date("2026-01-31T13:14:15Z"),
        "monthly",
      ).toISOString(),
    ).toBe("2026-02-28T13:14:15.000Z");
    expect(
      nextSubscriptionPeriod(
        new Date("2028-01-31T13:14:15Z"),
        "monthly",
      ).toISOString(),
    ).toBe("2028-02-29T13:14:15.000Z");
    expect(
      nextSubscriptionPeriod(
        new Date("2026-10-01T00:00:00Z"),
        "weekly",
      ).toISOString(),
    ).toBe("2026-10-08T00:00:00.000Z");
    expect(
      nextSubscriptionPeriod(
        new Date("2026-10-01T00:00:00Z"),
        "biweekly",
      ).toISOString(),
    ).toBe("2026-10-15T00:00:00.000Z");
  });
});
