import type { PoolClient } from "pg";
import { signedMediaUrls } from "./signedMedia.ts";

export const STORE_MEDIA_BUCKET = "store-media";
export const STORE_MEDIA_PREFIX =
  "https://xipbsazvymkqqfmfegwu.supabase.co/storage/v1/object/store-media/";

function safeLegacyUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}
export async function storeImageUrls(values: (string | null)[]) {
  const paths = values
    .filter((value): value is string =>
      Boolean(value?.startsWith(STORE_MEDIA_PREFIX)),
    )
    .map((value) => value.slice(STORE_MEDIA_PREFIX.length));
  const signed = await signedMediaUrls(STORE_MEDIA_BUCKET, paths);
  return new Map(
    values.map((value) => [
      value,
      value?.startsWith(STORE_MEDIA_PREFIX)
        ? (signed.get(value.slice(STORE_MEDIA_PREFIX.length)) ?? null)
        : safeLegacyUrl(value),
    ]),
  );
}
export async function storeMediaDetails(
  client: PoolClient,
  row: {
    id: string;
    logo_url: string | null;
    banner_url: string | null;
    cover_mode?: string;
    public_producer_name?: string | null;
  },
) {
  const covers = await client.query<{
    id: string;
    media_url: string;
    display_order: number;
  }>(
    "SELECT id,media_url,display_order FROM public.app_store_media WHERE store_id=$1 AND purpose='cover' ORDER BY display_order,created_at,id",
    [row.id],
  );
  const urls = await storeImageUrls([
    row.logo_url,
    row.banner_url,
    ...covers.rows.map((image) => image.media_url),
  ]);
  return {
    avatarUrl: urls.get(row.logo_url) ?? null,
    bannerUrl: urls.get(row.banner_url) ?? null,
    coverMode: row.cover_mode ?? "mixed",
    publicProducerName: row.public_producer_name ?? null,
    coverImages: covers.rows.map((image) => ({
      id: image.id,
      url: urls.get(image.media_url),
      displayOrder: image.display_order,
    })),
  };
}
