import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Package } from "lucide-react";
import { api } from "../../lib/api";
import {
  PublicCategoriesResponseSchema,
  flattenCategories,
  type Category,
} from "../../../shared/contracts/category";
import { CategoryIcon } from "../categories/CategoryIcon";
import "../categories/categories.css";

type Props = {
  selectedId: string | null;
  onSelect: (category: Category | null) => void;
  onSelectionRefresh: (category: Category | null) => void;
};

export function CategoryNavSection({
  selectedId,
  onSelect,
  onSelectionRefresh,
}: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let controller: AbortController | null = null;
    let stopped = false;
    const load = async (initial = false) => {
      if ((!initial && document.hidden) || controller) return;
      controller = new AbortController();
      try {
        const result = PublicCategoriesResponseSchema.parse(
          await api<unknown>("/v1/categories", { signal: controller.signal }),
        );
        if (stopped) return;
        setCategories(flattenCategories(result.categories));
        setState("ready");
      } catch {
        if (!stopped) setState("error");
      } finally {
        controller = null;
      }
    };
    void load(true);
    const timer = window.setInterval(() => void load(), 30000);
    const refresh = () => void load();
    addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    addEventListener("hvm:categories-changed", refresh);
    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(timer);
      removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      removeEventListener("hvm:categories-changed", refresh);
    };
  }, [retry]);
  useEffect(() => {
    if (state === "ready")
      onSelectionRefresh(
        categories.find((row) => row.id === selectedId) ?? null,
      );
  }, [categories, state, selectedId, onSelectionRefresh]);
  const retryLoad = useCallback(() => {
    setState("loading");
    setRetry((n) => n + 1);
  }, []);

  return (
    <section
      className="card categories hvm-category-nav"
      aria-busy={state === "loading"}
    >
      <h2>Categorias</h2>
      <nav aria-label="Categorias de produtos">
        <button
          aria-pressed={selectedId === null}
          onClick={() => onSelect(null)}
        >
          <span className="category-icon">
            <Package size={22} />
          </span>
          <span>Todos os produtos</span>
          <ChevronRight className="chevron" size={14} />
        </button>
        {state === "loading" &&
          Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className="hvm-category-skeleton"
              aria-hidden="true"
            />
          ))}
        {state !== "loading" &&
          categories.map((category) => (
            <button
              key={category.id}
              aria-pressed={selectedId === category.id}
              onClick={() => onSelect(category)}
              title={category.description ?? undefined}
            >
              <span className="category-icon">
                <CategoryIcon name={category.iconName} />
              </span>
              <span>{category.name}</span>
              <ChevronRight className="chevron" size={14} />
            </button>
          ))}
      </nav>
      {state === "loading" && (
        <span className="hvm-category-status" role="status">
          Carregando categorias…
        </span>
      )}
      {state === "error" && (
        <p className="hvm-category-status" role="status">
          Não foi possível atualizar as categorias.{" "}
          <button onClick={retryLoad}>Tentar novamente</button>
        </p>
      )}
      {state === "ready" && categories.length === 0 && (
        <p className="hvm-category-status" role="status">
          Nenhuma categoria disponível no momento.
        </p>
      )}
    </section>
  );
}
