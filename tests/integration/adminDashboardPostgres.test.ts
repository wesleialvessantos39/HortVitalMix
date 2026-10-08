import { createHash, randomInt, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";

vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_DASHBOARD_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.pathname !== "/postgres")
    throw new Error("DASHBOARD_DISPOSABLE_LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  // One connection keeps synthetic fixtures and all service queries inside the
  // rollback transaction. No remote credentials or databases are accepted.
  return { dbPool: new pg.Pool({ connectionString: value, max: 1 }) };
});

import { dbPool } from "../../server/db/pool.ts";
import { AdminDashboardService } from "../../server/services/AdminDashboardService.ts";

const pool = () => dbPool as Pool;
const actor = (input: Partial<AdminActorContext> = {}): AdminActorContext => ({
  userId: randomUUID(), role: "platform_super_admin", sectors: [], deniedSectors: [],
  isSuperAdmin: true, sessionIssuedAt: new Date().toISOString(), ...input,
});
const metric = (response: Awaited<ReturnType<typeof AdminDashboardService.overview>>, key: string) =>
  response.departments.flatMap((department) => department.metrics).find((item) => item.key === key)?.value;

describe.runIf(Boolean(process.env.HVM_DASHBOARD_LOCAL_DATABASE_URL))(
  "Painel administrativo com aggregates, constraints e triggers reais em Postgres local",
  () => {
    beforeEach(async () => { await pool().query("BEGIN"); });
    afterEach(async () => { await pool().query("ROLLBACK"); });
    afterAll(async () => { await dbPool?.end(); });

    it("executa os nove departamentos com valores diretamente derivados dos registros", async () => {
      const response = await AdminDashboardService.overview(actor());
      expect(response.departments).toHaveLength(9);
      const expected = await pool().query(`SELECT
        (SELECT count(*)::int FROM public.app_products WHERE is_published) AS products,
        (SELECT count(*)::int FROM public.app_verification_requests WHERE superseded_at IS NULL AND status IN ('pending','claimed','in_review')) AS queue,
        (SELECT coalesce(sum(amount_cents::bigint),0)::text FROM public.app_payment_intents WHERE status='approved') AS amount,
        (SELECT count(*)::int FROM public.app_audit_events WHERE occurred_at>=now()-interval '24 hours') AS audit`);
      expect(metric(response, "published_products")).toBe(expected.rows[0].products);
      expect(metric(response, "verification_queue")).toBe(expected.rows[0].queue);
      expect(metric(response, "approved_amount")).toBe(Number(expected.rows[0].amount));
      expect(metric(response, "audit_events_24h")).toBe(expected.rows[0].audit);
      expect(Number.isFinite(new Date(response.generatedAt).getTime())).toBe(true);
    });

    it("reconsulta mudanças departamentais sem projeção estática ou cache", async () => {
      const current = actor({ role: "platform_admin", isSuperAdmin: false, sectors: ["location_management"] });
      const before = await AdminDashboardService.overview(current);
      const id = randomUUID();
      await pool().query("INSERT INTO public.app_municipalities(id,ibge_code,name,state,is_active) VALUES($1,'9999998',$2,'RO',true)",
        [id, "Município sintético " + id]);
      const active = await AdminDashboardService.overview(current);
      expect(metric(active, "active_municipalities")).toBe(metric(before, "active_municipalities")! + 1);
      await pool().query("UPDATE public.app_municipalities SET is_active=false,deactivated_at=now() WHERE id=$1", [id]);
      const blocked = await AdminDashboardService.overview(current);
      expect(metric(blocked, "active_municipalities")).toBe(metric(before, "active_municipalities"));
      expect(metric(blocked, "blocked_municipalities")).toBe(metric(before, "blocked_municipalities")! + 1);
    });

    it("convites próprios, expirados, invalidados e arquivados respeitam a semântica real", async () => {
      const ownerId = randomUUID();
      const otherId = randomUUID();
      await pool().query("INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)",
        [ownerId, ownerId + "@example.invalid", otherId, otherId + "@example.invalid"]);
      const current = actor({ userId: ownerId, role: "platform_admin", isSuperAdmin: false, sectors: ["account_governance"] });
      const superActor = actor({ userId: ownerId });
      const beforeSuper = await AdminDashboardService.overview(superActor);
      const own = randomUUID();
      const archived = randomUUID();
      const statuses = [
        { id: own, owner: ownerId, expired: false, invalidated: false },
        { id: archived, owner: ownerId, expired: false, invalidated: false },
        { id: randomUUID(), owner: otherId, expired: false, invalidated: false },
        { id: randomUUID(), owner: ownerId, expired: true, invalidated: false },
        { id: randomUUID(), owner: ownerId, expired: false, invalidated: true },
      ];
      for (const invite of statuses) await pool().query(`INSERT INTO public.app_admin_invites
        (id,email,target_role,token_digest,invited_by,created_at,expires_at,invalidated_at)
        VALUES($1,$2,'platform_admin',$3,$4,now()-interval '48 hours',
          CASE WHEN $5 THEN now()-interval '24 hours' ELSE now()+interval '24 hours' END,
          CASE WHEN $6 THEN now() ELSE NULL END)`,
        [invite.id, invite.id + "@example.invalid", createHash("sha256").update(invite.id).digest("hex"), invite.owner, invite.expired, invite.invalidated]);
      await pool().query(`INSERT INTO public.app_audit_events
        (request_id,actor_id,actor_role,action,target_entity,target_id,client_ip_hash)
        VALUES($1,$2,'platform_admin','admin.invite.archived','app_admin_invites',$3,$4)`,
        [randomUUID(), ownerId, archived, "a".repeat(64)]);
      const ownResponse = await AdminDashboardService.overview(current);
      const superResponse = await AdminDashboardService.overview(superActor);
      expect(metric(ownResponse, "pending_invites")).toBe(1);
      expect(metric(superResponse, "pending_invites")).toBe(metric(beforeSuper, "pending_invites")! + 2);
    });

    it("super com revogações recebe somente os agregados permitidos", async () => {
      const response = await AdminDashboardService.overview(actor({
        deniedSectors: ["account_governance", "document_verification", "finance_ops", "payment_configuration"],
      }));
      expect(response.departments).toHaveLength(5);
      expect(metric(response, "approved_amount")).toBeUndefined();
      expect(metric(response, "active_users")).toBeUndefined();
      expect(metric(response, "verification_queue")).toBeUndefined();
      expect(metric(response, "active_subscriptions")).toBeUndefined();
      expect(metric(response, "audit_events_24h")).toBeUndefined();
    });

    it("não conta credenciais provisórias e inclui identidade pública e administrativa cadastrada", async () => {
      const current = actor({ role: "platform_admin", isSuperAdmin: false, sectors: ["account_governance"] });
      const before = await AdminDashboardService.overview(current);
      const publicId = randomUUID();
      const adminId = randomUUID();
      const personId = randomUUID();
      await pool().query("INSERT INTO auth.users(id,email) VALUES($1,$2),($3,$4)",
        [publicId, publicId + "@example.invalid", adminId, adminId + "@example.invalid"]);
      const provisional = await AdminDashboardService.overview(current);
      expect(metric(provisional, "active_users")).toBe(metric(before, "active_users"));
      await pool().query(`INSERT INTO public.app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164)
        VALUES($1,$2,'Pessoa sintética do painel',$3,$4,'+5569988888888')`,
        [personId, publicId, String(randomInt(10000000000, 99999999999)), publicId + "@example.invalid"]);
      const registered = await AdminDashboardService.overview(current);
      expect(metric(registered, "active_users")).toBe(metric(before, "active_users")! + 1);
      await pool().query(`INSERT INTO public.app_admin_principals(admin_user_id,person_id,admin_email)
        VALUES($1,$2,$3)`, [adminId, personId, adminId + "@example.invalid"]);
      const administrative = await AdminDashboardService.overview(current);
      expect(metric(administrative, "active_users")).toBe(metric(before, "active_users")! + 2);
    });
  },
);
