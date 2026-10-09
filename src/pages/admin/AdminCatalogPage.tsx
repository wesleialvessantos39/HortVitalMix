import { useState } from "react";
import { ArrowUpRight, ListTree } from "lucide-react";
import {
  AdminCatalogQuerySchema,
  AdminCatalogResponseSchema,
  type AdminCatalogQuery,
} from "../../../shared/contracts/adminOperations";
import { PageLoading } from "../../components/PageLoading";
import {
  money,
  number,
  when,
  OperationsError,
  OperationsHeader,
  OperationsMetrics,
  OperationsPagination,
  OperationsTable,
  OperationsTabs,
  OperationsUnavailable,
  useOperationsQuery,
  type AdminOperationsPageProps,
} from "./adminOperationsView";

const parse = (input: unknown) => AdminCatalogResponseSchema.parse(input);
const storeLabels = {
  draft: "Rascunho",
  pending_review: "Em análise",
  active: "Ativa",
  paused: "Pausada",
  closed: "Encerrada",
};
const initial = () => AdminCatalogQuerySchema.parse({});
export function AdminCatalogPage({
  access,
  onNavigate,
}: AdminOperationsPageProps) {
  const [filters, setFilters] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const path =
    "/v1/admin/catalog/overview?" +
    new URLSearchParams(
      Object.entries(filters).map(([key, value]) => [key, String(value)]),
    );
  const query = useOperationsQuery(access, "catalog_moderation", path, parse);
  const changeView = (view: AdminCatalogQuery["view"]) => {
    setFilters((value) => ({ ...value, view, page: 1 }));
    setDraft((value) => ({ ...value, view, page: 1 }));
  };
  if (!query.permitted)
    return <OperationsUnavailable onNavigate={onNavigate} />;
  const data = query.data;
  return (
    <section
      className="admin-page admin-ops-page"
      aria-labelledby="catalog-page-title"
    >
      <OperationsHeader
        title="Catálogo"
        headingId="catalog-page-title"
        description="Produtos, lojas e categorias, com a publicação e a visibilidade real de cada item."
        icon={ListTree}
        loading={query.loading}
        onRefresh={query.refresh}
      />
      <OperationsTabs
        value={filters.view}
        items={[
          { value: "products", label: "Produtos" },
          { value: "stores", label: "Lojas" },
          { value: "categories", label: "Categorias" },
        ]}
        onChange={changeView}
      />
      <form
        className="admin-card admin-ops-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters(AdminCatalogQuerySchema.parse({ ...draft, page: 1 }));
        }}
      >
        <label className="admin-ops-search">
          Buscar no catálogo
          <input
            type="search"
            value={draft.search}
            maxLength={80}
            placeholder={
              filters.view === "products"
                ? "Produto, loja ou categoria"
                : filters.view === "stores"
                  ? "Nome ou endereço da loja"
                  : "Nome da categoria"
            }
            onChange={(event) =>
              setDraft((value) => ({ ...value, search: event.target.value }))
            }
          />
        </label>
        {filters.view === "products" && (
          <label>
            Publicação
            <select
              value={draft.publication}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  publication: event.target
                    .value as AdminCatalogQuery["publication"],
                }))
              }
            >
              <option value="all">Todos os produtos</option>
              <option value="published">Publicados</option>
              <option value="draft">Rascunhos</option>
              <option value="unavailable">Publicados fora da vitrine</option>
            </select>
          </label>
        )}
        {filters.view !== "categories" && (
          <label>
            Situação da loja
            <select
              value={draft.storeStatus}
              onChange={(event) =>
                setDraft((value) => ({
                  ...value,
                  storeStatus: event.target
                    .value as AdminCatalogQuery["storeStatus"],
                }))
              }
            >
              <option value="all">Todas as situações</option>
              {Object.entries(storeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="submit"
          className="admin-primary"
          disabled={query.loading}
        >
          Aplicar filtros
        </button>
      </form>
      {query.error && (
        <OperationsError
          message={query.error}
          stale={Boolean(data)}
          onRetry={query.refresh}
          loading={query.loading}
        />
      )}
      {!data && !query.error && <PageLoading label="Carregando catálogo" />}
      {data && (
        <>
          <OperationsMetrics
            items={[
              {
                label: "Produtos publicados",
                value: number(data.metrics.publishedProducts),
                note: "Publicação definida pelo produtor, incluindo os itens fora da vitrine.",
              },
              {
                label: "Produtos na vitrine",
                value: number(data.metrics.visibleProducts),
                note: "Publicado, categoria ativa e loja elegível para aparecer no site.",
              },
              {
                label: "Produtos em rascunho",
                value: number(data.metrics.draftProducts),
                note: "Itens que ainda não foram publicados.",
              },
              {
                label: "Lojas e categorias ativas",
                value:
                  number(data.metrics.activeStores) +
                  " / " +
                  number(data.metrics.activeCategories),
                note: "Lojas com situação ativa / categorias ativas no catálogo.",
              },
            ]}
          />
          <section
            className="admin-card admin-ops-records"
            aria-labelledby="catalog-records-title"
          >
            <div className="admin-ops-records-heading">
              <h2 id="catalog-records-title">
                {data.view === "products"
                  ? "Produtos cadastrados"
                  : data.view === "stores"
                    ? "Lojas cadastradas"
                    : "Categorias do catálogo"}
              </h2>
              <span>{number(data.pagination.total)} registros</span>
              {data.view === "categories" &&
                access.role === "platform_super_admin" && (
                  <button
                    type="button"
                    className="admin-secondary"
                    onClick={() => onNavigate("/admin/categorias")}
                  >
                    Organizar categorias <ArrowUpRight size={15} />
                  </button>
                )}
            </div>
            {data.pagination.total === 0 ? (
              <p className="admin-empty">
                Nenhum registro corresponde a esta busca e aos filtros
                selecionados.
              </p>
            ) : data.view === "products" ? (
              <OperationsTable label="Produtos do catálogo">
                <thead>
                  <tr>
                    <th>Produto e categoria</th>
                    <th>Loja</th>
                    <th>Preço vigente</th>
                    <th>Publicação e vitrine</th>
                    <th>Atualização</th>
                  </tr>
                </thead>
                <tbody>
                  {data.products.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Produto e categoria">
                        <strong>{item.title}</strong>
                        <small>
                          {item.categoryName}
                          {!item.categoryActive && " · Categoria inativa"}
                        </small>
                      </td>
                      <td data-label="Loja">
                        {item.storeName}
                        <small>{storeLabels[item.storeStatus]}</small>
                      </td>
                      <td data-label="Preço vigente">
                        {item.priceCents === null
                          ? "Sem preço vigente"
                          : money(item.priceCents)}
                      </td>
                      <td data-label="Publicação e vitrine">
                        <span
                          className={
                            "admin-ops-status " +
                            (item.isVisible ? "status-approved" : "")
                          }
                        >
                          {item.isPublished ? "Publicado" : "Rascunho"}
                        </span>
                        <small>
                          {item.isVisible
                            ? "Visível na vitrine"
                            : item.isPublished
                              ? "Fora da vitrine: loja ou categoria indisponível"
                              : "Ainda não aparece na vitrine"}
                        </small>
                      </td>
                      <td data-label="Atualização">
                        <time dateTime={item.updatedAt}>
                          {when(item.updatedAt)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </OperationsTable>
            ) : data.view === "stores" ? (
              <OperationsTable label="Lojas do catálogo">
                <thead>
                  <tr>
                    <th>Loja</th>
                    <th>Situação</th>
                    <th>Produtos</th>
                    <th>Vitrine</th>
                    <th>Atualização</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stores.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Loja">
                        <strong>{item.name}</strong>
                        <small>{item.slug}</small>
                      </td>
                      <td data-label="Situação">
                        <span className="admin-ops-status">
                          {storeLabels[item.status]}
                        </span>
                      </td>
                      <td data-label="Produtos">
                        {number(item.productCount)} cadastrados
                        <small>
                          {number(item.publishedProductCount)} publicados
                        </small>
                      </td>
                      <td data-label="Vitrine">
                        {item.isVisible ? "Visível no site" : "Fora da vitrine"}
                      </td>
                      <td data-label="Atualização">
                        <time dateTime={item.updatedAt}>
                          {when(item.updatedAt)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </OperationsTable>
            ) : (
              <OperationsTable label="Categorias do catálogo">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Situação</th>
                    <th>Produtos cadastrados</th>
                    <th>Produtos publicados</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categories.map((item) => (
                    <tr key={item.id}>
                      <td data-label="Categoria">
                        <strong>{item.name}</strong>
                      </td>
                      <td data-label="Situação">
                        <span
                          className={
                            "admin-ops-status " +
                            (item.isActive ? "status-approved" : "")
                          }
                        >
                          {item.isActive ? "Ativa" : "Inativa"}
                        </span>
                      </td>
                      <td data-label="Produtos cadastrados">
                        {number(item.productCount)}
                      </td>
                      <td data-label="Produtos publicados">
                        {number(item.publishedProductCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </OperationsTable>
            )}
            <OperationsPagination
              pagination={data.pagination}
              loading={query.loading}
              onPage={(page) => setFilters((value) => ({ ...value, page }))}
            />
          </section>
          <p className="admin-ops-freshness">
            Atualizado em {when(data.generatedAt)}. Atualização automática a
            cada 30 segundos enquanto esta tela estiver aberta. Os indicadores
            abrangem todo o catálogo; os filtros restringem a lista.
          </p>
        </>
      )}
    </section>
  );
}

export default AdminCatalogPage;
