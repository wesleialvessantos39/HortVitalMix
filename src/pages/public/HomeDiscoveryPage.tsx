import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Heart,
  LocateFixed,
  MapPin,
  Search,
  ShieldCheck,
  Sprout,
} from "lucide-react";
import { api, type ApiFailure } from "../../lib/api";
import type { ShellSession } from "../../hooks/useSession";
import {
  PublicCategoriesResponseSchema,
  flattenCategories,
  type Category,
} from "../../../shared/contracts/category";
import {
  FavoritesResponseSchema,
  SearchStoresResponseSchema,
  ToggleFavoriteResponseSchema,
  type SearchStoresResponse,
} from "../../../shared/contracts/discovery";
import "./discovery.css";
import { MediaImage } from "../../components/catalog/MediaImage";

function StorePhoto({
  name,
  avatarUrl,
  priority,
}: {
  name: string;
  avatarUrl: string | null;
  priority: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return avatarUrl && !failed ? (
    <MediaImage
      src={avatarUrl}
      alt={`Foto de ${name}`}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      priority={priority}
      onError={() => setFailed(true)}
    />
  ) : (
    <span>
      <Sprout size={36} aria-hidden="true" />
      {avatarUrl ? "Foto indisponível" : "Foto não cadastrada"}
    </span>
  );
}

export default function HomeDiscoveryPage({
  session,
  sessionLoading,
  municipalityId,
  regionLabel,
  blocked,
  onNavigate,
}: {
  session: ShellSession | null;
  sessionLoading: boolean;
  municipalityId?: string;
  regionLabel: string | null;
  blocked: boolean;
  onNavigate: (path: string) => void;
}) {
  const [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [categorySlug, setCategorySlug] = useState(""),
    [categories, setCategories] = useState<Category[]>([]),
    [categoryError, setCategoryError] = useState(false),
    [page, setPage] = useState(1),
    [coordinates, setCoordinates] = useState<{
      latitude: number;
      longitude: number;
    } | null>(null),
    [locating, setLocating] = useState(false),
    [locationMessage, setLocationMessage] = useState(""),
    [result, setResult] = useState<SearchStoresResponse | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0),
    [favorites, setFavorites] = useState<Set<string> | null>(null),
    [favoriteError, setFavoriteError] = useState(""),
    [favoriteAttempt, setFavoriteAttempt] = useState(0),
    [pending, setPending] = useState<Set<string>>(new Set());
  const commands = useRef(new Map<string, string>());
  const identity = useRef(session?.userId);
  identity.current = session?.userId;
  const positionRequest = useRef(0);
  useEffect(
    () => () => {
      positionRequest.current++;
    },
    [],
  );
  useEffect(() => {
    const abort = new AbortController();
    api("/v1/categories", { signal: abort.signal })
      .then((raw) => {
        if (abort.signal.aborted) return;
        setCategories(
          flattenCategories(
            PublicCategoriesResponseSchema.parse(raw).categories,
          ),
        );
        setCategoryError(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) setCategoryError(true);
      });
    return () => abort.abort();
  }, [attempt]);
  useEffect(() => {
    setPage(1);
  }, [query, categorySlug, municipalityId, coordinates]);
  useEffect(() => {
    const abort = new AbortController();
    setResult(null);
    setLoading(!blocked);
    setError(false);
    if (blocked) return () => abort.abort();
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set("query", query);
    if (categorySlug) params.set("categorySlug", categorySlug);
    if (municipalityId) params.set("municipalityId", municipalityId);
    if (coordinates) {
      params.set("latitude", String(coordinates.latitude));
      params.set("longitude", String(coordinates.longitude));
    }
    api(`/v1/discovery/stores?${params}`, { signal: abort.signal })
      .then((raw) => {
        if (abort.signal.aborted) return;
        setResult(SearchStoresResponseSchema.parse(raw));
        setError(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [
    query,
    categorySlug,
    municipalityId,
    coordinates,
    page,
    blocked,
    attempt,
  ]);
  useEffect(() => {
    commands.current.clear();
    setPending(new Set());
  }, [session?.userId]);
  useEffect(() => {
    const abort = new AbortController();
    setFavorites(null);
    setFavoriteError("");
    if (!session || !result?.stores.length) return () => abort.abort();
    const params = new URLSearchParams({
      targetType: "store",
      targetIds: result.stores.map((s) => s.id).join(","),
    });
    api(`/v1/favorites?${params}`, { signal: abort.signal })
      .then((raw) => {
        if (!abort.signal.aborted) {
          setFavorites(
            new Set(
              FavoritesResponseSchema.parse(raw).favorites.map(
                (f) => f.targetId,
              ),
            ),
          );
          // An authoritative read resolves an uncertain previous POST.
          result.stores.forEach((store) => commands.current.delete(store.id));
        }
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setFavoriteError("Não foi possível consultar seus favoritos.");
      });
    return () => abort.abort();
  }, [session?.userId, result, favoriteAttempt]);
  function locate() {
    if (!navigator.geolocation) {
      setLocationMessage(
        "A localização não está disponível neste navegador. A referência continua sendo Ariquemes.",
      );
      return;
    }
    const request = ++positionRequest.current;
    setLocating(true);
    setLocationMessage("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (request !== positionRequest.current) return;
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocating(false);
      },
      () => {
        if (request !== positionRequest.current) return;
        setLocating(false);
        setLocationMessage(
          "Não foi possível obter sua posição. A referência continua sendo Ariquemes.",
        );
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }
  async function toggle(id: string) {
    if (!session) {
      onNavigate("/entrar/consumidor");
      return;
    }
    const userId = session.userId;
    if (pending.has(id)) return;
    const commandId = commands.current.get(id) ?? crypto.randomUUID();
    commands.current.set(id, commandId);
    setPending((values) => new Set(values).add(id));
    setFavoriteError("");
    try {
      const response = ToggleFavoriteResponseSchema.parse(
        await api("/v1/favorites/toggle", {
          method: "POST",
          body: JSON.stringify({
            targetType: "store",
            targetId: id,
            commandId,
          }),
        }),
      );
      if (identity.current !== userId) return;
      commands.current.delete(id);
      setFavorites((values) => {
        const next = new Set(values);
        if (response.isFavorite) next.add(id);
        else next.delete(id);
        return next;
      });
      if (response.replayed) setFavoriteAttempt((n) => n + 1);
    } catch (error) {
      if (identity.current !== userId) return;
      const status = (error as ApiFailure).status;
      if (status === 401) {
        window.dispatchEvent(new Event("hvm:session-cleared"));
        onNavigate("/entrar/consumidor");
        return;
      }
      if (status && status < 500) commands.current.delete(id);
      setFavoriteError(
        status === 404
          ? "Este produtor não está mais disponível. Atualize a busca."
          : "Não foi possível atualizar o favorito. Tente o mesmo botão novamente.",
      );
    } finally {
      if (identity.current === userId)
        setPending((values) => {
          const next = new Set(values);
          next.delete(id);
          return next;
        });
    }
  }
  return (
    <div className="hvm-discovery">
      <form
        className="hvm-discovery-filters"
        role="search"
        aria-label="Descobrir produtores"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(draft.trim());
          setAttempt((n) => n + 1);
        }}
      >
        <label className="hvm-discovery-search">
          Buscar produtores ou alimentos
          <span>
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="Buscar produtores ou alimentos"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={128}
              placeholder="Nome do produtor ou alimento"
            />
            <button className="primary" type="submit">
              Buscar produtores
            </button>
          </span>
        </label>
        <label>
          Categoria dos produtores
          <select
            aria-label="Categoria dos produtores"
            value={categorySlug}
            onChange={(e) => setCategorySlug(e.target.value)}
          >
            <option value="">Todas as categorias</option>
            {categories.map((category) => (
              <option key={category.id} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary hvm-discovery-position"
          type="button"
          disabled={locating}
          onClick={
            coordinates
              ? () => {
                  positionRequest.current++;
                  setCoordinates(null);
                  setLocationMessage("");
                }
              : locate
          }
        >
          <LocateFixed size={17} aria-hidden="true" />
          {locating
            ? "Obtendo posição…"
            : coordinates
              ? "Usar referência de Ariquemes"
              : "Usar minha posição"}
        </button>
      </form>
      <p className="hvm-discovery-reference">
        <MapPin size={15} aria-hidden="true" />
        {coordinates
          ? "Distâncias em linha reta a partir da sua posição."
          : "Distâncias em linha reta a partir do centro de Ariquemes."}
        {regionLabel ? ` Produtores em ${regionLabel}.` : ""}
      </p>
      {locationMessage && (
        <p role="status" className="hvm-discovery-notice">
          {locationMessage}
        </p>
      )}
      {categoryError && (
        <p className="hvm-discovery-notice">
          As categorias não puderam ser carregadas agora.
        </p>
      )}
      {favoriteError && (
        <div className="hvm-discovery-notice hvm-discovery-error" role="alert">
          <p>{favoriteError}</p>
          <button
            className="secondary"
            onClick={() => setFavoriteAttempt((n) => n + 1)}
          >
            Recarregar favoritos
          </button>
        </div>
      )}
      {blocked ? (
        <div className="hvm-discovery-empty">
          <MapPin size={32} aria-hidden="true" />
          <h3>A região selecionada está indisponível</h3>
          <p>
            Escolha uma região ativa em Localização para consultar os
            produtores.
          </p>
        </div>
      ) : loading ? (
        <p role="status" className="hvm-discovery-notice">
          Buscando produtores…
        </p>
      ) : error ? (
        <div role="alert" className="hvm-discovery-notice hvm-discovery-error">
          <p>Não foi possível consultar os produtores agora.</p>
          <button
            className="secondary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : !result?.stores.length ? (
        <div className="hvm-discovery-empty">
          <Sprout size={36} aria-hidden="true" />
          <h3>Nenhum produtor encontrado</h3>
          <p>
            {query || categorySlug
              ? "Tente outro nome, alimento ou categoria."
              : "Assim que houver lojas ativas, você poderá conhecer os produtores por aqui."}
          </p>
        </div>
      ) : (
        <div className="hvm-discovery-grid" aria-label="Produtores encontrados">
          {result.stores.map((store,index) => (
            <article className="hvm-discovery-card" key={store.id}>
              <div className="hvm-discovery-photo">
                <StorePhoto
                  key={store.avatarUrl}
                  name={store.name}
                  priority={index<3}
                  avatarUrl={store.avatarUrl}
                />
                <button
                  type="button"
                  className="hvm-discovery-heart"
                  aria-label={`${favorites?.has(store.id) ? "Remover" : "Adicionar"} ${store.name} ${favorites?.has(store.id) ? "dos" : "aos"} favoritos`}
                  aria-pressed={
                    session && favorites ? favorites.has(store.id) : false
                  }
                  disabled={
                    sessionLoading ||
                    pending.has(store.id) ||
                    Boolean(session && !favorites)
                  }
                  onClick={() => void toggle(store.id)}
                >
                  <Heart
                    size={21}
                    fill={favorites?.has(store.id) ? "currentColor" : "none"}
                    aria-hidden="true"
                  />
                </button>
              </div>
              <div className="hvm-discovery-body">
                <span className="hvm-discovery-verified">
                  <ShieldCheck size={16} aria-hidden="true" />
                  {store.isVerified ? "Produtor verificado" : "Produtor"}
                </span>
                <h3>{store.name}</h3>
                <p>{store.location}</p>
                <p className="hvm-discovery-distance">
                  <MapPin size={16} aria-hidden="true" />
                  {store.distanceKm === null
                    ? "Distância indisponível"
                    : `${store.distanceKm.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`}
                </p>
                <a
                  className="primary hvm-discovery-link"
                  href={`/produtores/${store.slug}`}
                  onClick={(e) => {
                    if (
                      e.button === 0 &&
                      !e.metaKey &&
                      !e.ctrlKey &&
                      !e.shiftKey &&
                      !e.altKey
                    ) {
                      e.preventDefault();
                      onNavigate(`/produtores/${store.slug}`);
                    }
                  }}
                >
                  Ver Produtos
                  <ChevronRight size={17} aria-hidden="true" />
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
      {result && (page > 1 || result.hasMore) && (
        <nav
          className="hvm-discovery-pagination"
          aria-label="Páginas de produtores"
        >
          <button
            className="secondary"
            disabled={page === 1 || loading}
            onClick={() => setPage((n) => n - 1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
            Anterior
          </button>
          <span>Página {page}</span>
          <button
            className="secondary"
            disabled={!result.hasMore || loading}
            onClick={() => setPage((n) => n + 1)}
          >
            Próxima
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}
