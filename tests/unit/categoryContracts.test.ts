import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CreateCategorySchema,
  UpdateCategorySchema,
  DeactivateCategorySchema,
  PublicCategoriesResponseSchema,
  categoryTree,
  flattenCategories,
  type Category,
} from "../../shared/contracts/category.ts";
const create = () => ({
  name: "Hortaliças",
  slug: "hortalicas",
  iconName: "leaf",
  commandId: randomUUID(),
});
const row = (
  displayOrder: number,
  parentId: string | null = null,
): Category => ({
  id: randomUUID(),
  parentId,
  name: "Categoria " + displayOrder,
  slug: "categoria-" + displayOrder,
  iconName: "leaf",
  description: null,
  displayOrder,
  isActive: true,
  revision: 1,
});
describe("T13 contratos de categorias", () => {
  it("normaliza campos e preenche apenas padrões seguros", () =>
    expect(
      CreateCategorySchema.parse({ ...create(), name: "  Hortaliças  " }),
    ).toMatchObject({
      name: "Hortaliças",
      parentId: null,
      description: null,
      displayOrder: 0,
    }));
  it.each([
    "A",
    "HORTALICAS",
    "com espaço",
    "com_acento",
    "ação",
    "-horta",
    "horta-",
    "x".repeat(65),
  ])("rejeita slug inválido %s", (slug) =>
    expect(CreateCategorySchema.safeParse({ ...create(), slug }).success).toBe(
      false,
    ),
  );
  it.each(["hortalicas", "ab", "a-1", "x".repeat(64)])(
    "aceita slug %s",
    (slug) =>
      expect(
        CreateCategorySchema.safeParse({ ...create(), slug }).success,
      ).toBe(true),
  );
  it.each([
    { isActive: false },
    { producerId: randomUUID() },
    { storeId: randomUUID() },
    { revision: 50 },
    { commandId: "invalid" },
    { displayOrder: 1.5 },
    { displayOrder: 2147483648 },
    { name: "x" },
    { iconName: "external-url" },
    { description: "x".repeat(501) },
    { parentId: "invalid" },
  ])("rejeita campos e valores não autorizados %#", (extra) =>
    expect(
      CreateCategorySchema.safeParse({ ...create(), ...extra }).success,
    ).toBe(false),
  );
  it("exige revisão na edição e confirmação de impacto tipada", () => {
    expect(UpdateCategorySchema.safeParse(create()).success).toBe(false);
    expect(
      UpdateCategorySchema.safeParse({ ...create(), expectedRevision: 0 })
        .success,
    ).toBe(false);
    expect(
      DeactivateCategorySchema.safeParse({
        expectedRevision: 1,
        commandId: randomUUID(),
        confirmImpact: "true",
      }).success,
    ).toBe(false);
  });
  it("compõe e percorre hierarquia ordenada, promovendo filhos de pai invisível", () => {
    const a = row(1),
      b = row(2, a.id),
      c = row(3, randomUUID());
    const tree = categoryTree([a, b, c]);
    expect(tree.map((item) => item.id)).toEqual([a.id, c.id]);
    expect(tree[0].children[0].id).toBe(b.id);
    expect(flattenCategories(tree)).toEqual([a, b, c]);
    expect(
      PublicCategoriesResponseSchema.safeParse({ categories: tree }).success,
    ).toBe(true);
  });
  it("falha de forma segura se a base contiver ciclo", () => {
    const a = row(1),
      b = row(2, a.id);
    a.parentId = b.id;
    expect(() => categoryTree([a, b])).toThrow("CATEGORY_HIERARCHY_INVALID");
  });
});
