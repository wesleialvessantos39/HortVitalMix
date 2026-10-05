import { z } from "zod";
import { PublicProductSchema } from "./product.ts";
import { DiscoveryAvatarSchema } from "./discovery.ts";

export const HIGHLIGHTS_PAGE_SIZE = 30;
export const HighlightsQuerySchema = z
  .object({
    municipalityId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict();
export const HighlightProductSchema = PublicProductSchema.extend({
  producerName: z.string().min(2).max(128),
  producerAvatarUrl: DiscoveryAvatarSchema.nullable(),
  municipalityId: z.uuid(),
  municipality: z.string().min(2).max(150),
}).strict();
export const HighlightsResponseSchema = z
  .object({
    products: z.array(HighlightProductSchema).max(HIGHLIGHTS_PAGE_SIZE),
    page: z.number().int().positive(),
    hasMore: z.boolean(),
  })
  .strict();
export type HighlightProduct = z.infer<typeof HighlightProductSchema>;
