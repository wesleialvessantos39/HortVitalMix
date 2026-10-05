import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { productFixture } from "./productFixtures.ts";
import { DeliveryQuoteService } from "../../server/services/DeliveryQuoteService.ts";
import type { SaveDeliverySettings } from "../../shared/contracts/delivery.ts";
export const deliveryCommand = (
  extra: Partial<SaveDeliverySettings> = {},
): SaveDeliverySettings => ({
  commandId: randomUUID(),
  expectedRevision: 0,
  radiusKm: 15,
  isActive: true,
  rules: {
    baseFeeCents: 500,
    feePerKmCents: 100,
    minOrderCents: 2000,
    freeDeliveryThresholdCents: null,
    estimatedPrepHours: 4,
  },
  ...extra,
});
export const deliveryAudit = () => ({
  requestId: randomUUID(),
  ipHash: "d".repeat(64),
});
export async function deliveryAddress(
  pool: Pool,
  personId: string,
  latitude: number | null = -9.95,
  longitude: number | null = -63.04,
) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO app_user_addresses(id,person_id,label,cep,street,number,neighborhood,city,state,fingerprint_sha256,latitude,longitude)
    VALUES($1,$2,'Casa','76870000','Rua de teste',$6,'Centro','Ariquemes','RO',$3,$4,$5)`,
    [
      id,
      personId,
      createHash("sha256").update(id).digest("hex"),
      latitude,
      longitude,
      id.slice(0, 8),
    ],
  );
  return id;
}
export async function deliveryFixture(pool: Pool, configure = true) {
  const value = await productFixture(pool);
  const addressId = await deliveryAddress(pool, value.personId);
  if (configure)
    await DeliveryQuoteService.saveOwnerSettings(
      value.personId,
      value.userId,
      deliveryCommand(),
      deliveryAudit(),
    );
  return { ...value, addressId };
}
