import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_T24_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const u = new URL(value);
  if (
    u.hostname !== "127.0.0.1" ||
    u.port !== "55432" ||
    u.pathname !== "/postgres"
  )
    throw Error("T24_LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  return { dbPool: new pg.Pool({ connectionString: value, max: 8 }) };
});
vi.mock("../../server/supabase/client.ts", () => ({
  supabaseAdmin: {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: async (paths: string[]) => ({
          error: null,
          data: paths.map((path) => ({
            signedUrl: `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=local`,
          })),
        }),
      }),
    },
  },
}));
import { dbPool } from "../../server/db/pool.ts";
import { ReviewService as service } from "../../server/services/ReviewService.ts";
import { reviewFixtures } from "../helpers/reviewFixtures.ts";
import { checkoutAudit } from "../helpers/checkoutFixtures.ts";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";
describe.runIf(!!process.env.HVM_T24_LOCAL_DATABASE_URL)(
  "T24 PostgreSQL: compra verificada, reputação e moderação",
  () => {
    const pool = () => dbPool as Pool;
    let f: Awaited<ReturnType<typeof reviewFixtures>>, admin: AdminActorContext;
    const create = (
      p: Awaited<ReturnType<typeof f.paid>>,
      rating = 5,
      command = randomUUID(),
    ) =>
      service.createReview(
        p.b.userId,
        { orderId: p.id, rating, comment: "Produtos sintéticos T24" },
        command,
        checkoutAudit(),
      );
    const projection = async (store = f.catalog.a.store.id) =>
      (
        await pool().query(
          "SELECT average_rating::float,total_reviews FROM app_reputation_projections WHERE store_id=$1",
          [store],
        )
      ).rows[0];
    async function consistent(store = f.catalog.a.store.id) {
      const actual = (
        await pool().query(
          "SELECT coalesce(round(avg(rating),2),0)::float average_rating,count(*)::int total_reviews FROM app_reviews WHERE store_id=$1 AND NOT is_moderated",
          [store],
        )
      ).rows[0];
      expect(await projection(store)).toEqual(actual);
    }
    beforeAll(async () => {
      f = await reviewFixtures(pool());
      admin = await f.admin();
    }, 20000);
    afterAll(async () => {
      try {
        if (f) await f.cleanup();
      } finally {
        await dbPool?.end();
      }
    }, 20000);
    it.each(["in_preparation", "out_for_delivery"] as const)(
      "rejeita %s com 422 sem avaliação, projeção ou auditoria",
      async (status) => {
        const p = await f.paid();
        await f.advance(p, status);
        const before = await projection();
        await expect(create(p)).rejects.toMatchObject({
          code: "REVIEW_NOT_DELIVERED",
          status: 422,
        });
        expect(
          (
            await pool().query(
              "SELECT count(*)::int n FROM app_reviews WHERE order_id=$1",
              [p.id],
            )
          ).rows[0].n,
        ).toBe(0);
        expect(await projection()).toEqual(before);
        expect((await service.eligibility(p.b.userId, p.id)).reason).toBe(
          "not_delivered",
        );
      },
    );
    it("entrega comprovada com nota 5 recalcula a projeção imediatamente sem alterar finanças ou esteira", async () => {
      const p = await f.delivered();
      const before = (
        await pool().query(
          "SELECT to_jsonb(o) o,to_jsonb(f) f FROM app_orders o JOIN app_order_fulfillment f ON f.order_id=o.id WHERE o.id=$1",
          [p.id],
        )
      ).rows[0];
      expect((await service.eligibility(p.b.userId, p.id)).canReview).toBe(
        true,
      );
      const r = await create(p);
      expect(r.rating).toBe(5);
      expect(await projection()).toEqual({
        average_rating: 5,
        total_reviews: 1,
      });
      const after = (
        await pool().query(
          "SELECT to_jsonb(o) o,to_jsonb(f) f FROM app_orders o JOIN app_order_fulfillment f ON f.order_id=o.id WHERE o.id=$1",
          [p.id],
        )
      ).rows[0];
      expect(after).toEqual(before);
      expect(after.o.status).toBe("confirmed");
      expect(after.f.status).toBe("delivered");
    });
    it("apenas o comprador pode criar/consultar a avaliação, mesmo com outro pedido entregue", async () => {
      const p = await f.delivered(),
        other = await f.buyer([]);
      for (const action of [
        () => service.eligibility(other.userId, p.id),
        () =>
          service.createReview(
            other.userId,
            { orderId: p.id, rating: 5 },
            randomUUID(),
            checkoutAudit(),
          ),
      ])
        await expect(action()).rejects.toMatchObject({
          status: 404,
          code: "ORDER_NOT_FOUND",
        });
    });
    it("UNIQUE(order_id) impede duplicidade e reenvio do mesmo comando retorna o recibo original", async () => {
      const p = await f.delivered(),
        command = randomUUID(),
        r = await create(p, 4, command);
      expect(await create(p, 4, command)).toEqual(r);
      await expect(create(p)).rejects.toMatchObject({
        status: 409,
        code: "REVIEW_ALREADY_EXISTS",
      });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_reviews WHERE order_id=$1",
            [p.id],
          )
        ).rows[0].n,
      ).toBe(1);
      expect(await service.eligibility(p.b.userId, p.id)).toMatchObject({
        canReview: false,
        reason: "already_reviewed",
        review: { id: r.id },
      });
      await expect(create(p, 3, command)).rejects.toMatchObject({
        code: "COMMAND_REUSED",
        status: 409,
      });
    });
    it("dois comandos concorrentes para o mesmo pedido geram uma única avaliação", async () => {
      const p = await f.delivered(),
        results = await Promise.allSettled([create(p, 2), create(p, 3)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { status: 409 },
      });
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_reviews WHERE order_id=$1",
            [p.id],
          )
        ).rows[0].n,
      ).toBe(1);
      await consistent();
    });
    it("inserções simultâneas de pedidos diferentes não perdem contagem nem média", async () => {
      const orders = [];
      for (let i = 0; i < 3; i++) orders.push(await f.delivered());
      const before = await projection();
      await Promise.all(orders.map((p, i) => create(p, i + 1)));
      expect((await projection()).total_reviews).toBe(before.total_reviews + 3);
      await consistent();
    });
    it("moderação preserva a linha e seu conteúdo, recalcula a média e grava autor, data e motivo", async () => {
      const p = await f.delivered(),
        r = await create(p, 1),
        before = await projection(),
        reason = "Comentário incompatível com a compra verificada.";
      const command = randomUUID();
      const moderated = await service.moderateReview(
        r.id,
        admin,
        { reason },
        command,
        checkoutAudit(),
      );
      expect(moderated).toMatchObject({
        id: r.id,
        comment: r.comment,
        rating: 1,
        isModerated: true,
        moderationReason: reason,
        moderatedBy: admin.userId,
      });
      expect(moderated.moderatedAt).toBeTruthy();
      expect((await projection()).total_reviews).toBe(before.total_reviews - 1);
      await consistent();
      expect(
        await service.moderateReview(
          r.id,
          admin,
          { reason },
          command,
          checkoutAudit(),
        ),
      ).toEqual(moderated);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_audit_events WHERE action='review.moderated' AND target_id=$1",
            [r.id],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it("oculta a avaliação pública, preserva a leitura administrativa e impede nova avaliação do comprador", async () => {
      const p = await f.delivered(),
        r = await create(p);
      await service.moderateReview(
        r.id,
        admin,
        { reason: "Texto com informações pessoais indevidas." },
        randomUUID(),
        checkoutAudit(),
      );
      const publicResult = await service.publicStoreReviews(
        f.catalog.a.store.storeSlug,
        {},
      );
      expect(publicResult.reviews.some((v) => v.id === r.id)).toBe(false);
      const rows = await service.adminList(admin, { state: "moderated" });
      expect(rows.reviews.some((v) => v.id === r.id && v.isModerated)).toBe(
        true,
      );
      expect(
        (await service.eligibility(p.b.userId, p.id)).review?.isModerated,
      ).toBe(true);
      await expect(create(p)).rejects.toMatchObject({ status: 409 });
      for (const v of publicResult.reviews)
        expect(Object.keys(v).sort()).toEqual([
          "comment",
          "createdAt",
          "id",
          "rating",
        ]);
    });
    it("última avaliação moderada zera contagem/média e não conserva nota antiga", async () => {
      const p = await f.delivered([f.catalog.pb], f.catalog.b.userId),
        r = await create(p);
      expect(await projection(f.catalog.b.store.id)).toEqual({
        average_rating: 5,
        total_reviews: 1,
      });
      await service.moderateReview(
        r.id,
        admin,
        { reason: "Moderação da última avaliação desta loja." },
        randomUUID(),
        checkoutAudit(),
      );
      expect(await projection(f.catalog.b.store.id)).toEqual({
        average_rating: 0,
        total_reviews: 0,
      });
      expect(
        (await service.publicStoreReviews(f.catalog.b.store.storeSlug, {}))
          .reviews,
      ).toEqual([]);
    });
    it("motivo ausente/curto falha e notas/comentários permanecem imutáveis no SQL", async () => {
      const p = await f.delivered(),
        r = await create(p);
      await expect(
        service.moderateReview(
          r.id,
          admin,
          { reason: " " },
          randomUUID(),
          checkoutAudit(),
        ),
      ).rejects.toThrow();
      await expect(
        pool().query("UPDATE app_reviews SET rating=2 WHERE id=$1", [r.id]),
      ).rejects.toThrow("REVIEW_IMMUTABLE");
      await expect(
        pool().query("UPDATE app_reviews SET comment='alterado' WHERE id=$1", [
          r.id,
        ]),
      ).rejects.toThrow("REVIEW_IMMUTABLE");
      await service.moderateReview(
        r.id,
        admin,
        { reason: "Motivo íntegro para auditoria futura." },
        randomUUID(),
        checkoutAudit(),
      );
      await expect(
        pool().query(
          "UPDATE app_reviews SET is_moderated=false,moderation_reason=NULL,moderated_at=NULL,moderated_by=NULL WHERE id=$1",
          [r.id],
        ),
      ).rejects.toThrow("REVIEW_MODERATION_IMMUTABLE");
    });
    it("guard SQL impede vínculo forjado de loja/pessoa e pedido sem entrega mesmo como backend", async () => {
      const p = await f.delivered(),
        other = await f.buyer([]);
      for (const [person, store] of [
        [other.personId, f.catalog.a.store.id],
        [p.b.personId, f.catalog.b.store.id],
      ])
        await expect(
          pool().query(
            "INSERT INTO app_reviews(order_id,customer_person_id,store_id,rating) VALUES($1,$2,$3,5)",
            [p.id, person, store],
          ),
        ).rejects.toThrow("REVIEW_VERIFIED_DELIVERY_REQUIRED");
      const pending = await f.paid();
      await expect(
        pool().query(
          "INSERT INTO app_reviews(order_id,customer_person_id,store_id,rating) VALUES($1,$2,$3,5)",
          [pending.id, pending.b.personId, f.catalog.a.store.id],
        ),
      ).rejects.toThrow("REVIEW_VERIFIED_DELIVERY_REQUIRED");
    });
    it("RLS ENABLE/FORCE, anon/auth só veem colunas públicas e não podem mutar", async () => {
      const states = (
        await pool().query(
          "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=ANY($1::regclass[])",
          [["public.app_reviews", "public.app_reputation_projections"]],
        )
      ).rows;
      expect(states).toHaveLength(2);
      expect(
        states.every((r) => r.relrowsecurity && r.relforcerowsecurity),
      ).toBe(true);
      for (const role of ["anon", "authenticated"]) {
        const c = await pool().connect();
        try {
          await c.query("BEGIN");
          await c.query(`SET LOCAL ROLE ${role}`);
          const visible = await c.query(
            "SELECT id,rating,comment FROM app_reviews",
          );
          expect(visible.rowCount).toBeGreaterThan(0);
          await expect(
            c.query(
              "SELECT customer_person_id,order_id,moderation_reason FROM app_reviews",
            ),
          ).rejects.toMatchObject({ code: "42501" });
          await c.query("ROLLBACK");
          for (const sql of [
            "INSERT INTO app_reviews DEFAULT VALUES",
            "UPDATE app_reviews SET rating=5",
            "DELETE FROM app_reviews",
            "UPDATE app_reputation_projections SET total_reviews=0",
          ]) {
            await c.query("BEGIN");
            await c.query(`SET LOCAL ROLE ${role}`);
            await expect(c.query(sql)).rejects.toMatchObject({ code: "42501" });
            await c.query("ROLLBACK");
          }
        } finally {
          await c.query("ROLLBACK");
          c.release();
        }
      }
    });
    it("administrador sem setor e setor revogado são negados apesar das claims do cliente", async () => {
      const actor = await f.admin("platform_admin");
      await expect(
        service.adminList({ ...actor, sectors: ["complaint_management"] }, {}),
      ).rejects.toMatchObject({ status: 403 });
      await pool().query(
        "INSERT INTO app_admin_sector_members(user_id,sector_code) VALUES($1,'complaint_management')",
        [actor.userId],
      );
      expect((await service.adminList(actor, {})).total).toBeGreaterThan(0);
      await pool().query(
        "UPDATE app_admin_sector_members SET revoked_at=now() WHERE user_id=$1",
        [actor.userId],
      );
      await expect(
        service.adminList({ ...actor, sectors: ["complaint_management"] }, {}),
      ).rejects.toMatchObject({ status: 403 });
    });
    it("loja pausada deixa de expor avaliações pela policy e pela API pública", async () => {
      await pool().query(
        "UPDATE app_producer_stores SET status='paused' WHERE id=$1",
        [f.catalog.a.store.id],
      );
      try {
        await expect(
          service.publicStoreReviews(f.catalog.a.store.storeSlug, {}),
        ).rejects.toMatchObject({ code: "STORE_NOT_FOUND", status: 404 });
        const c = await pool().connect();
        try {
          await c.query("BEGIN");
          await c.query("SET LOCAL ROLE anon");
          expect(
            (
              await c.query("SELECT id FROM app_reviews WHERE store_id=$1", [
                f.catalog.a.store.id,
              ])
            ).rowCount,
          ).toBe(0);
        } finally {
          await c.query("ROLLBACK");
          c.release();
        }
      } finally {
        await pool().query(
          "UPDATE app_producer_stores SET status='active' WHERE id=$1",
          [f.catalog.a.store.id],
        );
      }
    });
    it("DELETE autorizado por retenção recalcula e cascata T06 de comprador não fica bloqueada", async () => {
      const p = await f.delivered(),
        r = await create(p, 3),
        before = await projection();
      await pool().query("DELETE FROM app_reviews WHERE id=$1", [r.id]);
      expect((await projection()).total_reviews).toBe(before.total_reviews - 1);
      await consistent();
      const other = await f.delivered();
      await create(other, 2);
      await other.b.cleanup();
      expect(
        (
          await pool().query("SELECT id FROM app_reviews WHERE order_id=$1", [
            other.id,
          ])
        ).rowCount,
      ).toBe(0);
      await consistent();
    });
    it("apagamento de loja continua permitido e não recria projeção após cascata", async () => {
      const temp = await reviewFixtures(pool());
      try {
        const p = await temp.delivered();
        await service.createReview(
          p.b.userId,
          { orderId: p.id, rating: 5 },
          randomUUID(),
          checkoutAudit(),
        );
        await pool().query("DELETE FROM auth.users WHERE id=$1", [
          temp.catalog.a.userId,
        ]);
        expect(
          (
            await pool().query(
              "SELECT store_id FROM app_reputation_projections WHERE store_id=$1",
              [temp.catalog.a.store.id],
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await pool().query("SELECT id FROM app_reviews WHERE order_id=$1", [
              p.id,
            ])
          ).rowCount,
        ).toBe(0);
      } finally {
        await temp.cleanup();
      }
    });
    it("DELETE da última avaliação publicada também zera a projeção", async () => {
      const p = await f.delivered([f.catalog.pb], f.catalog.b.userId),
        r = await create(p, 2);
      expect(await projection(f.catalog.b.store.id)).toEqual({
        average_rating: 2,
        total_reviews: 1,
      });
      await pool().query("DELETE FROM app_reviews WHERE id=$1", [r.id]);
      expect(await projection(f.catalog.b.store.id)).toEqual({
        average_rating: 0,
        total_reviews: 0,
      });
    });
    it("policy omite a linha moderada e service_role não tem DELETE direto de avaliações", async () => {
      const p = await f.delivered(),
        r = await create(p);
      await service.moderateReview(
        r.id,
        admin,
        { reason: "Texto retirado para auditoria administrativa." },
        randomUUID(),
        checkoutAudit(),
      );
      const c = await pool().connect();
      try {
        for (const role of ["anon", "authenticated"]) {
          await c.query("BEGIN");
          await c.query(`SET LOCAL ROLE ${role}`);
          expect(
            (await c.query("SELECT id FROM app_reviews WHERE id=$1", [r.id]))
              .rowCount,
          ).toBe(0);
          await c.query("ROLLBACK");
        }
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE service_role");
        await expect(
          c.query("DELETE FROM app_reviews WHERE id=$1", [r.id]),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
    it("exclusão do moderador preserva motivo/data sem bloquear a T06", async () => {
      const actor = await f.admin(),
        p = await f.delivered(),
        r = await create(p);
      await service.moderateReview(
        r.id,
        actor,
        { reason: "Motivo auditável após exclusão da conta." },
        randomUUID(),
        checkoutAudit(),
      );
      const before = (
        await pool().query(
          "SELECT moderation_reason,moderated_at FROM app_reviews WHERE id=$1",
          [r.id],
        )
      ).rows[0];
      await pool().query("DELETE FROM auth.users WHERE id=$1", [actor.userId]);
      const after = (
        await pool().query(
          "SELECT moderation_reason,moderated_at,moderated_by FROM app_reviews WHERE id=$1",
          [r.id],
        )
      ).rows[0];
      expect(after).toEqual({ ...before, moderated_by: null });
    });
    it("pagina em dez avaliações, mantém a projeção consistente e não mistura lojas", async () => {
      const before = await projection();
      for (let i = 0; i < 5; i++) await create(await f.delivered(), 4);
      const first = await service.publicStoreReviews(
        f.catalog.a.store.storeSlug,
        { page: 1 },
      );
      const second = await service.publicStoreReviews(
        f.catalog.a.store.storeSlug,
        { page: 2 },
      );
      expect(first.total).toBe(before.total_reviews + 5);
      expect(first.pages).toBe(2);
      expect(first.reviews).toHaveLength(10);
      expect(second.reviews).toHaveLength(first.total - 10);
      const ids = [...first.reviews, ...second.reviews].map((r) => r.id);
      expect(new Set(ids).size).toBe(first.total);
      expect(
        (await service.publicStoreReviews(f.catalog.b.store.storeSlug, {}))
          .total,
      ).toBe(0);
      await consistent();
    });
  },
);
