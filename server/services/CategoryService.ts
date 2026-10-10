import { commerceAdmin, CommerceError } from "./CommerceSupport.ts";
import { hasAdminPermission } from "../../shared/adminPermissions.ts";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import { assertRecentAuth, ReauthRequiredError } from "./reauthService.ts";
import { redactPII } from "../security/redactPII.ts";
import {
  CategoryResponseSchema,
  CreateCategorySchema,
  UpdateCategorySchema,
  CategoryStateCommandSchema,
  DeactivateCategorySchema,
  categoryTree,
  type Category,
  type CategoryImpact,
  type CreateCategory,
  type CategoryFields,
  type CategoryStateCommand,
  type DeactivateCategory,
} from "../../shared/contracts/category.ts";

export class CategoryError extends Error {
  constructor(
    public code: string,
    public status: number,
    public currentRevision?: number,
    public impact?: CategoryImpact,
  ) {
    super(code);
    this.name = "CategoryError";
  }
}
export type CategoryAuditContext = { requestId: string; ipHash: string };
type CategoryRow = {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  icon_name: Category["iconName"];
  display_order: number;
  is_active: boolean;
  revision: number;
};
const columns =
  "id,parent_id,slug,name,description,icon_name,display_order,is_active,revision";
function category(row: CategoryRow): Category {
  return CategoryResponseSchema.parse({
    id: row.id,
    parentId: row.parent_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    iconName: row.icon_name,
    displayOrder: row.display_order,
    isActive: row.is_active,
    revision: row.revision,
  });
}
function pool() {
  if (!dbPool) throw new CategoryError("DEPENDENCY_UNAVAILABLE", 503);
  return dbPool;
}
function translate(error: unknown): never {
  if (error instanceof CommerceError)
    throw new CategoryError(error.code, error.status);
  if (error instanceof CategoryError) throw error;
  if (error instanceof ReauthRequiredError)
    throw new CategoryError(error.code, 401);
  const e = error as { code?: string; constraint?: string };
  if (e.code === "23505")
    throw new CategoryError(
      e.constraint === "uq_app_categories_slug"
        ? "CATEGORY_SLUG_CONFLICT"
        : "CATEGORY_COMMAND_CONFLICT",
      409,
    );
  if (["23514", "23503", "22P02"].includes(e.code ?? ""))
    throw new CategoryError("CATEGORY_VALIDATION_FAILED", 422);
  throw new CategoryError("DEPENDENCY_UNAVAILABLE", 503);
}
async function authorize(
  client: PoolClient,
  actor: AdminActorContext,
  write: boolean,
) {
  if (!hasAdminPermission(actor, "catalog_moderation"))
    throw new CategoryError("FORBIDDEN", 403);
  if (write) await assertRecentAuth(actor);
  await commerceAdmin(client, actor, "catalog_moderation");
}
async function find(client: PoolClient, id: string, lock = false) {
  const result = await client.query<CategoryRow>(
    `SELECT ${columns} FROM public.app_categories WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
    [id],
  );
  if (!result.rows[0]) throw new CategoryError("CATEGORY_NOT_FOUND", 404);
  return category(result.rows[0]);
}
async function parentAllowed(
  client: PoolClient,
  id: string,
  parentId: string | null,
) {
  if (!parentId) return;
  if (id === parentId) throw new CategoryError("CATEGORY_CYCLE_FORBIDDEN", 422);
  if (
    !(
      await client.query("SELECT id FROM public.app_categories WHERE id=$1", [
        parentId,
      ])
    ).rows[0]
  )
    throw new CategoryError("CATEGORY_PARENT_NOT_FOUND", 422);
  const result = await client.query<{ cycle: boolean }>(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM public.app_categories WHERE id=$1
       UNION SELECT c.id FROM public.app_categories c JOIN descendants d ON c.parent_id=d.id
     ) SELECT EXISTS(SELECT 1 FROM descendants WHERE id=$2) AS cycle`,
    [id, parentId],
  );
  if (result.rows[0].cycle)
    throw new CategoryError("CATEGORY_CYCLE_FORBIDDEN", 422);
}
async function impact(
  client: PoolClient,
  current: Category,
): Promise<CategoryImpact> {
  const children = await client.query<{ count: string }>(
    "SELECT count(*) FROM public.app_categories WHERE parent_id=$1 AND is_active",
    [current.id],
  );
  const table = await client.query<{ products: string | null }>(
    "SELECT to_regclass('public.app_products')::text AS products",
  );
  let activeProducts = 0;
  // T14's canonical contract is category_id + is_published. No product table
  // is created by T13; when absent this impact is genuinely zero.
  if (table.rows[0].products) {
    const products = await client.query<{ count: string }>(
      "SELECT count(*) FROM public.app_products WHERE category_id=$1 AND is_published=true",
      [current.id],
    );
    activeProducts = Number(products.rows[0].count);
  }
  const activeChildren = Number(children.rows[0].count);
  return {
    categoryId: current.id,
    revision: current.revision,
    activeProducts,
    activeChildren,
    requiresConfirmation: activeProducts > 0 || activeChildren > 0,
  };
}
async function audit(
  client: PoolClient,
  actor: AdminActorContext,
  action: string,
  commandId: string,
  fingerprint: string,
  context: CategoryAuditContext,
  result: Category,
  before?: Category,
) {
  await client.query(
    `INSERT INTO public.app_audit_events(request_id,actor_id,actor_role,action,target_entity,target_id,payload_before,payload_after,client_ip_hash,command_id)
     VALUES($1,$2,'platform_super_admin',$3,'app_categories',$4,$5,$6,$7,$8)`,
    [
      context.requestId,
      actor.userId,
      action,
      result.id,
      before ? JSON.stringify(redactPII(before)) : null,
      JSON.stringify(redactPII({ ...result, commandFingerprint: fingerprint })),
      context.ipHash,
      commandId,
    ],
  );
}
async function mutate<T extends { commandId: string }>(
  id: string | null,
  input: T,
  actor: AdminActorContext,
  context: CategoryAuditContext,
  action: string,
  change: (client: PoolClient, current: Category | null) => Promise<Category>,
): Promise<Category> {
  const client = await pool().connect(),
    fingerprint = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(13,hashtext($1))", [
      input.commandId,
    ]);
    // All structural writes share one lock: concurrent reparenting cannot
    // validate two stale trees and create an indirect cycle.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('hvm-categories-taxonomy'))",
    );
    await authorize(client, actor, true);
    const prior = await client.query<{
      actor_id: string;
      action: string;
      target_entity: string;
      target_id: string;
      payload_after: { commandFingerprint?: string };
    }>(
      "SELECT actor_id,action,target_entity,target_id,payload_after FROM public.app_audit_events WHERE command_id=$1",
      [input.commandId],
    );
    const event = prior.rows[0];
    if (event) {
      if (
        event.actor_id !== actor.userId ||
        event.action !== action ||
        event.target_entity !== "app_categories" ||
        (id && event.target_id !== id) ||
        event.payload_after?.commandFingerprint !== fingerprint
      )
        throw new CategoryError("CATEGORY_COMMAND_CONFLICT", 409);
      const result = await find(client, event.target_id);
      await client.query("COMMIT");
      return result;
    }
    const current = id ? await find(client, id, true) : null;
    if (
      current &&
      (input as T & CategoryStateCommand).expectedRevision !== current.revision
    )
      throw new CategoryError(
        "CATEGORY_REVISION_CONFLICT",
        409,
        current.revision,
      );
    const result = await change(client, current);
    await audit(
      client,
      actor,
      action,
      input.commandId,
      fingerprint,
      context,
      result,
      current ?? undefined,
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    translate(error);
  } finally {
    client.release();
  }
}
export const CategoryService = {
  async listActiveCategories() {
    try {
      const result = await pool().query<CategoryRow>(
        `SELECT ${columns} FROM public.app_categories WHERE is_active=true ORDER BY display_order,name,id`,
      );
      return categoryTree(result.rows.map(category));
    } catch (error) {
      translate(error);
    }
  },
  async listAdminCategories(actor: AdminActorContext) {
    const client = await pool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await authorize(client, actor, false);
      const rows = await client.query<CategoryRow>(
        `SELECT ${columns} FROM public.app_categories ORDER BY display_order,name,id`,
      );
      await client.query("COMMIT");
      return rows.rows.map(category);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      translate(error);
    } finally {
      client.release();
    }
  },
  async getDeactivationImpact(id: string, actor: AdminActorContext) {
    const client = await pool().connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await authorize(client, actor, false);
      const result = await impact(client, await find(client, id));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      translate(error);
    } finally {
      client.release();
    }
  },
  createCategory(
    value: CreateCategory,
    actor: AdminActorContext,
    context: CategoryAuditContext,
  ) {
    const input = CreateCategorySchema.parse(value);
    return mutate(
      null,
      input,
      actor,
      context,
      "category.created",
      async (client) => {
        const id = randomUUID();
        await parentAllowed(client, id, input.parentId);
        const result = await client.query<CategoryRow>(
          `INSERT INTO public.app_categories(id,parent_id,slug,name,description,icon_name,display_order) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING ${columns}`,
          [
            id,
            input.parentId,
            input.slug,
            input.name,
            input.description || null,
            input.iconName,
            input.displayOrder,
          ],
        );
        return category(result.rows[0]);
      },
    );
  },
  updateCategory(
    id: string,
    value: CategoryFields,
    actor: AdminActorContext,
    context: CategoryAuditContext,
  ) {
    const input = UpdateCategorySchema.parse(value);
    return mutate(
      id,
      input,
      actor,
      context,
      "category.updated",
      async (client) => {
        await parentAllowed(client, id, input.parentId);
        const result = await client.query<CategoryRow>(
          `UPDATE public.app_categories SET parent_id=$2,slug=$3,name=$4,description=$5,icon_name=$6,display_order=$7,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
          [
            id,
            input.parentId,
            input.slug,
            input.name,
            input.description || null,
            input.iconName,
            input.displayOrder,
          ],
        );
        return category(result.rows[0]);
      },
    );
  },
  deactivateCategory(
    id: string,
    value: DeactivateCategory,
    actor: AdminActorContext,
    context: CategoryAuditContext,
  ) {
    const input = DeactivateCategorySchema.parse(value);
    return mutate(
      id,
      input,
      actor,
      context,
      "category.deactivated",
      async (client, current) => {
        if (!current?.isActive)
          throw new CategoryError("CATEGORY_ALREADY_INACTIVE", 409);
        const report = await impact(client, current);
        if (report.requiresConfirmation && !input.confirmImpact)
          throw new CategoryError(
            "CATEGORY_IMPACT_CONFIRMATION_REQUIRED",
            409,
            undefined,
            report,
          );
        const result = await client.query<CategoryRow>(
          `UPDATE public.app_categories SET is_active=false,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
          [id],
        );
        return category(result.rows[0]);
      },
    );
  },
  reactivateCategory(
    id: string,
    value: CategoryStateCommand,
    actor: AdminActorContext,
    context: CategoryAuditContext,
  ) {
    const input = CategoryStateCommandSchema.parse(value);
    return mutate(
      id,
      input,
      actor,
      context,
      "category.reactivated",
      async (client, current) => {
        if (current?.isActive)
          throw new CategoryError("CATEGORY_ALREADY_ACTIVE", 409);
        const result = await client.query<CategoryRow>(
          `UPDATE public.app_categories SET is_active=true,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING ${columns}`,
          [id],
        );
        return category(result.rows[0]);
      },
    );
  },
};
