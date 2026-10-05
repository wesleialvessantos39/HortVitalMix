import { z } from "zod";
import { CategorySlugSchema } from "./category.ts";
import { StoreSlugSchema } from "./producerStore.ts";

export const DISCOVERY_PAGE_SIZE = 20;
const page = z.number().int().min(1).max(1000).default(1);
export const SearchStoresQuerySchema = z
  .object({
    query: z.string().trim().max(128).optional(),
    categorySlug: CategorySlugSchema.optional(),
    municipalityId: z.uuid().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    page,
  })
  .strict()
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), {
    message: "Informe latitude e longitude juntas.",
    path: ["longitude"],
  });
// Discovery uses the existing T12 logo, without creating an upload subsystem.
// Only HTTPS images are rendered; invalid legacy URLs get an honest no-photo state.
export const DiscoveryAvatarSchema = z
  .url({ protocol: /^https$/ })
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password;
  });
export const StoreCardSchema = z
  .object({
    id: z.uuid(),
    slug: StoreSlugSchema,
    name: z.string().min(2).max(128),
    avatarUrl: DiscoveryAvatarSchema.nullable(),
    location: z.string().max(150),
    distanceKm: z.number().nonnegative().nullable(),
    isVerified: z.boolean(),
    trustLevel: z.number().int().nonnegative(),
  })
  .strict();
export const SearchStoresResponseSchema = z
  .object({
    stores: z.array(StoreCardSchema).max(DISCOVERY_PAGE_SIZE),
    page,
    pageSize: z.literal(DISCOVERY_PAGE_SIZE),
    hasMore: z.boolean(),
    distanceReference: z.enum(["consumer", "ariquemes"]),
  })
  .strict();
export const FavoriteTargetEnum = z.enum(["store", "product"]);
export const ToggleFavoriteSchema = z
  .object({
    targetType: FavoriteTargetEnum,
    targetId: z.uuid(),
    commandId: z.uuid(),
  })
  .strict();
export const FavoriteSchema = z
  .object({ targetType: FavoriteTargetEnum, targetId: z.uuid() })
  .strict();
export const FavoritesQuerySchema = z
  .object({
    targetType: FavoriteTargetEnum.optional(),
    targetIds: z.array(z.uuid()).min(1).max(DISCOVERY_PAGE_SIZE).optional(),
    page,
  })
  .strict();
export const FavoritesResponseSchema = z
  .object({
    favorites: z.array(FavoriteSchema).max(100),
    page,
    hasMore: z.boolean(),
  })
  .strict();
export const ToggleFavoriteResponseSchema = FavoriteSchema.extend({
  isFavorite: z.boolean(),
  replayed: z.boolean(),
}).strict();
export type SearchStoresQuery = z.infer<typeof SearchStoresQuerySchema>;
export type StoreCard = z.infer<typeof StoreCardSchema>;
export type SearchStoresResponse = z.infer<typeof SearchStoresResponseSchema>;
export type FavoritesQuery = z.infer<typeof FavoritesQuerySchema>;
export type ToggleFavorite = z.infer<typeof ToggleFavoriteSchema>;
