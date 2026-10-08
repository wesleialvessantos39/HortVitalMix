import { PageLoading } from "../../components/PageLoading";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  Leaf,
  MapPin,
  ShieldCheck,
  Sprout,
} from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import { prepareMediaUrls } from "../../lib/prepareMedia";
import {
  StorePublicResponseSchema,
  STORE_DAY_LABELS,
  type StorePublic,
} from "../../../shared/contracts/producerStore";
import "../producer/producerStore.css";
import { PublicProductGrid } from "../../components/catalog/PublicProductCatalog";
import { usePublicProducts } from "../../components/catalog/usePublicProducts";
import { MediaCarousel } from "../../components/catalog/MediaCarousel";
import { storeCoverSlides } from "../../components/catalog/storeCoverSlides";
import { ProducerPortrait } from "../../components/catalog/ProductSlideCaption";
import "../../components/catalog/storefrontMedia.css";
import { StoreReputationBlock } from "../../components/reviews/StoreReputationBlock";

export default function PublicProducerStorePage({
  slug,
  onNavigate,
}: {
  slug: string;
  onNavigate: (path: string) => void;
}) {
  const catalog = usePublicProducts({ storeSlug: slug });
  const [store, setStore] = useState<StorePublic | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    api(`/v1/stores/${encodeURIComponent(slug)}?media=1`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = StorePublicResponseSchema.parse(response);
        void prepareMediaUrls(
          [result.coverImages[0]?.url ?? result.bannerUrl],
          { signal: controller.signal, sizes:"100vw" },
        );
        void prepareMediaUrls([result.avatarUrl],{signal:controller.signal,sizes:"52px"});
        if (!controller.signal.aborted) {
          setStore(result);
          setState("ready");
        }
      })
      .catch((failure: ApiFailure) => {
        if (!controller.signal.aborted)
          setState(failure.status === 404 ? "missing" : "error");
      });
    return () => controller.abort();
  }, [slug, attempt]);
  if (state === "loading")
    return (
      <section className="hvm-store">
        <PageLoading label="Carregando a vitrine…" />
      </section>
    );
  if (state !== "ready" || !store)
    return (
      <section className="hvm-store">
        <div className="hvm-store-empty">
          <span className="hvm-store-emblem">
            <Sprout />
          </span>
          <h1>
            {state === "missing"
              ? "Vitrine indisponível"
              : "Não foi possível carregar a vitrine"}
          </h1>
          <p>
            {state === "missing"
              ? "Esta vitrine não está disponível agora. Volte para conhecer a HortiVitalMix."
              : "Tente novamente em alguns instantes."}
          </p>
          {state === "error" && (
            <button
              className="primary"
              onClick={() => setAttempt((current) => current + 1)}
            >
              Tentar novamente
            </button>
          )}
          <button className="secondary" onClick={() => onNavigate("/")}>
            <ArrowLeft size={18} /> Voltar ao início
          </button>
        </div>
      </section>
    );
  const covers = storeCoverSlides(
    store,
    store.name,
    store.slug,
    catalog.products,
  );
  const harvestDays = store.operatingHours
    .filter((day) => day.isHarvestDay)
    .map((day) => STORE_DAY_LABELS[day.dayOfWeek]);
  const deliveryDays = store.operatingHours
    .filter((day) => day.isDeliveryDay)
    .map((day) => STORE_DAY_LABELS[day.dayOfWeek]);
  return (
    <article className="hvm-store hvm-store-public">
      {covers.length ? (
        <MediaCarousel imageSizes="100vw"
          className="hvm-store-cover"
          priority
          label="Capa da loja"
          slides={covers}
          onNavigate={onNavigate}
        />
      ) : (
        <div className="hvm-store-banner">
          {store.bannerUrl ? (
            <img src={store.bannerUrl} alt="" />
          ) : (
            <>
              <span className="hvm-store-banner-leaf">
                <Leaf size={104} />
              </span>
              <p>
                Da terra, com cuidado.
                <br />
                <strong>Da sua região, com carinho.</strong>
              </p>
            </>
          )}
        </div>
      )}
      <header className="hvm-store-public-heading">
        <div className="hvm-store-avatar">
          <ProducerPortrait
            url={store.avatarUrl}
            name={store.publicProducerName ?? store.name}
          />
        </div>
        <div>
          <span className="eyebrow">Conheça quem cultiva</span>
          <h1>{store.name}</h1>
          <div className="commerce-actions"><button className="text-button" onClick={()=>onNavigate(`/denuncias?targetType=store&storeSlug=${encodeURIComponent(store.slug)}&search=${encodeURIComponent(store.name)}`)}>Denunciar loja</button><button className="text-button" onClick={()=>onNavigate(`/denuncias?targetType=producer&storeSlug=${encodeURIComponent(store.slug)}&search=${encodeURIComponent(store.name)}`)}>Denunciar produtor</button></div>
          {store.publicProducerName && (
            <p className="hvm-store-producer-name">
              {store.publicProducerName}
            </p>
          )}
          {store.verification.isVerified && (
            <span className="hvm-store-verified">
              <ShieldCheck size={18} /> Produtor Verificado — Nível{" "}
              {store.verification.trustLevel}
            </span>
          )}
          <p className="hvm-store-location">
            <MapPin size={17} /> {store.location}
          </p>
        </div>
      </header>
      <StoreReputationBlock key={store.slug} storeSlug={store.slug}/>
      <section className="hvm-store-story">
        <h2>Uma história cultivada com cuidado</h2>
        <p>{store.bio}</p>
      </section>
      <section aria-label="Rotina da loja" className="hvm-store-facts">
        <div>
          <Clock3 />
          <h3>Horário de corte</h3>
          <strong>{store.cutoffHour}</strong>
          <p>Horário local de Rondônia</p>
        </div>
        <div>
          <Leaf />
          <h3>Pedido mínimo</h3>
          <strong>
            {new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
            }).format(store.minOrderAmountCents / 100)}
          </strong>
          <p>Condições da produção</p>
        </div>
        <div>
          <CalendarDays />
          <h3>Dias de colheita</h3>
          <p>
            {harvestDays.length ? harvestDays.join(", ") : "Sem dias definidos"}
          </p>
          <h3>Dias de entrega</h3>
          <p>
            {deliveryDays.length
              ? deliveryDays.join(", ")
              : "Sem dias definidos"}
          </p>
        </div>
      </section>
      <details className="hvm-store-hour-details">
        <summary>Consultar horários por dia</summary>
        <ul>
          {store.operatingHours.map((day) => (
            <li key={day.dayOfWeek}>
              <strong>{STORE_DAY_LABELS[day.dayOfWeek]}</strong>
              <span>
                {day.isHarvestDay ? "Colheita" : "Sem colheita"} ·{" "}
                {day.isDeliveryDay ? "Entrega" : "Sem entrega"} · Corte às{" "}
                {day.cutoffTime}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <section className="hvm-store-products">
        <h2>Colheitas e Produtos Disponíveis</h2>
        <PublicProductGrid
          {...catalog}
          storeSlug={store.slug}
          onNavigate={onNavigate}
          emptyTitle="Novas colheitas em breve"
        />
      </section>
      <button className="secondary" onClick={() => onNavigate("/")}>
        <ArrowLeft size={17} /> Voltar ao início
      </button>
    </article>
  );
}
