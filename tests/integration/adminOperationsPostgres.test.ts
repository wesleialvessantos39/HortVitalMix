import { randomUUID, randomInt } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AdminActorContext } from "../../server/middleware/adminSession.ts";

vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_OPERATIONS_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw new Error("OPERATIONS_DISPOSABLE_LOCAL_DATABASE_REQUIRED");
  const pg = (await import("pg")).default;
  return { dbPool: new pg.Pool({ connectionString: value, max: 1 }) };
});
// Real SQL, constraints and authorization are executed in one disposable
// rollback transaction. Production credentials/hosts are explicitly refused.
vi.mock("../../server/services/CommerceSupport.ts", async (original) => {
  const actual =
    await original<typeof import("../../server/services/CommerceSupport.ts")>();
  const { dbPool } = await import("../../server/db/pool.ts");
  return {
    ...actual,
    commerceTransaction: <T>(run: (client: PoolClient) => Promise<T>) =>
      run(dbPool as unknown as PoolClient),
  };
});
import { dbPool } from "../../server/db/pool.ts";
import { AdminOperationsService } from "../../server/services/AdminOperationsService.ts";
const pool = () => dbPool as Pool;
async function identity() {
  const id = randomUUID(),
    person = randomUUID();
  await pool().query(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
    [id, id + "@example.invalid"],
  );
  await pool().query(
    "UPDATE public.app_users SET status='active' WHERE id=$1",
    [id],
  );
  await pool().query(
    "INSERT INTO public.app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,'Pessoa sintética operacional',$3,$4,$5)",
    [
      person,
      id,
      String(randomInt(10000000000, 99999999999)),
      id + "@example.invalid",
      "+5569" + String(randomInt(100000000, 999999999)),
    ],
  );
  return { id, person };
}
async function admin(
  role: AdminActorContext["role"] = "platform_super_admin",
  sectors: AdminActorContext["sectors"] = [],
) {
  const person = await identity(),
    user = randomUUID();
  await pool().query(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
    [user, user + "@example.invalid"],
  );
  await pool().query(
    "UPDATE public.app_users SET status='active' WHERE id=$1",
    [user],
  );
  await pool().query(
    "INSERT INTO public.app_admin_principals(admin_user_id,person_id,admin_email,portal_role,email_verified_at) VALUES($1,$2,$3,$4,now())",
    [user, person.person, user + "@example.invalid", role],
  );
  await pool().query(
    "INSERT INTO public.app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
    [user, role],
  );
  for (const sector of sectors)
    await pool().query(
      "INSERT INTO public.app_admin_sector_members(user_id,sector_code,assigned_by) VALUES($1,$2,$1)",
      [user, sector],
    );
  return {
    userId: user,
    role,
    sectors,
    isSuperAdmin: role === "platform_super_admin",
    deniedSectors: [],
    sessionIssuedAt: new Date().toISOString(),
  } as AdminActorContext;
}
async function catalogFixture() {
  const user = await identity(),
    producer = randomUUID(),
    property = randomUUID(),
    review = randomUUID(),
    store = randomUUID(),
    category = randomUUID();
  await pool().query(
    "INSERT INTO public.app_user_role_assignments(user_id,role_code) VALUES($1,'producer')",
    [user.id],
  );
  await pool().query(
    "INSERT INTO public.app_producer_profiles(id,person_id,verification_status,trust_level) VALUES($1,$2,'verified',2)",
    [producer, user.person],
  );
  await pool().query(
    "INSERT INTO public.app_municipalities(ibge_code,name,name_normalized,state) VALUES('1100023','Ariquemes','ariquemes','RO') ON CONFLICT DO NOTHING",
  );
  await pool().query(
    `INSERT INTO public.app_properties(id,producer_id,property_name,municipality,state,line_vicinal,status,wizard_current_step,total_area_hectares,cultivated_area_hectares,rural_zone_sector,latitude_sede,longitude_sede,water_source,irrigation_system)
    VALUES($1,$2,'Chácara sintética operacional','Ariquemes','RO','Linha C-65','verified',6,10,4,'Gleba Jamari',-9.91,-63.04,'poco_artesiano','gotejamento')`,
    [property, producer],
  );
  await pool().query(
    "INSERT INTO public.app_verification_requests(id,property_id,producer_id,status,archived_at) VALUES($1,$2,$3,'approved',now())",
    [review, property, producer],
  );
  await pool().query(
    `INSERT INTO public.app_verification_decisions(request_id,auditor_id,decision,technical_opinion,assigned_trust_level,checklist_environmental_ok,checklist_land_tenure_ok,checklist_water_quality_ok)
    VALUES($1,$2,'approved','Homologação sintética exclusivamente local.',2,true,true,true)`,
    [review, user.id],
  );
  await pool().query(
    "INSERT INTO public.app_producer_stores(id,producer_profile_id,property_id,store_slug,store_name,bio_clean,status) VALUES($1,$2,$3,$4,'Loja Operações','Produção sintética exclusiva para testes locais.','active')",
    [store, producer, property, "ops-" + store],
  );
  await pool().query(
    "INSERT INTO public.app_categories(id,slug,name,icon_name) VALUES($1,$2,'Categoria Operações','leaf')",
    [category, "ops-" + category],
  );
  const products: string[] = [];
  for (let i = 0; i < 13; i++) {
    const id = randomUUID();
    products.push(id);
    await pool().query(
      `INSERT INTO public.app_products(id,store_id,category_id,title,description,packaging_type,net_weight_grams,unit_type,is_published,updated_at)
      VALUES($1,$2,$3,$4,'Produto sintético para testes de operações.','porcao_embalada',300,'un',$5,now()+$6::int*interval '1 second')`,
      [
        id,
        store,
        category,
        i === 0 ? "Produto literal %_" : "Produto Operações " + i,
        i < 11,
        i,
      ],
    );
    await pool().query(
      "INSERT INTO public.app_price_versions(product_id,price_cents,created_by_user_id,valid_from) VALUES($1,1200,$2,now()-interval '1 day'),($1,9900,$2,now()+interval '1 day')",
      [id, user.id],
    );
  }
  return { user, store, category, products };
}
async function payment(
  user: string,
  status: string,
  amount: number,
  at: string,
  hold?: { state: string; refund: number },
) {
  const pos = randomUUID(),
    id = randomUUID(),
    command = randomUUID();
  await pool().query(
    `INSERT INTO public.app_pos_sales(id,code,producer_user_id,store_snapshot,items_snapshot,total_cents,payment_method,payment_channel,policy_snapshot)
    VALUES($1,$2,$3,'{"name":"Loja sintética financeira"}','[{"title":"Produto sintético"}]',$4,'pix','system_pix','{}')`,
    [pos, pos.replaceAll("-", ""), user, amount],
  );
  await pool().query(
    "INSERT INTO public.app_command_receipts(command_id,user_id,endpoint,payload_hash,status_code,response_body) VALUES($1,$2,'operations.synthetic',$3,200,'{}')",
    [command, user, "a".repeat(64)],
  );
  await pool().query(
    `INSERT INTO public.app_payment_intents(id,command_id,pos_sale_id,user_id,method,status,amount_cents,created_at,expires_at)
    VALUES($1,$2,$3,$4,'pix',$5,$6,$7::timestamptz,$7::timestamptz+interval '15 minutes')`,
    [id, command, pos, user, status, amount, at],
  );
  if (hold) {
    const order = randomUUID();
    await pool().query(
      `INSERT INTO public.app_orders(id,payment_intent_id,customer_user_id,store_snapshot,source,items_snapshot,address_snapshot,subtotal_cents,delivery_fee_cents,total_cents,policy_snapshot,created_at)
      VALUES($1,$2,$3,'{"name":"Loja sintética financeira"}','pos','[{"title":"Produto sintético"}]','{"private":"endereço não deve sair"}',$4,0,$4,'{}',$5::timestamptz)`,
      [order, id, user, amount, at],
    );
    await pool().query(
      "INSERT INTO public.app_financial_holds(order_id,amount_cents,state,refunded_cents,release_after) VALUES($1,$2,$3,$4,now()+interval '7 days')",
      [order, amount, hold.state, hold.refund],
    );
  }
  return id;
}

