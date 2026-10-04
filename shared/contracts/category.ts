import { z } from "zod";

export const CategoryIconEnum = z.enum([
  "leaf",
  "knife",
  "bowl",
  "sparkles",
  "sun",
  "carrot",
  "basket",
]);
export const CategorySlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/);
const fields = {
  name: z.string().trim().min(2).max(128),
  slug: CategorySlugSchema,
  iconName: CategoryIconEnum,
  description: z.string().trim().max(500).nullable().optional().default(null),
  parentId: z.uuid().nullable().optional().default(null),
  displayOrder: z.number().int().min(-2147483648).max(2147483647).default(0),
};
export const CreateCategorySchema = z
  .object({ ...fields, commandId: z.uuid() })
  .strict();
export const UpdateCategorySchema = z
  .object({
    ...fields,
    expectedRevision: z.number().int().positive(),
    commandId: z.uuid(),
  })
  .strict();
export const CategoryStateCommandSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    commandId: z.uuid(),
  })
  .strict();
export const DeactivateCategorySchema = CategoryStateCommandSchema.extend({
  confirmImpact: z.boolean().default(false),
}).strict();
export const CategoryResponseSchema = z
  .object({
    id: z.uuid(),
    parentId: z.uuid().nullable(),
    slug: CategorySlugSchema,
    name: z.string().min(2).max(128),
    description: z.string().max(500).nullable(),
    iconName: CategoryIconEnum,
    displayOrder: z.number().int(),
    isActive: z.boolean(),
    revision: z.number().int().positive(),
  })
  .strict();
export type Category = z.infer<typeof CategoryResponseSchema>;
export type CategoryNode = Category & { children: CategoryNode[] };
export const CategoryTreeSchema: z.ZodType<CategoryNode> = z.lazy(() =>
  CategoryResponseSchema.extend({
    children: z.array(CategoryTreeSchema),
  }).strict(),
);
export const PublicCategoriesResponseSchema = z
  .object({ categories: z.array(CategoryTreeSchema) })
  .strict();
export const AdminCategoriesResponseSchema = z
  .object({ categories: z.array(CategoryResponseSchema) })
  .strict();
export const CategoryMutationResponseSchema = z
  .object({ category: CategoryResponseSchema })
  .strict();
export const CategoryImpactSchema = z
  .object({
    categoryId: z.uuid(),
    revision: z.number().int().positive(),
    activeProducts: z.number().int().nonnegative(),
    activeChildren: z.number().int().nonnegative(),
    requiresConfirmation: z.boolean(),
  })
  .strict();
export type CategoryImpact = z.infer<typeof CategoryImpactSchema>;
export type CategoryFields = z.infer<typeof UpdateCategorySchema>;
export type CreateCategory = z.infer<typeof CreateCategorySchema>;
export type CategoryStateCommand = z.infer<typeof CategoryStateCommandSchema>;
export type DeactivateCategory = z.infer<typeof DeactivateCategorySchema>;
export type CategoryIconName = z.infer<typeof CategoryIconEnum>;

// Orphaned active children remain selectable when their parent is deactivated.
// Their stored parent is preserved, so reactivation restores the hierarchy.
export function categoryTree(categories: Category[]): CategoryNode[] {
  const nodes = new Map(
    categories.map((category) => [
      category.id,
      { ...category, children: [] } as CategoryNode,
    ]),
  );
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const visited = new Set<string>(),
    pending = [...roots];
  while (pending.length) {
    const node = pending.pop()!;
    if (visited.has(node.id)) throw new Error("CATEGORY_HIERARCHY_INVALID");
    visited.add(node.id);
    pending.push(...node.children);
  }
  if (visited.size !== nodes.size)
    throw new Error("CATEGORY_HIERARCHY_INVALID");
  return roots;
}
export function flattenCategories(nodes: CategoryNode[]): Category[] {
  const result: Category[] = [],
    pending = [...nodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    const { children, ...category } = node;
    result.push(category);
    pending.push(...[...children].reverse());
  }
  return result;
}
