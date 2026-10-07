import type { PoolClient } from "pg";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import { StoreSlugSchema } from "../../shared/contracts/producerStore.ts";
import {
  CommerceError,
  commerceTransaction,
  commerceIdentity,
  commerceAdmin,
  commerceCommand,
  commerceAudit,
  type CommerceAudit,
} from "./CommerceSupport.ts";
import {
  CreateReviewSchema,
  ModerateReviewSchema,
  ReviewIdSchema,
  ReviewListQuerySchema,
  AdminReviewQuerySchema,
  PublicReviewSchema,
  OwnerReviewSchema,
  ReviewEligibilitySchema,
  StoreReviewsSchema,
  AdminReviewSchema,
  AdminReviewListSchema,
} from "../../shared/contracts/review.ts";
const PAGE_SIZE = 10;
const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);
function publicReview(r: Record<string, unknown>) {
  return PublicReviewSchema.parse({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    createdAt: iso(r.created_at as Date),
  });
}
function ownerReview(r: Record<string, unknown>) {
  return OwnerReviewSchema.parse({
    ...publicReview(r),
    isModerated: r.is_moderated,
  });
}
function adminReview(r: Record<string, unknown>) {
  return AdminReviewSchema.parse({
    ...ownerReview(r),
    orderId: r.order_id,
    orderNumber: r.order_number,
    storeId: r.store_id,
    storeName: r.store_name,
    moderationReason: r.moderation_reason,
    moderatedBy: r.moderated_by,
    moderatedAt: iso(r.moderated_at as Date | null),
  });
}
async function ownedOrder(c: PoolClient, userId: string, id: string) {
  const r = (
    await c.query(
      `SELECT o.id,o.store_id,f.status FROM public.app_orders o LEFT JOIN public.app_order_fulfillment f ON f.order_id=o.id WHERE o.id=$1 AND o.customer_user_id=$2 FOR SHARE OF o`,
      [id, userId],
    )
  ).rows[0];
  if (!r) throw new CommerceError("ORDER_NOT_FOUND", 404);
  return r;
}
export const ReviewService = {
  async eligibility(userId: string, rawId: string) {
    const id = ReviewIdSchema.parse(rawId);
    return commerceTransaction(async (c) => {
      await commerceIdentity(c, userId);
      const o = await ownedOrder(c, userId, id),
        r = (
          await c.query(
            "SELECT id,rating,comment,created_at,is_moderated FROM public.app_reviews WHERE order_id=$1",
            [id],
          )
        ).rows[0];
      const reason = r
        ? "already_reviewed"
        : o.status !== "delivered"
          ? "not_delivered"
          : !o.store_id
            ? "store_unavailable"
            : null;
      return ReviewEligibilitySchema.parse({
        orderId: id,
        canReview: reason === null,
        reason,
        review: r ? ownerReview(r) : null,
      });
    });
  },
  async createReview(
    userId: string,
    raw: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const input = CreateReviewSchema.parse(raw);
    return commerceTransaction(async (c) => {
      const actor = await commerceIdentity(c, userId);
      return commerceCommand(
        c,
        userId,
        commandId,
        "review.create",
        input,
        async () => {
          const o = await ownedOrder(c, userId, input.orderId);
          if (o.status !== "delivered")
            throw new CommerceError("REVIEW_NOT_DELIVERED", 422);
          if (!o.store_id)
            throw new CommerceError("REVIEW_STORE_UNAVAILABLE", 422);
          if (
            (
              await c.query(
                "SELECT 1 FROM public.app_reviews WHERE order_id=$1",
                [o.id],
              )
            ).rowCount
          )
            throw new CommerceError("REVIEW_ALREADY_EXISTS", 409);
          const r = (
            await c.query(
              "INSERT INTO public.app_reviews(order_id,customer_person_id,store_id,rating,comment) VALUES($1,$2,$3,$4,$5) RETURNING id,rating,comment,created_at,is_moderated",
              [
                o.id,
                actor.person_id,
                o.store_id,
                input.rating,
                input.comment || null,
              ],
            )
          ).rows[0];
          await commerceAudit(
            c,
            userId,
            "consumer",
            "review.created",
            "app_reviews",
            r.id,
            { orderId: o.id, storeId: o.store_id, rating: input.rating },
            context,
            commandId,
          );
          return ownerReview(r);
        },
      );
    });
  },
  async publicStoreReviews(rawStoreSlug: string, rawQuery: unknown) {
    const slug = StoreSlugSchema.parse(rawStoreSlug),
      q = ReviewListQuerySchema.parse(rawQuery);
    return commerceTransaction(async (c) => {
      // One statement keeps the projection and page in the same MVCC snapshot.
      const p = (
        await c.query(
          `SELECT coalesce(p.average_rating,0) AS average_rating,
        coalesce(p.total_reviews,0) AS total_reviews,coalesce(v.reviews,'[]'::jsonb) AS reviews
        FROM public.app_producer_stores s LEFT JOIN public.app_reputation_projections p ON p.store_id=s.id
        LEFT JOIN LATERAL (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id DESC) AS reviews
          FROM (SELECT id,rating,comment,created_at FROM public.app_reviews WHERE store_id=s.id AND NOT is_moderated
            ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3) r) v ON true
        WHERE s.store_slug=$1 AND s.status='active' AND hvm_store_private.store_is_visible(s.id)`,
          [slug, PAGE_SIZE, (q.page - 1) * PAGE_SIZE],
        )
      ).rows[0];
      if (!p) throw new CommerceError("STORE_NOT_FOUND", 404);
      const total = p.total_reviews;
      return StoreReviewsSchema.parse({
        reputation: {
          averageRating: Number(p.average_rating),
          totalReviews: total,
        },
        reviews: p.reviews.map(publicReview),
        page: q.page,
        pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        total,
      });
    });
  },
  async adminList(actor: AdminActorContext, rawQuery: unknown) {
    const q = AdminReviewQuerySchema.parse(rawQuery);
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "complaint_management");
      const state = q.state === "all" ? null : q.state === "moderated",
        total = Number(
          (
            await c.query(
              "SELECT count(*) FROM public.app_reviews WHERE ($1::boolean IS NULL OR is_moderated=$1)",
              [state],
            )
          ).rows[0].count,
        );
      const rows = (
        await c.query(
          `SELECT r.*,o.order_number,s.store_name FROM public.app_reviews r JOIN public.app_orders o ON o.id=r.order_id JOIN public.app_producer_stores s ON s.id=r.store_id WHERE ($1::boolean IS NULL OR r.is_moderated=$1) ORDER BY r.created_at DESC,r.id DESC LIMIT $2 OFFSET $3`,
          [state, PAGE_SIZE, (q.page - 1) * PAGE_SIZE],
        )
      ).rows;
      return AdminReviewListSchema.parse({
        reviews: rows.map(adminReview),
        page: q.page,
        pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        total,
      });
    });
  },
  async moderateReview(
    rawId: string,
    actor: AdminActorContext,
    raw: unknown,
    commandId: string,
    context: CommerceAudit,
  ) {
    const id = ReviewIdSchema.parse(rawId),
      input = ModerateReviewSchema.parse(raw);
    return commerceTransaction(async (c) => {
      await commerceAdmin(c, actor, "complaint_management");
      return commerceCommand(
        c,
        actor.userId,
        commandId,
        "review.moderate",
        { id, ...input },
        async () => {
          const existing = (
            await c.query(
              "SELECT id,is_moderated FROM public.app_reviews WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!existing) throw new CommerceError("REVIEW_NOT_FOUND", 404);
          if (existing.is_moderated)
            throw new CommerceError("REVIEW_ALREADY_MODERATED", 409);
          await c.query(
            "UPDATE public.app_reviews SET is_moderated=true,moderation_reason=$2,moderated_by=$3,moderated_at=clock_timestamp() WHERE id=$1",
            [id, input.reason, actor.userId],
          );
          await commerceAudit(
            c,
            actor.userId,
            actor.role,
            "review.moderated",
            "app_reviews",
            id,
            { reason: input.reason },
            context,
            commandId,
          );
          const r = (
            await c.query(
              "SELECT r.*,o.order_number,s.store_name FROM public.app_reviews r JOIN public.app_orders o ON o.id=r.order_id JOIN public.app_producer_stores s ON s.id=r.store_id WHERE r.id=$1",
              [id],
            )
          ).rows[0];
          return adminReview(r);
        },
      );
    });
  },
};
