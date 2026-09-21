import { randomBytes, randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../../server/supabase/client";
import { dbPool } from "../../server/db/pool";
import { runtime } from "../../server/config/runtime";

export interface TestIdentity {
  userId: string;
  email: string;
  password: string;
  accessToken: string;
  personId: string | null;
  cleanup: () => Promise<void>;
}

function randomSuffix(): string {
  return randomBytes(6).toString("hex");
}

function cpfDigit(base: string): number {
  const size = base.length;
  let sum = 0;
  for (let i = 0; i < size; i++) sum += Number(base[i]) * (size + 1 - i);
  const rest = (sum * 10) % 11;
  return rest === 10 ? 0 : rest;
}

export function generateValidCPF(): string {
  let base = "";
  do {
    base = Array.from({ length: 9 }, () => String(randomInt(0, 10))).join("");
  } while (/^(\d)\1{8}$/.test(base));
  const d1 = cpfDigit(base);
  const d2 = cpfDigit(base + String(d1));
  return base + String(d1) + String(d2);
}

export function generateValidE164(): string {
  return "+5569" + String(randomInt(900000000, 999999999));
}

export async function createEphemeralIdentity(options?: {
  role?: "consumer" | "producer";
  withPerson?: boolean;
}): Promise<TestIdentity> {
  if (!supabaseAdmin || !dbPool)
    throw new Error("createEphemeralIdentity: runtime Supabase indisponível");

  const suffix = randomSuffix();
  const email = `test-${suffix}@hvm-test.local`;
  const password = `TestP@ssw0rd-${suffix}!`;

  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { source: "vitest" },
  });
  if (created.error || !created.data.user)
    throw new Error("Falha ao criar identidade efêmera.");

  const userId = created.data.user.id;
  const signedIn = await supabaseAdmin.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session) {
    await supabaseAdmin.auth.admin.deleteUser(userId);
    throw new Error("Falha ao autenticar identidade efêmera.");
  }

  let personId: string | null = null;
  try {
    if (options?.withPerson !== false) {
      const person = await dbPool.query<{ id: string }>(
        `INSERT INTO public.app_people
          (user_id,full_name,cpf_normalized,email_normalized,phone_e164)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id`,
        [userId, `Test User ${suffix}`, generateValidCPF(), email, generateValidE164()],
      );
      personId = person.rows[0].id;

      if (options?.role) {
        await dbPool.query(
          "INSERT INTO public.app_user_role_assignments(user_id,role_code) VALUES($1,$2)",
          [userId, options.role],
        );
      }
    }
  } catch (error) {
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
    await dbPool.query("DELETE FROM public.app_users WHERE id=$1", [userId]).catch(() => undefined);
    throw error;
  }

  return {
    userId,
    email,
    password,
    accessToken: signedIn.data.session.access_token,
    personId,
    cleanup: async () => {
      if (personId) {
        await dbPool
          .query("DELETE FROM public.app_producer_profiles WHERE person_id=$1", [personId])
          .catch(() => undefined);
      }
      await dbPool
        .query("DELETE FROM public.app_user_role_assignments WHERE user_id=$1", [userId])
        .catch(() => undefined);
      await dbPool
        .query("DELETE FROM public.app_people WHERE user_id=$1", [userId])
        .catch(() => undefined);
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
      await dbPool
        .query("DELETE FROM public.app_users WHERE id=$1", [userId])
        .catch(() => undefined);
    },
  };
}

export function asIdentity(identity: TestIdentity) {
  return createClient(runtime.supabaseUrl, runtime.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${identity.accessToken}` },
    },
  });
}