describe.runIf(Boolean(process.env.HVM_OPERATIONS_LOCAL_DATABASE_URL))(
  "Departamentos financeiros e catálogo com SQL/autorizações reais no Postgres descartável",
  () => {
    beforeEach(async () => {
      await pool().query("BEGIN");
    });
    afterEach(async () => {
      await pool().query("ROLLBACK");
    });
    afterAll(async () => {
      await dbPool?.end();
    });
    it("executa pagamentos, pedidos, produtos, lojas e categorias contra schema real", async () => {
      const actor = await admin();
      for (const view of ["payments", "orders"] as const) {
        const result = await AdminOperationsService.finance(actor, { view });
        expect(result.view).toBe(view);
        expect(result.pagination.pageSize).toBe(20);
      }
      for (const view of ["products", "stores", "categories"] as const) {
        const result = await AdminOperationsService.catalog(actor, { view });
        expect(result.view).toBe(view);
        expect(result.pagination.pageSize).toBe(20);
      }
    });
    it("catálogo pagina e pesquisa literal, não expõe preço futuro, e reconsulta a visibilidade", async () => {
      const actor = await admin("platform_admin", ["catalog_moderation"]),
        fixture = await catalogFixture();
      const before = await AdminOperationsService.catalog(actor, {
        search: "Produto Operações",
        pageSize: 10,
      });
      expect(before.pagination.total).toBe(12);
      expect(before.products).toHaveLength(10);
      expect(before.products.every((item) => item.priceCents === 1200)).toBe(
        true,
      );
      const second = await AdminOperationsService.catalog(actor, {
        search: "Produto Operações",
        pageSize: 10,
        page: 2,
      });
      expect(second.products).toHaveLength(2);
      expect(
        second.products.some((item) =>
          before.products.some((other) => other.id === item.id),
        ),
      ).toBe(false);
      const literal = await AdminOperationsService.catalog(actor, {
        search: "%_",
      });
      expect(literal.products.map((item) => item.title)).toEqual([
        "Produto literal %_",
      ]);
      expect(before.products.some((item) => item.isVisible)).toBe(true);
      await pool().query(
        "UPDATE public.app_producer_stores SET status='paused' WHERE id=$1",
        [fixture.store],
      );
      const hidden = await AdminOperationsService.catalog(actor, {
        search: "Produto Operações",
        publication: "unavailable",
      });
      expect(hidden.pagination.total).toBe(10);
      expect(
        hidden.products.every((item) => !item.isVisible && item.isPublished),
      ).toBe(true);
      const stores = await AdminOperationsService.catalog(actor, {
        view: "stores",
        search: "Loja Operações",
      });
      expect(stores.stores[0]).toMatchObject({
        productCount: 13,
        publishedProductCount: 11,
        isVisible: false,
      });
      const categories = await AdminOperationsService.catalog(actor, {
        view: "categories",
        search: "Categoria Operações",
      });
      expect(categories.categories[0]).toMatchObject({
        productCount: 13,
        publishedProductCount: 11,
      });
    });
    it("financeiro aplica fronteira diária UTC-4, separa confirmados/retidos/liberados e desconta estornos", async () => {
      const actor = await admin("platform_admin", ["finance_ops"]),
        user = await identity();
      const filter = { from: "2026-02-13", to: "2026-02-13" };
      const before = await AdminOperationsService.finance(actor, filter);
      await payment(user.id, "approved", 99999, "2026-02-13T03:59:59Z"); // dia anterior em Cuiabá
      await payment(user.id, "approved", 5000, "2026-02-13T04:00:00Z", {
        state: "partially_refunded",
        refund: 1000,
      });
      await payment(user.id, "approved", 7000, "2026-02-14T03:59:59Z", {
        state: "released",
        refund: 2000,
      });
      await payment(user.id, "pending", 1000, "2026-02-13T12:00:00Z");
      await payment(user.id, "failed", 3000, "2026-02-13T12:10:00Z");
      await payment(user.id, "refunded", 4000, "2026-02-13T12:20:00Z", {
        state: "refunded",
        refund: 4000,
      });
      await payment(user.id, "approved", 88888, "2026-02-14T04:00:00Z"); // dia seguinte
      const result = await AdminOperationsService.finance(actor, filter);
      expect(result.metrics.approvedPayments).toBe(
        before.metrics.approvedPayments + 2,
      );
      expect(result.metrics.approvedAmountCents).toBe(
        before.metrics.approvedAmountCents + 12000,
      );
      expect(result.metrics.heldAmountCents).toBe(
        before.metrics.heldAmountCents + 4000,
      );
      expect(result.metrics.releasedAmountCents).toBe(
        before.metrics.releasedAmountCents + 5000,
      );
      const approved = await AdminOperationsService.finance(actor, {
        ...filter,
        paymentStatus: "approved",
      });
      expect(
        approved.payments.every((item) => item.status === "approved"),
      ).toBe(true);
      const orders = await AdminOperationsService.finance(actor, {
        ...filter,
        view: "orders",
        holdState: "partially_refunded",
      });
      expect(orders.orders).toHaveLength(1);
      expect(orders.orders[0]).toMatchObject({
        retainedCents: 4000,
        refundedCents: 1000,
        storeName: "Loja sintética financeira",
      });
      expect(JSON.stringify(orders)).not.toContain("endereço não deve sair");
      expect(JSON.stringify(result)).not.toContain(user.id);
    });
    it("poder revogado no banco impede dados mesmo com actor anterior e deny sobre super também vence", async () => {
      const delegate = await admin("platform_admin", ["finance_ops"]);
      await AdminOperationsService.finance(delegate);
      await pool().query(
        "UPDATE public.app_admin_sector_members SET revoked_at=now() WHERE user_id=$1 AND sector_code='finance_ops'",
        [delegate.userId],
      );
      await expect(
        AdminOperationsService.finance(delegate),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      const superAdmin = await admin();
      await pool().query(
        "INSERT INTO public.app_admin_permission_overrides(user_id,sector_code,allowed,changed_by) VALUES($1,'catalog_moderation',false,$1)",
        [superAdmin.userId],
      );
      await expect(
        AdminOperationsService.catalog(superAdmin),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    });
  },
);
