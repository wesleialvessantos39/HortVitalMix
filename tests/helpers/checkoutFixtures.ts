import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { productFixture } from "./productFixtures.ts";
import { CartService } from "../../server/services/CartService.ts";
import { DeliveryQuoteService } from "../../server/services/DeliveryQuoteService.ts";
import { InventoryService } from "../../server/services/InventoryService.ts";

export const checkoutAudit = () => ({
  requestId: randomUUID(),
  ipHash: "a".repeat(64),
});
export async function checkoutCatalog(pool: Pool) {
  const a = await productFixture(pool),
    b = await productFixture(pool),
    categoryId = randomUUID();
  await pool.query(
    "INSERT INTO app_categories(id,name,slug,icon_name) VALUES($1,'Alimentos de teste T19',$2,'leaf')",
    [categoryId, "t19-" + categoryId],
  );
  async function product(
    owner: typeof a,
    title: string,
    price: number,
    stock: number,
  ) {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO app_products(id,store_id,category_id,title,description,packaging_type,net_weight_grams,unit_type)
      VALUES($1,$2,$3,$4,'Alimento sintético exclusivo de banco descartável.','porcao_embalada',300,'un')`,
      [id, owner.store.id, categoryId, title],
    );
    await pool.query(
      "INSERT INTO app_price_versions(product_id,price_cents,created_by_user_id) VALUES($1,$2,$3)",
      [id, price, owner.userId],
    );
    await pool.query(
      "INSERT INTO app_product_media(product_id,media_url,is_primary) VALUES($1,$2,true)",
      [
        id,
        `https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/product-media/${owner.store.id}/${id}/${randomUUID()}-${"a".repeat(64)}.webp`,
      ],
    );
    await pool.query("UPDATE app_products SET is_published=true WHERE id=$1", [
      id,
    ]);
    const dates = (
      await pool.query<{ today: string; expires: string }>(
        "SELECT CURRENT_DATE::text AS today,(CURRENT_DATE+5)::text AS expires",
      )
    ).rows[0];
    if (stock > 0)
      await InventoryService.registerHarvest(
        id,
        owner.personId,
        {
          commandId: randomUUID(),
          lotCode: "T19-" + randomUUID(),
          harvestDate: dates.today,
          expirationDate: dates.expires,
          quantity: stock,
        },
        owner.userId,
        checkoutAudit(),
      );
    return id;
  }
  for (const f of [a, b])
    await DeliveryQuoteService.saveOwnerSettings(
      f.personId,
      f.userId,
      {
        commandId: randomUUID(),
        expectedRevision: 0,
        radiusKm: 50,
        isActive: true,
        rules: {
          baseFeeCents: 500,
          feePerKmCents: 100,
          minOrderCents: 1000,
          freeDeliveryThresholdCents: null,
          estimatedPrepHours: 4,
        },
      },
      checkoutAudit(),
    );
  const pa = await product(a, "Cenoura T19", 700, 100),
    pb = await product(b, "Couve T19", 900, 100),
    low = await product(b, "Porção limitada T19", 900, 1),
    scarce = await product(b, "Porção disputada T19", 1200, 2),
    zero = await product(b, "Porção sem estoque T19", 700, 0),
    expired = await product(b, "Porção vencida T19", 700, 0);
  const past = (
    await pool.query(
      "SELECT (CURRENT_DATE-3)::text harvest,(CURRENT_DATE-1)::text expiry",
    )
  ).rows[0];
  await InventoryService.registerHarvest(
    expired,
    b.personId,
    {
      commandId: randomUUID(),
      lotCode: "T19-EXPIRED",
      harvestDate: past.harvest,
      expirationDate: past.expiry,
      quantity: 5,
    },
    b.userId,
    checkoutAudit(),
  );
  return {
    a,
    b,
    categoryId,
    pa,
    pb,
    low,
    scarce,
    zero,
    expired,
    async cleanup() {
      for (const f of [a, b])
        await pool.query("DELETE FROM auth.users WHERE id=$1", [f.userId]);
      await pool.query("DELETE FROM app_categories WHERE id=$1", [categoryId]);
    },
  };
}
export async function checkoutBuyer(
  pool: Pool,
  products: string[],
  quantity = 2,
) {
  const userId = randomUUID(),
    personId = randomUUID(),
    addressId = randomUUID(),
    sessionId = randomUUID();
  await pool.query(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
    [userId, userId + "@example.test"],
  );
  await pool.query(
    "INSERT INTO app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,'Consumidor sintético T19',$3,$4,$5)",
    [
      personId,
      userId,
      String(Math.floor(Math.random() * 1e11)).padStart(11, "0"),
      userId + "@example.test",
      "+5569" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"),
    ],
  );
  await pool.query(
    "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'consumer')",
    [userId],
  );
  await pool.query(
    `INSERT INTO app_user_addresses(id,person_id,label,cep,street,number,neighborhood,city,state,latitude,longitude,geocoding_accuracy,is_default)
    VALUES($1,$2,'Casa','76870000','Rua Sintética T19','10','Centro','Ariquemes','RO',-9.911,-63.041,'manual',true)`,
    [addressId, personId],
  );
  // Emulate the existing registration approval only in the disposable database.
  await pool.query("UPDATE app_users SET status='active' WHERE id=$1", [
    userId,
  ]);
  const cart = await CartService.getOrCreateCart(sessionId, userId);
  for (const productId of products)
    await CartService.addItem(
      { sessionId, userId },
      { productId, quantity, commandId: randomUUID() },
      checkoutAudit(),
    );
  return {
    userId,
    personId,
    addressId,
    sessionId,
    cartId: cart.id,
    async cleanup() {
      await pool.query("DELETE FROM auth.users WHERE id=$1", [userId]);
    },
  };
}
