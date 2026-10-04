import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T13_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("T13_LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
import { dbPool } from "../../server/db/pool.ts";
import { CategoryService } from "../../server/services/CategoryService.ts";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
import {
  CreateCategorySchema,
  flattenCategories,
  type Category,
  type CategoryFields,
} from "../../shared/contracts/category.ts";
const pool = () => dbPool as Pool;
const context = () => ({ requestId: randomUUID(), ipHash: "b".repeat(64) });
const fields = (
  category: Category,
  patch: Partial<CategoryFields> = {},
): CategoryFields => ({
  name: category.name,
  slug: category.slug,
  iconName: category.iconName,
  description: category.description,
  displayOrder: category.displayOrder,
  parentId: category.parentId,
  expectedRevision: category.revision,
  commandId: randomUUID(),
  ...patch,
});
const command = (category: Category) => ({
  expectedRevision: category.revision,
  commandId: randomUUID(),
});
const fixtureIds: string[] = [];
async function actorFixture(
  role: AdminActorContext["role"] = "platform_super_admin",
): Promise<AdminActorContext> {
  const userId = randomUUID(),
    personId = randomUUID();
  await pool().query(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
    [userId, userId + "@example.test"],
  );
  await pool().query(
    "INSERT INTO app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,'Administrador de teste local',$3,$4,'+5569999999999')",
    [
      personId,
      userId,
      String(Math.floor(Math.random() * 1e11)).padStart(11, "0"),
      userId + "@example.test",
    ],
  );
  await pool().query(
    "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
    [userId, role],
  );
  await pool().query(
    "INSERT INTO app_admin_principals(admin_user_id,person_id,admin_email,portal_role) VALUES($1,$2,$3,$4)",
    [userId, personId, userId + "@example.test", role],
  );
  return {
    userId,
    role,
    isSuperAdmin: role === "platform_super_admin",
    sectors: [],
    sessionIssuedAt: new Date().toISOString(),
  };
}
async function asRole(
  role: "anon" | "authenticated" | "service_role",
  sql: string,
  values: unknown[] = [],
) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    return await client.query(sql, values);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}
const baseSnapshot = async () =>
  (
    await pool().query(
      "SELECT jsonb_build_object('stores',(SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY id)::text,'')) FROM app_producer_stores s),'hours',(SELECT md5(coalesce(jsonb_agg(to_jsonb(h) ORDER BY id)::text,'')) FROM app_store_operating_hours h),'properties',(SELECT count(*) FROM app_properties),'documents',(SELECT count(*) FROM app_documents)) AS value",
    )
  ).rows[0].value;
