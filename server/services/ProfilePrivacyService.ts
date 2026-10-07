import { PortalRoleSchema } from "../../shared/contracts/auth.ts";
import { ACCOUNT_PERSON_SCOPE } from "./accountPersonScope.ts";
import type { PoolClient } from "pg";
import { dbPool } from "../db/pool.ts";
import { redactPII } from "../security/redactPII.ts";
import { AddressManagementService } from "./AddressManagementService.ts";
export { AddressManagementService };
// Gerenciamento de endereços e atribuição de replacementDefaultId unificados
import type {
  ConsentView,
  PreferencesView,
  ProfileView,
  UpdatePreferencesInput,
  UpdateProfileInput,
} from "../../shared/contracts/profilePrivacy.ts";

const POLICY_VERSION = "privacy-2026-09-22";

export class ProfilePrivacyError extends Error {
  constructor(
    public code: string,
    public status: number,
    message = code,
  ) {
    super(message);
    this.name = "ProfilePrivacyError";
  }
}

function requirePool() {
  if (!dbPool) throw new ProfilePrivacyError("DATABASE_UNAVAILABLE", 503);
  return dbPool;
}

function maskCpf(cpf: string) {
  const digits = cpf.replace(/\D/g, "");
  return digits.length === 11
    ? "***.***." + digits.slice(6, 9) + "-" + digits.slice(9)
    : "***.***.***-**";
}

async function getPersonId(client: PoolClient, userId: string, lock = false) {
  const sql =
    "SELECT id FROM public.app_people WHERE " +
    ACCOUNT_PERSON_SCOPE +
    (lock ? " FOR UPDATE" : "");
  const result = await client.query<{ id: string }>(sql, [userId]);
  if (!result.rows[0]) throw new ProfilePrivacyError("PERSON_NOT_FOUND", 404);
  return result.rows[0].id;
}

async function findReplayTarget(
  client: PoolClient,
  commandId: string,
  userId: string,
  action: string,
) {
  const result = await client.query<{ target_id: string | null }>(
    "SELECT target_id FROM public.app_audit_events WHERE command_id=$1 AND actor_id=$2 AND action=$3 LIMIT 1",
    [commandId, userId, action],
  );
  return result.rows[0]?.target_id ?? null;
}

