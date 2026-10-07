import { z } from "zod";

export const ReviewIdSchema = z.uuid().transform((v) => v.toLowerCase());
export const CreateReviewSchema = z
  .object({
    orderId: ReviewIdSchema,
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();
export const ModerateReviewSchema = z
  .object({
    reason: z.string().trim().min(10).max(500),
  })
  .strict();
export const ReviewListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
export const AdminReviewQuerySchema = ReviewListQuerySchema.extend({
  state: z.enum(["published", "moderated", "all"]).default("published"),
}).strict();
export const PublicReviewSchema = z
  .object({
    id: z.uuid(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const OwnerReviewSchema = PublicReviewSchema.extend({
  isModerated: z.boolean(),
}).strict();
export const ReviewEligibilitySchema = z
  .object({
    orderId: z.uuid(),
    canReview: z.boolean(),
    reason: z
      .enum(["not_delivered", "already_reviewed", "store_unavailable"])
      .nullable(),
    review: OwnerReviewSchema.nullable(),
  })
  .strict();
export const StoreReviewsSchema = z
  .object({
    reputation: z
      .object({
        averageRating: z.number().min(0).max(5),
        totalReviews: z.number().int().nonnegative(),
      })
      .strict(),
    reviews: z.array(PublicReviewSchema),
    page: z.number().int().positive(),
    pages: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export const AdminReviewSchema = PublicReviewSchema.extend({
  orderId: z.uuid(),
  orderNumber: z.string(),
  storeId: z.uuid(),
  storeName: z.string(),
  isModerated: z.boolean(),
  moderationReason: z.string().nullable(),
  moderatedBy: z.uuid().nullable(),
  moderatedAt: z.iso.datetime().nullable(),
}).strict();
export const AdminReviewListSchema = z
  .object({
    reviews: z.array(AdminReviewSchema),
    page: z.number().int().positive(),
    pages: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export type PublicReview = z.infer<typeof PublicReviewSchema>;
export type OwnerReview = z.infer<typeof OwnerReviewSchema>;
export type ReviewEligibility = z.infer<typeof ReviewEligibilitySchema>;
export type StoreReviews = z.infer<typeof StoreReviewsSchema>;
export type AdminReview = z.infer<typeof AdminReviewSchema>;
