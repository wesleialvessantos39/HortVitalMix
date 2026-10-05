import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { ProducerStoreService } from "../../server/services/ProducerStoreService.ts";

export async function productFixture(
  pool: Pool,
  options: {
    active?: boolean;
    trust?: number;
    verification?: string;
    coordinates?: { latitude: number; longitude: number };
    municipality?: string;
  } = {},
) {
  const userId = randomUUID(),
    personId = randomUUID(),
    profileId = randomUUID(),
    propertyId = randomUUID(),
    requestId = randomUUID();
  const phone =
    "+5569" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0");
  await pool.query(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
    [userId, userId + "@example.test"],
  );
  await pool.query(
    "INSERT INTO public.app_people(id,user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,$6,$3,$4,$5)",
    [
      personId,
      userId,
      String(Math.floor(Math.random() * 1e11)).padStart(11, "0"),
      userId + "@example.test",
      phone,
      "Produtor local T14 " + personId,
    ],
  );
  await pool.query(
    "INSERT INTO public.app_user_role_assignments(user_id,role_code) VALUES($1,'producer')",
    [userId],
  );
  await pool.query(
    "INSERT INTO public.app_producer_profiles(id,person_id,verification_status,trust_level) VALUES($1,$2,'verified',2)",
    [profileId, personId],
  );
  await pool.query(
    `INSERT INTO public.app_properties(id,producer_id,property_name,municipality,state,line_vicinal,status,wizard_current_step,total_area_hectares,cultivated_area_hectares,rural_zone_sector,latitude_sede,longitude_sede,water_source,irrigation_system)
   VALUES($1,$2,'Chácara local T14',$5,'RO','Linha C-65','verified',6,10,4,'Gleba Jamari',$3,$4,'poco_artesiano','gotejamento')`,
    [
      propertyId,
      profileId,
      options.coordinates?.latitude ?? -9.91,
      options.coordinates?.longitude ?? -63.04,
      options.municipality ?? "Ariquemes",
    ],
  );
  await pool.query(
    "INSERT INTO public.app_verification_requests(id,property_id,producer_id,status,archived_at) VALUES($1,$2,$3,'approved',now())",
    [requestId, propertyId, profileId],
  );
  await pool.query(
    `INSERT INTO public.app_verification_decisions(request_id,auditor_id,decision,technical_opinion,assigned_trust_level,checklist_environmental_ok,checklist_land_tenure_ok,checklist_water_quality_ok)
   VALUES($1,$2,'approved','Homologação sintética exclusivamente local T14.',2,true,true,true)`,
    [requestId, userId],
  );
  await pool.query(
    "INSERT INTO public.app_municipalities(ibge_code,name,name_normalized,state) VALUES('1100023','Ariquemes','ariquemes','RO') ON CONFLICT DO NOTHING",
  );
  const context = { requestId: randomUUID(), ipHash: "a".repeat(64) };
  const draft = await ProducerStoreService.getOrCreateDraftStore(
    userId,
    randomUUID(),
    context,
  );
  let store = await ProducerStoreService.saveStoreSettings(
    draft.id,
    userId,
    {
      commandId: randomUUID(),
      expectedRevision: draft.revision,
      propertyId,
      storeName: "Chácara local T14",
      storeSlug: "t14-" + randomUUID(),
      bio: "Produção local para testes descartáveis da Trilha 14.",
      minOrderAmountCents: 2000,
      cutoffHour: "14:00",
    },
    context,
  );
  if (options.active !== false)
    store = await ProducerStoreService.publishStore(
      store.id,
      userId,
      { commandId: randomUUID(), expectedRevision: store.revision },
      context,
    );
  if (options.trust !== undefined || options.verification !== undefined)
    await pool.query(
      "UPDATE public.app_producer_profiles SET trust_level=$2,verification_status=$3 WHERE id=$1",
      [profileId, options.trust ?? 2, options.verification ?? "verified"],
    );
  return { userId, personId, profileId, propertyId, requestId, store };
}
