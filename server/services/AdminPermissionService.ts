import type { PoolClient } from "pg";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import {
  UpdateAdminPermissionsSchema,
  type AdminPermissionsView,
  type AdminSectorCode,
} from "../../shared/contracts/adminGovernance.ts";
import {
  commerceAdmin,
  commerceAudit,
  commerceCommand,
  commerceTransaction,
  CommerceError,
  type CommerceAudit,
} from "./CommerceSupport.ts";

async function authorize(c: PoolClient, actor: AdminActorContext) {
  if (actor.role !== "platform_super_admin")
    throw new CommerceError("FORBIDDEN", 403);
  await commerceAdmin(c, actor, "account_governance");
}

async function view(
  c: PoolClient,
  userId: string,
  lock = false,
): Promise<AdminPermissionsView> {
  const target = (
    await c.query(
      `SELECT u.id,u.authorization_revision,ap.portal_role,coalesce(p.full_name,pe.full_name) AS full_name
     FROM public.app_users u JOIN public.app_admin_principals ap ON ap.admin_user_id=u.id
     JOIN public.app_people pe ON pe.id=ap.person_id
     LEFT JOIN public.app_account_profiles p ON p.user_id=u.id AND p.role_code=ap.portal_role
     WHERE u.id=$1 ${lock ? "FOR UPDATE OF u" : ""}`,
      [userId],
    )
  ).rows[0];
  if (!target) throw new CommerceError("ADMIN_ACCOUNT_NOT_FOUND", 404);
  const sectors = (
    await c.query<{ code: AdminSectorCode }>(
      `SELECT s.code FROM public.app_admin_sectors s WHERE s.is_active
     AND NOT EXISTS(SELECT 1 FROM public.app_admin_permission_overrides o WHERE o.user_id=$1 AND o.sector_code=s.code AND NOT o.allowed)
     AND ($2='platform_super_admin' OR EXISTS(SELECT 1 FROM public.app_admin_sector_members m
       WHERE m.user_id=$1 AND m.sector_code=s.code AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>now()))) ORDER BY s.code`,
      [userId, target.portal_role],
    )
  ).rows.map((row) => row.code);
  return {
    userId,
    role: target.portal_role,
    fullName: target.full_name,
    sectors,
    revision: target.authorization_revision,
  };
}

export const AdminPermissionService = {
  async get(userId: string, actor: AdminActorContext) {
    return commerceTransaction(async (c) => {
      await authorize(c, actor);
      return view(c, userId);
    });
  },
  async update(
    userId: string,
    actor: AdminActorContext,
    raw: unknown,
    context: CommerceAudit,
  ) {
    const input = UpdateAdminPermissionsSchema.parse(raw);
    input.sectors.sort();
    return commerceTransaction(async (c) => {
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtext('hvm-account-blocks'))",
      );
      await authorize(c, actor);
      return commerceCommand(
        c,
        actor.userId,
        input.commandId,
        "admin.permissions",
        { userId, ...input },
        async () => {
          const before = await view(c, userId, true);
          if (before.revision !== input.expectedRevision)
            throw new CommerceError("AUTHORIZATION_CONFLICT", 409);
          if (
            before.role === "platform_super_admin" &&
            !input.sectors.includes("account_governance")
          ) {
            if (userId === actor.userId)
              throw new CommerceError("SELF_GOVERNANCE_PROTECTED", 409);
            const other = await c.query(
              `SELECT 1 FROM public.app_admin_principals ap JOIN public.app_users u ON u.id=ap.admin_user_id
             JOIN public.app_user_role_assignments r ON r.user_id=u.id AND r.role_code='platform_super_admin'
             WHERE u.id<>$1 AND ap.portal_role='platform_super_admin' AND u.status='active'
             AND r.revoked_at IS NULL AND r.expires_at IS NULL
             AND hvm_governance_private.has_permission(u.id,'account_governance') LIMIT 1`,
              [userId],
            );
            if (!other.rowCount)
              throw new CommerceError("LAST_SUPER_ADMIN_PROTECTED", 409);
          }
          const valid = (
            await c.query<{ code: AdminSectorCode }>(
              "SELECT code FROM public.app_admin_sectors WHERE is_active ORDER BY code",
            )
          ).rows.map((row) => row.code);
          if (input.sectors.some((code) => !valid.includes(code)))
            throw new CommerceError("INVALID_SECTOR", 422);
          if (before.role === "platform_super_admin") {
            for (const code of valid)
              await c.query(
                `INSERT INTO public.app_admin_permission_overrides(user_id,sector_code,allowed,changed_by)
             VALUES($1,$2,$3,$4) ON CONFLICT(user_id,sector_code) DO UPDATE
             SET allowed=excluded.allowed,changed_by=excluded.changed_by,updated_at=clock_timestamp()`,
                [userId, code, input.sectors.includes(code), actor.userId],
              );
          } else {
            await c.query(
              `UPDATE public.app_admin_sector_members SET revoked_at=clock_timestamp(),revoked_by=$2,revoke_reason='permissions_updated',authorization_version=authorization_version+1
            WHERE user_id=$1 AND revoked_at IS NULL AND NOT(sector_code=ANY($3::varchar[]))`,
              [userId, actor.userId, input.sectors],
            );
            for (const code of input.sectors)
              await c.query(
                `INSERT INTO public.app_admin_sector_members(user_id,sector_code,assigned_by) VALUES($1,$2,$3)
             ON CONFLICT(user_id,sector_code) DO UPDATE SET revoked_at=NULL,revoked_by=NULL,revoke_reason=NULL,expires_at=NULL,
             assigned_by=excluded.assigned_by,assigned_at=clock_timestamp(),authorization_version=public.app_admin_sector_members.authorization_version+1`,
                [userId, code, actor.userId],
              );
          }
          await c.query(
            "UPDATE public.app_users SET authorization_revision=authorization_revision+1,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
            [userId],
          );
          const after = await view(c, userId);
          await commerceAudit(
            c,
            actor.userId,
            actor.role,
            "admin.permissions_changed",
            "app_users",
            userId,
            {
              role: before.role,
              before: before.sectors,
              after: after.sectors,
              revision: after.revision,
            },
            context,
            input.commandId,
          );
          await c.query(
            `SELECT hvm_notifications_private.emit($1,$2,$3,'account','Seus poderes foram atualizados',
          'Um Super administrador alterou seus poderes. Os acessos disponíveis refletem as permissões atuais.','/admin/conta',NULL)`,
            [userId, before.role, "admin-powers:" + input.commandId],
          );
          return after;
        },
      );
    });
  },
};
