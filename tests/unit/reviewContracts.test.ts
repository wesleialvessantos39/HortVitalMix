import { describe, it, expect } from "vitest";
import {
  CreateReviewSchema,
  ModerateReviewSchema,
  ReviewListQuerySchema,
  AdminReviewQuerySchema,
  StoreReviewsSchema,
} from "../../shared/contracts/review.ts";
const orderId = "00000000-0000-4000-8000-000000000024";
describe("T24 contratos de avaliação", () => {
  it.each([1, 2, 3, 4, 5])(
    "aceita nota %s, comentário opcional e normaliza espaços",
    (rating) => {
      expect(
        CreateReviewSchema.parse({ orderId, rating, comment: "  Frescos  " }),
      ).toEqual({ orderId, rating, comment: "Frescos" });
      expect(CreateReviewSchema.safeParse({ orderId, rating }).success).toBe(
        true,
      );
    },
  );
  it.each([0, 6, 1.5, NaN, Infinity, "5", null])(
    "rejeita nota inválida %s",
    (rating) =>
      expect(CreateReviewSchema.safeParse({ orderId, rating }).success).toBe(
        false,
      ),
  );
  it("limita comentário a 1000 caracteres e rejeita identificadores forjados", () => {
    expect(
      CreateReviewSchema.safeParse({
        orderId,
        rating: 5,
        comment: "a".repeat(1000),
      }).success,
    ).toBe(true);
    expect(
      CreateReviewSchema.safeParse({
        orderId,
        rating: 5,
        comment: "a".repeat(1001),
      }).success,
    ).toBe(false);
    for (const key of [
      "customerPersonId",
      "storeId",
      "isModerated",
      "createdAt",
    ])
      expect(
        CreateReviewSchema.safeParse({ orderId, rating: 5, [key]: orderId })
          .success,
      ).toBe(false);
  });
  it("exige motivo de 10 a 500 caracteres reais para moderação", () => {
    for (const reason of [undefined, "", "  ", "a".repeat(9), "a".repeat(501)])
      expect(ModerateReviewSchema.safeParse({ reason }).success).toBe(false);
    for (const n of [10, 500])
      expect(
        ModerateReviewSchema.parse({ reason: " a".trim().repeat(n) }).reason,
      ).toHaveLength(n);
    expect(
      ModerateReviewSchema.safeParse({
        reason: "Motivo válido",
        moderatedBy: orderId,
      }).success,
    ).toBe(false);
  });
  it("valida páginas e filtros sem aceitar campos extras", () => {
    expect(ReviewListQuerySchema.parse({})).toEqual({ page: 1 });
    expect(
      AdminReviewQuerySchema.parse({ state: "moderated", page: "2" }),
    ).toEqual({ state: "moderated", page: 2, search: "" });
    for (const page of [0, -1, 1.5, "no", 100001])
      expect(ReviewListQuerySchema.safeParse({ page }).success).toBe(false);
    expect(AdminReviewQuerySchema.safeParse({ state: "deleted" }).success).toBe(
      false,
    );
    expect(ReviewListQuerySchema.safeParse({ storeId: orderId }).success).toBe(
      false,
    );
  });
  it("resposta pública estrita não permite dados pessoais ou motivo privado", () => {
    const response = {
      reputation: { averageRating: 5, totalReviews: 1 },
      reviews: [
        {
          id: orderId,
          rating: 5,
          comment: null,
          createdAt: new Date().toISOString(),
        },
      ],
      page: 1,
      pages: 1,
      total: 1,
    };
    expect(StoreReviewsSchema.safeParse(response).success).toBe(true);
    for (const key of ["orderId", "customerPersonId", "moderationReason"])
      expect(
        StoreReviewsSchema.safeParse({
          ...response,
          reviews: [{ ...response.reviews[0], [key]: orderId }],
        }).success,
      ).toBe(false);
  });
});
