import { z } from "zod";
import type { PoolClient } from "pg";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import {
  NotificationListQuerySchema,
  NotificationListSchema,
  NotificationDetailSchema,
  NotificationSchema,
  NotificationCategorySchema,
  ReadNotificationsSchema,
} from "../../shared/contracts/notification.ts";
import type { AdminSectorCode } from "../../shared/contracts/adminGovernance.ts";
import {
  ADMIN_NOTIFICATION_CATEGORIES,
  PUBLIC_NOTIFICATION_CATEGORIES,
  explainNotification,
  notificationDestination,
} from "./NotificationPresentation.ts";

// The same database mapping protects backend APIs and direct authenticated RLS
// reads, including historical broadcasts which omitted required_sector.
const effectiveAdminSector =
  "hvm_notifications_private.origin_sector(required_sector,recipient_role,action_path)";
import {
  commerceTransaction,
  commerceIdentity,
  CommerceError,
} from "./CommerceSupport.ts";
export type NotificationActor =
  | { userId: string; role: "consumer" | "producer" }
  | {
      userId: string;
      role: "platform_admin" | "platform_super_admin";
      admin: AdminActorContext;
    };
type NotificationRow = {
  id: string;
  category: string;
  title: string;
  message: string;
  action_path: string;
  created_at: Date;
  read_at: Date | null;
};
function serialize(row: NotificationRow) {
  return NotificationSchema.parse({
    id: row.id,
    category: row.category,
    title: row.title,
    message: row.message,
    actionPath: row.action_path,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null,
  });
}
async function availableCategories(c: PoolClient, actor: NotificationActor) {
  if (actor.role === "consumer" || actor.role === "producer")
    return PUBLIC_NOTIFICATION_CATEGORIES[actor.role];
  const sectors = (
    await c.query<{ code: AdminSectorCode }>(
      "SELECT code FROM public.app_admin_sectors WHERE is_active AND hvm_governance_private.has_permission($1,code)",
      [actor.userId],
    )
  ).rows;
  const categories = new Set(["account", "administration"]);
  for (const { code } of sectors)
    for (const category of ADMIN_NOTIFICATION_CATEGORIES[code] ?? [])
      categories.add(category);
  return NotificationCategorySchema.options.filter((category) =>
    categories.has(category),
  );
}
async function scope(c: PoolClient, actor: NotificationActor) {
  if (actor.role === "consumer" || actor.role === "producer")
    await commerceIdentity(c, actor.userId, actor.role);
  else {
    const row = (
      await c.query(
        `SELECT 1 FROM public.app_admin_principals p JOIN public.app_users u ON u.id=p.admin_user_id
   JOIN public.app_user_role_assignments r ON r.user_id=u.id AND r.role_code=p.portal_role
   WHERE u.id=$1 AND p.portal_role=$2 AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
   AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>clock_timestamp())
   AND (p.portal_role='platform_super_admin' OR EXISTS(SELECT 1 FROM public.app_admin_sector_members m JOIN public.app_admin_sectors s ON s.code=m.sector_code AND s.is_active WHERE m.user_id=u.id AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()))) FOR SHARE OF u`,
        [actor.userId, actor.role],
      )
    ).rowCount;
    if (!row) throw new CommerceError("FORBIDDEN", 403);
  }
  const sector =
    actor.role === "consumer" || actor.role === "producer"
      ? "required_sector"
      : effectiveAdminSector;
  return `recipient_user_id=$1 AND recipient_role=$2 AND (${sector} IS NULL OR hvm_governance_private.has_permission($1,${sector}))`;
}
export const NotificationService = {
  async detail(actor: NotificationActor, id: string) {
    z.uuid().parse(id);
    return commerceTransaction(async (c) => {
      const owner = await scope(c, actor);
      const row = (
        await c.query<NotificationRow>(
          `SELECT id,category,title,message,action_path,created_at,read_at FROM public.app_notifications WHERE ${owner} AND id=$3`,
          [actor.userId, actor.role, id],
        )
      ).rows[0];
      if (!row) throw new CommerceError("NOTIFICATION_NOT_FOUND", 404);
      const notification = serialize(row);
      const destination = notificationDestination(
        notification.actionPath,
        actor.role,
      );
      let allowed = destination !== null;
      if (destination?.sector) {
        allowed = (
          await c.query<{ allowed: boolean }>(
            "SELECT hvm_governance_private.has_permission($1,$2) AS allowed",
            [actor.userId, destination.sector],
          )
        ).rows[0].allowed;
      }
      return NotificationDetailSchema.parse(
        explainNotification(
          notification,
          actor.role,
          allowed && destination
            ? { label: destination.label, path: notification.actionPath }
            : null,
        ),
      );
    });
  },
  async list(actor: NotificationActor, input: unknown) {
    const q = NotificationListQuerySchema.parse(input);
    return commerceTransaction(async (c) => {
      const owner = await scope(c, actor),
        args: unknown[] = [actor.userId, actor.role];
      const asOf = (
        await c.query("SELECT clock_timestamp() AS now")
      ).rows[0].now.toISOString();
      const observed = owner + ` AND created_at<=$${args.push(asOf)}`;
      const unread = (
        await c.query(
          `SELECT count(*)::int AS n FROM public.app_notifications WHERE ${observed} AND read_at IS NULL`,
          args,
        )
      ).rows[0].n;
      const filter =
        observed +
        (q.filter === "unread" ? " AND read_at IS NULL" : "") +
        (q.category ? ` AND category=$${args.push(q.category)}` : "");
      const total = (
        await c.query(
          `SELECT count(*)::int AS n FROM public.app_notifications WHERE ${filter}`,
          args,
        )
      ).rows[0].n;
      const pages = Math.max(1, Math.ceil(total / 30)),
        page = Math.min(q.page, pages);
      const rows = (
        await c.query<NotificationRow>(
          `SELECT id,category,title,message,action_path,created_at,read_at FROM public.app_notifications WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT 30 OFFSET $${args.push((page - 1) * 30)}`,
          args,
        )
      ).rows;
      return NotificationListSchema.parse({
        notifications: rows.map(serialize),
        unreadCount: unread,
        total,
        page,
        pages,
        asOf,
        availableCategories: await availableCategories(c, actor),
      });
    });
  },
  async read(actor: NotificationActor, id: string) {
    z.uuid().parse(id);
    return commerceTransaction(async (c) => {
      const owner = await scope(c, actor),
        params = [actor.userId, actor.role, id];
      const row = (
        await c.query(
          `SELECT id FROM public.app_notifications WHERE ${owner} AND id=$3`,
          params,
        )
      ).rowCount;
      if (!row) throw new CommerceError("NOTIFICATION_NOT_FOUND", 404);
      await c.query(
        `UPDATE public.app_notifications SET read_at=clock_timestamp() WHERE ${owner} AND id=$3 AND read_at IS NULL`,
        params,
      );
      return { read: true };
    });
  },
  async readAll(actor: NotificationActor, input: unknown) {
    const { through } = ReadNotificationsSchema.parse(input);
    if (new Date(through).getTime() > Date.now() + 30000)
      throw new CommerceError("VALIDATION_ERROR", 422);
    return commerceTransaction(async (c) => {
      const owner = await scope(c, actor);
      const result = await c.query(
        `UPDATE public.app_notifications SET read_at=clock_timestamp() WHERE ${owner} AND created_at<=$3 AND read_at IS NULL`,
        [actor.userId, actor.role, through],
      );
      return { read: true, count: result.rowCount ?? 0 };
    });
  },
};
