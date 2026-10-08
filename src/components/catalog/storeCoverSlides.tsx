import type { PublicProduct } from "../../../shared/contracts/product";
import type {
  StorePublic,
  StoreOwner,
} from "../../../shared/contracts/producerStore";
import type { MediaSlide } from "./MediaCarousel";
import { ProductSlideCaption, ProducerPortrait } from "./ProductSlideCaption";

export function storeCoverSlides(
  store: Pick<
    StorePublic,
    | "coverMode"
    | "publicProducerName"
    | "coverImages"
    | "avatarUrl"
    | "bannerUrl"
  >,
  name: string,
  slug: string,
  products: Pick<
    PublicProduct,
    "id" | "title" | "media" | "currentPrice" | "unitType"
  >[],
  publicPreview = true,
): MediaSlide[] {
  const producer = store.publicProducerName ?? name;
  const href = `/produtores/${encodeURIComponent(slug)}`;
  const images: MediaSlide[] = store.coverImages.map((m) => ({
    id: `cover:${m.id}`,
    imageUrl: m.url,
    alt: `Capa de ${name}`,
    href,
    caption: (
      <div className="hvm-slide-product">
        <strong className="hvm-slide-title">{name}</strong>
        <span className="hvm-slide-producer">
          <ProducerPortrait
            url={store.avatarUrl}
            name={producer}
            publicPreview={publicPreview}
          />
          <strong>{producer}</strong>
        </span>
      </div>
    ),
  }));
  if (!images.length && store.bannerUrl)
    images.push({
      id: "legacy:banner",
      imageUrl: store.bannerUrl,
      alt: `Capa de ${name}`,
      href,
    });
  const food: MediaSlide[] = products.flatMap((product) =>
    [...product.media]
      .sort(
        (a, b) =>
          Number(b.isPrimary) - Number(a.isPrimary) ||
          a.displayOrder - b.displayOrder,
      )
      .map((m) => ({
        id: `product:${product.id}:${m.id}`,
        imageUrl: m.url,
        alt: `${product.title}, ${name}`,
        href,
        caption: (
          <ProductSlideCaption
            product={product}
            producerName={producer}
            avatarUrl={store.avatarUrl}
            storeName={name}
            publicPreview={publicPreview}
          />
        ),
      })),
  );
  if (store.coverMode === "images") return images;
  if (store.coverMode === "products") return food;
  const mixed: MediaSlide[] = [];
  for (let i = 0; i < Math.max(images.length, food.length); i++) {
    if (images[i]) mixed.push(images[i]);
    if (food[i]) mixed.push(food[i]);
  }
  return mixed;
}