describe.runIf(Boolean(process.env.HVM_T13_LOCAL_DATABASE_URL))(
  "T13 PostgreSQL real, isolamento e transações",
  () => {
    let actor: AdminActorContext;
    let before: unknown;
    async function create(patch: Record<string, unknown> = {}) {
      const value = CreateCategorySchema.parse({
        name: "Categoria de teste local",
        slug: "teste-" + randomUUID(),
        iconName: "leaf",
        displayOrder: 50,
        commandId: randomUUID(),
        ...patch,
      });
      const category = await CategoryService.createCategory(
        value,
        actor,
        context(),
      );
      fixtureIds.push(category.id);
      return category;
    }
    beforeAll(async () => {
      actor = await actorFixture();
      before = await baseSnapshot();
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS count FROM supabase_migrations.schema_migrations",
          )
        ).rows[0].count,
      ).toBe(53);
    });
    afterAll(async () => {
      try {
        expect(await baseSnapshot()).toEqual(before);
        // Only generated fixtures in this guarded, disposable loopback database.
        await pool().query(
          "UPDATE app_categories SET parent_id=NULL WHERE id=ANY($1::uuid[])",
          [fixtureIds],
        );
        await pool().query(
          "DELETE FROM app_categories WHERE id=ANY($1::uuid[])",
          [fixtureIds],
        );
      } finally {
        await dbPool?.end();
      }
    });
    it("seed real contém as cinco categorias canônicas na ordem 1–5", async () => {
      const result = await pool().query(
        "SELECT slug,name,icon_name,display_order FROM app_categories ORDER BY display_order,name,id",
      );
      expect(result.rows).toEqual([
        {
          slug: "hortalicas-folhosas",
          name: "Hortaliças folhosas",
          icon_name: "leaf",
          display_order: 1,
        },
        {
          slug: "legumes-picados",
          name: "Legumes picados",
          icon_name: "knife",
          display_order: 2,
        },
        {
          slug: "mix-prontos",
          name: "Mix prontos",
          icon_name: "bowl",
          display_order: 3,
        },
        {
          slug: "temperos-e-ervas",
          name: "Temperos e ervas",
          icon_name: "sparkles",
          display_order: 4,
        },
        { slug: "frutas", name: "Frutas", icon_name: "sun", display_order: 5 },
      ]);
    });
    it("RLS está ENABLE/FORCE com policy apenas SELECT", async () => {
      expect(
        (
          await pool().query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='app_categories'::regclass",
          )
        ).rows[0],
      ).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      expect(
        (
          await pool().query(
            "SELECT cmd FROM pg_policies WHERE tablename='app_categories'",
          )
        ).rows,
      ).toEqual([{ cmd: "SELECT" }]);
    });
    it.each(["anon", "authenticated"] as const)(
      "%s lê seed e não escreve",
      async (role) => {
        expect(
          (
            await asRole(
              role,
              "SELECT count(*)::int AS count FROM app_categories",
            )
          ).rows[0].count,
        ).toBe(5);
        await expect(
          asRole(
            role,
            "INSERT INTO app_categories(slug,name,icon_name) VALUES('ilegal','Ilegal','leaf')",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          asRole(
            role,
            "UPDATE app_categories SET slug='ilegal' WHERE slug='frutas'",
          ),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          asRole(role, "DELETE FROM app_categories WHERE slug='frutas'"),
        ).rejects.toMatchObject({ code: "42501" });
      },
    );
    it("backend service_role lê todas e não recebe DELETE", async () => {
      await expect(
        asRole(
          "service_role",
          "DELETE FROM app_categories WHERE slug='frutas'",
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("Super Admin cria categoria e auditoria na mesma transação", async () => {
      const category = await create();
      const event = (
        await pool().query(
          "SELECT action,actor_id,actor_role,payload_after FROM app_audit_events WHERE target_entity='app_categories' AND target_id=$1",
          [category.id],
        )
      ).rows[0];
      expect(event).toMatchObject({
        action: "category.created",
        actor_id: actor.userId,
        actor_role: "platform_super_admin",
        payload_after: { slug: category.slug, revision: 1 },
      });
    });
    it("edita slug, nome, ícone e ordem com histórico antes/depois", async () => {
      const category = await create(),
        slug = "editada-" + randomUUID();
      const updated = await CategoryService.updateCategory(
        category.id,
        fields(category, {
          slug,
          name: "Categoria editada",
          iconName: "carrot",
          displayOrder: -10,
        }),
        actor,
        context(),
      );
      expect(updated).toMatchObject({
        slug,
        revision: 2,
        displayOrder: -10,
        iconName: "carrot",
      });
      const audit = (
        await pool().query(
          "SELECT payload_before,payload_after FROM app_audit_events WHERE target_id=$1 AND action='category.updated'",
          [category.id],
        )
      ).rows[0];
      expect(audit.payload_before.slug).toBe(category.slug);
      expect(audit.payload_after.slug).toBe(slug);
    });
    it("slug duplicado é 409 e não grava auditoria nem cadastro", async () => {
      const count = (
        await pool().query("SELECT count(*) FROM app_audit_events")
      ).rows[0].count;
      await expect(create({ slug: "frutas" })).rejects.toMatchObject({
        code: "CATEGORY_SLUG_CONFLICT",
        status: 409,
      });
      expect(
        (await pool().query("SELECT count(*) FROM app_audit_events")).rows[0]
          .count,
      ).toBe(count);
    });
    it("parent inexistente falha com 422", async () => {
      await expect(create({ parentId: randomUUID() })).rejects.toMatchObject({
        code: "CATEGORY_PARENT_NOT_FOUND",
        status: 422,
      });
    });
    it("rejeita ciclo direto e indireto de três níveis", async () => {
      const a = await create(),
        b = await create({ parentId: a.id }),
        c = await create({ parentId: b.id });
      for (const parentId of [a.id, c.id])
        await expect(
          CategoryService.updateCategory(
            a.id,
            fields(a, { parentId }),
            actor,
            context(),
          ),
        ).rejects.toMatchObject({
          code: "CATEGORY_CYCLE_FORBIDDEN",
          status: 422,
        });
      expect(
        (
          await pool().query(
            "SELECT parent_id,revision FROM app_categories WHERE id=$1",
            [a.id],
          )
        ).rows[0],
      ).toEqual({ parent_id: null, revision: 1 });
    });
    it("reparentamentos concorrentes não criam ciclo", async () => {
      const a = await create(),
        b = await create();
      const results = await Promise.allSettled([
        CategoryService.updateCategory(
          a.id,
          fields(a, { parentId: b.id }),
          actor,
          context(),
        ),
        CategoryService.updateCategory(
          b.id,
          fields(b, { parentId: a.id }),
          actor,
          context(),
        ),
      ]);
      expect(
        results.filter((value) => value.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        (
          results.find(
            (value) => value.status === "rejected",
          ) as PromiseRejectedResult
        ).reason,
      ).toMatchObject({ code: "CATEGORY_CYCLE_FORBIDDEN", status: 422 });
      await expect(
        CategoryService.listActiveCategories(),
      ).resolves.toBeDefined();
    });
    it("mesmo comando de criação concorrente gera um cadastro e um evento", async () => {
      const input = CreateCategorySchema.parse({
        name: "Idempotente",
        slug: "idempotente-" + randomUUID(),
        iconName: "bowl",
        commandId: randomUUID(),
      });
      const results = await Promise.all([
        CategoryService.createCategory(input, actor, context()),
        CategoryService.createCategory(input, actor, context()),
      ]);
      fixtureIds.push(results[0].id);
      expect(results[0].id).toBe(results[1].id);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int AS count FROM app_audit_events WHERE command_id=$1",
            [input.commandId],
          )
        ).rows[0].count,
      ).toBe(1);
      await expect(
        CategoryService.createCategory(
          { ...input, name: "Outro comando" },
          actor,
          context(),
        ),
      ).rejects.toMatchObject({
        code: "CATEGORY_COMMAND_CONFLICT",
        status: 409,
      });
    });
    it("revisão obsoleta não sobrescreve a edição anterior", async () => {
      const category = await create();
      await CategoryService.updateCategory(
        category.id,
        fields(category, { name: "Primeira edição" }),
        actor,
        context(),
      );
      await expect(
        CategoryService.updateCategory(
          category.id,
          fields(category, { name: "Edição atrasada" }),
          actor,
          context(),
        ),
      ).rejects.toMatchObject({
        code: "CATEGORY_REVISION_CONFLICT",
        status: 409,
        currentRevision: 2,
      });
      expect(
        (
          await pool().query("SELECT name FROM app_categories WHERE id=$1", [
            category.id,
          ])
        ).rows[0].name,
      ).toBe("Primeira edição");
    });
    it("Administrador comum e flag de Super Admin adulterada não mutam", async () => {
      const common = await actorFixture("platform_admin"),
        category = await create();
      for (const user of [
        common,
        {
          ...common,
          role: "platform_super_admin" as const,
          isSuperAdmin: true,
        },
      ])
        await expect(
          CategoryService.updateCategory(
            category.id,
            fields(category, { slug: "ilegal-" + randomUUID() }),
            user,
            context(),
          ),
        ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    });
    it("revalida status, papel e validade da autorização no banco", async () => {
      const category = await create(),
        user = await actorFixture();
      await pool().query("UPDATE app_users SET status='blocked' WHERE id=$1", [
        user.userId,
      ]);
      await expect(
        CategoryService.updateCategory(
          category.id,
          fields(category),
          user,
          context(),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      await pool().query("UPDATE app_users SET status='active' WHERE id=$1", [
        user.userId,
      ]);
      await pool().query(
        "UPDATE app_user_role_assignments SET granted_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE user_id=$1",
        [user.userId],
      );
      await expect(
        CategoryService.updateCategory(
          category.id,
          fields(category),
          user,
          context(),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    });
    it("sessão antiga/futura/inválida não permite mutação", async () => {
      const category = await create();
      for (const sessionIssuedAt of [
        new Date(Date.now() - 20 * 60000).toISOString(),
        new Date(Date.now() + 60000).toISOString(),
        "invalid",
      ])
        await expect(
          CategoryService.updateCategory(
            category.id,
            fields(category),
            { ...actor, sessionIssuedAt },
            context(),
          ),
        ).rejects.toMatchObject({
          code: "ADMIN_REAUTHENTICATION_REQUIRED",
          status: 401,
        });
    });
    it("falha da auditoria desfaz a alteração da categoria", async () => {
      const category = await create();
      await expect(
        CategoryService.updateCategory(
          category.id,
          fields(category, { name: "Sem auditoria" }),
          actor,
          { ...context(), requestId: "not-a-uuid" },
        ),
      ).rejects.toMatchObject({ status: 422 });
      expect(
        (
          await pool().query(
            "SELECT name,revision FROM app_categories WHERE id=$1",
            [category.id],
          )
        ).rows[0],
      ).toEqual({ name: category.name, revision: 1 });
    });
    it("desativação desaparece imediatamente para anon/authenticated e reativação restaura", async () => {
      const category = await create(),
        input = { ...command(category), confirmImpact: false };
      expect(
        await CategoryService.getDeactivationImpact(category.id, actor),
      ).toMatchObject({
        activeProducts: 0,
        activeChildren: 0,
        requiresConfirmation: false,
      });
      const inactive = await CategoryService.deactivateCategory(
        category.id,
        input,
        actor,
        context(),
      );
      expect(
        (
          await CategoryService.deactivateCategory(
            category.id,
            input,
            actor,
            context(),
          )
        ).revision,
      ).toBe(inactive.revision);
      for (const role of ["anon", "authenticated"] as const)
        expect(
          (
            await asRole(role, "SELECT id FROM app_categories WHERE id=$1", [
              category.id,
            ])
          ).rows,
        ).toHaveLength(0);
      expect(
        (
          await asRole(
            "service_role",
            "SELECT is_active FROM app_categories WHERE id=$1",
            [category.id],
          )
        ).rows[0].is_active,
      ).toBe(false);
      expect(
        flattenCategories(await CategoryService.listActiveCategories()).some(
          (row) => row.id === category.id,
        ),
      ).toBe(false);
      expect(
        (await CategoryService.listAdminCategories(actor)).some(
          (row) => row.id === category.id,
        ),
      ).toBe(true);
      const active = await CategoryService.reactivateCategory(
        category.id,
        command(inactive),
        actor,
        context(),
      );
      expect(active.revision).toBe(3);
      expect(
        (
          await asRole("anon", "SELECT id FROM app_categories WHERE id=$1", [
            category.id,
          ])
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await pool().query(
            "SELECT action FROM app_audit_events WHERE target_id=$1 AND action IN ('category.deactivated','category.reactivated') ORDER BY occurred_at",
            [category.id],
          )
        ).rows.map((row) => row.action),
      ).toEqual(["category.deactivated", "category.reactivated"]);
    });
    it("filhos ativos exigem confirmação e são preservados ao desativar o pai", async () => {
      const parent = await create(),
        child = await create({ parentId: parent.id });
      await expect(
        CategoryService.deactivateCategory(
          parent.id,
          { ...command(parent), confirmImpact: false },
          actor,
          context(),
        ),
      ).rejects.toMatchObject({
        code: "CATEGORY_IMPACT_CONFIRMATION_REQUIRED",
        status: 409,
        impact: { activeChildren: 1 },
      });
      const inactive = await CategoryService.deactivateCategory(
        parent.id,
        { ...command(parent), confirmImpact: true },
        actor,
        context(),
      );
      expect(
        (await CategoryService.listActiveCategories()).find(
          (row) => row.id === child.id,
        ),
      ).toMatchObject({ parentId: parent.id, isActive: true });
      await CategoryService.reactivateCategory(
        parent.id,
        command(inactive),
        actor,
        context(),
      );
      expect(
        (await CategoryService.listActiveCategories()).find(
          (row) => row.id === parent.id,
        )?.children[0].id,
      ).toBe(child.id);
    });
    it("relatório futuro conta apenas produtos publicados e revalida impacto na escrita", async () => {
      expect(
        (await pool().query("SELECT to_regclass('app_products') AS products"))
          .rows[0].products,
      ).toBeNull();
      const category = await create();
      // Disposable compatibility fixture; T13 never creates this table in its migration.
      await pool().query(
        "CREATE TABLE app_products(id uuid DEFAULT gen_random_uuid(),category_id uuid NOT NULL,is_published boolean NOT NULL)",
      );
      try {
        await pool().query(
          "INSERT INTO app_products(category_id,is_published) VALUES($1,true),($1,false)",
          [category.id],
        );
        expect(
          await CategoryService.getDeactivationImpact(category.id, actor),
        ).toMatchObject({ activeProducts: 1, requiresConfirmation: true });
        await expect(
          CategoryService.deactivateCategory(
            category.id,
            { ...command(category), confirmImpact: false },
            actor,
            context(),
          ),
        ).rejects.toMatchObject({
          code: "CATEGORY_IMPACT_CONFIRMATION_REQUIRED",
          impact: { activeProducts: 1 },
        });
        await CategoryService.deactivateCategory(
          category.id,
          { ...command(category), confirmImpact: true },
          actor,
          context(),
        );
      } finally {
        await pool().query("DROP TABLE app_products");
      }
    });
  },
);
