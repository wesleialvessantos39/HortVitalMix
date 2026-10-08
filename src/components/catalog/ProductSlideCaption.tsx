import { useState } from "react";
import { Sprout } from "lucide-react";
import { MediaImage } from "./MediaImage";
import {
  formatProductPrice,
  UNIT_LABELS,
  type PublicProduct,
} from "../../../shared/contracts/product";

export function ProducerPortrait({
  url,
  name,
  publicPreview = true,
}: {
  url: string | null;
  name: string;
  publicPreview?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="hvm-slide-portrait">
      {url && failed !== url ? (
        <MediaImage
          sizes="52px"
          publicPreview={publicPreview}
          src={url}
          alt={`Foto de ${name}`}
          loading="eager"
          decoding="async"
          onError={() => setFailed(url)}
        />
      ) : (
        <Sprout size={20} aria-hidden="true" />
      )}
    </span>
  );
}

export function ProductSlideCaption({
  product,
  producerName,
  avatarUrl,
  storeName,
  region,
  publicPreview = true,
}: {
  product: Pick<PublicProduct, "title" | "currentPrice" | "unitType">;
  producerName: string;
  avatarUrl: string | null;
  storeName: string;
  region?: string;
  publicPreview?: boolean;
}) {
  return (
    <div className="hvm-slide-product">
      {region && <span className="hvm-slide-region">{region}</span>}
      <strong className="hvm-slide-title">{product.title}</strong>
      <span className="hvm-slide-price">
        {formatProductPrice(product.currentPrice.priceCents)}{" "}
        <small>/ {UNIT_LABELS[product.unitType]}</small>
      </span>
      <span className="hvm-slide-producer">
        <ProducerPortrait
          url={avatarUrl}
          name={producerName}
          publicPreview={publicPreview}
        />
        <span>
          <strong>{producerName}</strong>
          <span>{storeName}</span>
        </span>
      </span>
      <span className="hvm-slide-visit">Conhecer a loja →</span>
    </div>
  );
}