async function writeAudit(
  client: PoolClient,
  args: {
    requestId: string;
    userId: string;
    role: string;
    action: string;
    entity: string;
    targetId: string | null;
    before?: unknown;
    after?: unknown;
    ipHash: string;
    commandId: string;
  },
) {
  await client.query(
    [
      "INSERT INTO public.app_audit_events",
      "(request_id,actor_id,actor_role,action,target_entity,target_id,",
      "payload_before,payload_after,client_ip_hash,command_id)",
      "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    ].join(" "),
    [
      args.requestId,
      args.userId,
      args.role,
      args.action,
      args.entity,
      args.targetId,
      args.before ? JSON.stringify(redactPII(args.before)) : null,
      args.after ? JSON.stringify(redactPII(args.after)) : null,
      args.ipHash,
      args.commandId,
    ],
  );
}

export class ProfilePrivacyService {
  static async getProfile(
    userId: string,
    role = "consumer",
  ): Promise<ProfileView> {
    const result = await requirePool().query<{
      full_name: string;
      cpf_normalized: string;
      email_normalized: string;
      phone_e164: string;
      revision: number;
    }>(
      `SELECT ap.full_name,ap.cpf_normalized,ap.email_normalized,ap.phone_e164,ap.revision
       FROM public.app_account_profiles ap JOIN public.app_user_role_assignments ra ON ra.user_id=ap.user_id AND ra.role_code=ap.role_code
       WHERE ap.user_id=$1 AND ap.role_code=$2 AND ra.revoked_at IS NULL AND (ra.expires_at IS NULL OR ra.expires_at>now())`,
      [userId, role],
    );
    const row = result.rows[0];
    if (!row) throw new ProfilePrivacyError("PERSON_NOT_FOUND", 404);
    return {
      fullName: row.full_name,
      profileRole: PortalRoleSchema.parse(role),
      cpfMasked: maskCpf(row.cpf_normalized),
      email: row.email_normalized,
      phone: row.phone_e164,
      revision: row.revision,
    };
  }

  static async updateProfile(
    userId: string,
    role: string,
    input: UpdateProfileInput,
    requestId: string,
    ipHash: string,
  ) {
    if(input.profileRole && input.profileRole!==role) throw new ProfilePrivacyError("PROFILE_SCOPE_CHANGED",409);
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const current = (
        await client.query<{ id: string; full_name: string; revision: number }>(
          `SELECT ap.id,ap.full_name,ap.revision FROM public.app_account_profiles ap
         JOIN public.app_user_role_assignments ra ON ra.user_id=ap.user_id AND ra.role_code=ap.role_code
         WHERE ap.user_id=$1 AND ap.role_code=$2 AND ra.revoked_at IS NULL AND (ra.expires_at IS NULL OR ra.expires_at>now()) FOR UPDATE OF ap`,
          [userId, role],
        )
      ).rows[0];
      if (!current) throw new ProfilePrivacyError("PROFILE_NOT_FOUND", 404);
      const personId = current.id;
      const replay = await findReplayTarget(
        client,
        input.commandId,
        userId,
        "profile.updated",
      );
      if (replay && replay !== personId)
        throw new ProfilePrivacyError("COMMAND_SCOPE_MISMATCH", 409);
      if (replay) {
        await client.query("COMMIT");
        return { status: "idempotent_replay" as const };
      }
      if (current.revision !== input.expectedRevision) {
        await client.query("ROLLBACK");
        return {
          status: "conflict" as const,
          currentRevision: current.revision,
        };
      }
      await client.query(
        "UPDATE public.app_account_profiles SET full_name=$1,revision=revision+1,updated_at=clock_timestamp() WHERE id=$2",
        [input.fullName, personId],
      );
      await writeAudit(client, {
        requestId,
        userId,
        role,
        action: "profile.updated",
        entity: "app_account_profiles",
        targetId: personId,
        before: { changedFields: ["fullName"], revision: current.revision },
        after: { changedFields: ["fullName"], revision: current.revision + 1 },
        ipHash,
        commandId: input.commandId,
      });
      await client.query("COMMIT");
      return { status: "updated" as const, revision: current.revision + 1 };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  static async getPreferences(
    userId: string,
    completeHistory = false,
  ): Promise<{ preferences: PreferencesView; consents: ConsentView[] }> {
    const pool = requirePool();
    const person = await pool.query<{ id: string }>(
      "SELECT id FROM public.app_people WHERE " + ACCOUNT_PERSON_SCOPE,
      [userId],
    );
    if (!person.rows[0]) throw new ProfilePrivacyError("PERSON_NOT_FOUND", 404);
    const personId = person.rows[0].id;
    const [preferencesResult, consentsResult] = await Promise.all([
      pool.query<Record<string, any>>(
        "SELECT * FROM public.app_user_preferences WHERE person_id=$1",
        [personId],
      ),
      pool.query<Record<string, any>>(
        "SELECT id,consent_type,is_granted,policy_version,registered_at FROM public.app_consent_records WHERE person_id=$1 ORDER BY registered_at DESC,id DESC" +
          (completeHistory ? "" : " LIMIT 100"),
        [personId],
      ),
    ]);
    const row = preferencesResult.rows[0];
    const preferences: PreferencesView = row
      ? {
          marketingConsent: row.marketing_consent,
          orderUpdatesChannel: row.order_updates_channel,
          quietHoursEnabled: row.quiet_hours_enabled,
          quietHoursStart:
            typeof row.quiet_hours_start === "string"
              ? row.quiet_hours_start.slice(0, 5)
              : null,
          quietHoursEnd:
            typeof row.quiet_hours_end === "string"
              ? row.quiet_hours_end.slice(0, 5)
              : null,
          revision: row.revision,
        }
      : {
          marketingConsent: false,
          orderUpdatesChannel: "both",
          quietHoursEnabled: false,
          quietHoursStart: null,
          quietHoursEnd: null,
          revision: 1,
        };

    return {
      preferences,
      consents: consentsResult.rows.map((consent) => ({
        id: consent.id,
        consentType: consent.consent_type,
        isGranted: consent.is_granted,
        policyVersion: consent.policy_version,
        registeredAt: new Date(consent.registered_at).toISOString(),
      })),
    };
  }

  static async updatePreferences(
    userId: string,
    role: string,
    input: UpdatePreferencesInput,
    requestId: string,
    ipHash: string,
    userAgent: string,
  ) {
    const client = await requirePool().connect();
    try {
      await client.query("BEGIN");
      const personId = await getPersonId(client, userId, true);
      if (
        await findReplayTarget(
          client,
          input.commandId,
          userId,
          "preferences.updated",
        )
      ) {
        await client.query("COMMIT");
        return { status: "idempotent_replay" as const };
      }

      let current = (
        await client.query<Record<string, any>>(
          "SELECT * FROM public.app_user_preferences WHERE person_id=$1 FOR UPDATE",
          [personId],
        )
      ).rows[0];
      if (!current) {
        await client.query(
          "INSERT INTO public.app_user_preferences(person_id) VALUES($1)",
          [personId],
        );
        current = (
          await client.query<Record<string, any>>(
            "SELECT * FROM public.app_user_preferences WHERE person_id=$1 FOR UPDATE",
            [personId],
          )
        ).rows[0];
      }

      if (current.revision !== input.expectedRevision) {
        await client.query("ROLLBACK");
        return {
          status: "conflict" as const,
          currentRevision: current.revision,
        };
      }

      const next = {
        marketingConsent: input.marketingConsent ?? current.marketing_consent,
        orderUpdatesChannel:
          input.orderUpdatesChannel ?? current.order_updates_channel,
        quietHoursEnabled:
          input.quietHoursEnabled ?? current.quiet_hours_enabled,
        quietHoursStart:
          input.quietHoursEnabled === false
            ? null
            : (input.quietHoursStart ?? current.quiet_hours_start),
        quietHoursEnd:
          input.quietHoursEnabled === false
            ? null
            : (input.quietHoursEnd ?? current.quiet_hours_end),
      };

      await client.query(
        [
          "UPDATE public.app_user_preferences SET",
          "marketing_consent=$1,order_updates_channel=$2,quiet_hours_enabled=$3,",
          "quiet_hours_start=$4,quiet_hours_end=$5 WHERE person_id=$6",
        ].join(" "),
        [
          next.marketingConsent,
          next.orderUpdatesChannel,
          next.quietHoursEnabled,
          next.quietHoursStart,
          next.quietHoursEnd,
          personId,
        ],
      );

      if (next.marketingConsent !== current.marketing_consent) {
        await client.query(
          [
            "INSERT INTO public.app_consent_records",
            "(person_id,consent_type,is_granted,policy_version,ip_hash,user_agent)",
            "VALUES($1,'marketing',$2,$3,$4,$5)",
          ].join(" "),
          [
            personId,
            next.marketingConsent,
            POLICY_VERSION,
            ipHash,
            userAgent.slice(0, 255) || "unknown",
          ],
        );
      }

      await writeAudit(client, {
        requestId,
        userId,
        role,
        action: "preferences.updated",
        entity: "app_user_preferences",
        targetId: personId,
        before: {
          marketingConsent: current.marketing_consent,
          orderUpdatesChannel: current.order_updates_channel,
          quietHoursEnabled: current.quiet_hours_enabled,
        },
        after: next,
        ipHash,
        commandId: input.commandId,
      });
      await client.query("COMMIT");
      return {
        status: "updated" as const,
        revision: current.revision + 1,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  static async exportData(userId: string, role = "consumer") {
    const profile = await this.getProfile(userId, role);
    const [addresses, data] = await Promise.all([
      AddressManagementService.listAddresses(userId, { includeInactive: true }),
      this.getPreferences(userId, true),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      profile,
      addresses,
      preferences: data.preferences,
      consents: data.consents,
    };
  }
}
