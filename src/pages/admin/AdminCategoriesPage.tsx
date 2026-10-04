import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ApiFailure } from "../../lib/api";
import { cryptoRandomUUID } from "../../lib/uuid";
import {
  AdminCategoriesResponseSchema,
  CategoryImpactSchema,
  CategoryMutationResponseSchema,
  type Category,
  type CategoryImpact,
  type CreateCategory,
  type CategoryFields,
} from "../../../shared/contracts/category";
import type { AdminVerifySessionResponse } from "../../../shared/contracts/adminGovernance";
import { CategoryIcon } from "../../components/categories/CategoryIcon";
import { CategoryEditor } from "./categories/CategoryEditor";
import "./categories/categories-admin.css";

type Props = {
  access: AdminVerifySessionResponse;
  onNavigate: (to: string) => void;
};
const messages: Record<string, string> = {
  CATEGORY_SLUG_CONFLICT:
    "Este slug já pertence a outra categoria. Escolha um identificador único.",
  CATEGORY_REVISION_CONFLICT:
    "Esta categoria mudou em outra sessão. Sua edição foi preservada. Recarregue a categoria antes de tentar novamente.",
  CATEGORY_CYCLE_FORBIDDEN:
    "A categoria superior escolhida criaria um ciclo. Escolha outra categoria superior.",
  CATEGORY_PARENT_NOT_FOUND:
    "A categoria superior não está disponível. Atualize a lista e escolha outra.",
  CATEGORY_NOT_FOUND: "Esta categoria não está disponível. Atualize a lista.",
  CATEGORY_COMMAND_CONFLICT:
    "A operação não corresponde à tentativa anterior. Atualize a categoria antes de tentar novamente.",
  CATEGORY_IMPACT_CONFIRMATION_REQUIRED:
    "O impacto mudou. Confira o relatório atualizado e confirme novamente.",
  CATEGORY_ALREADY_INACTIVE: "A categoria já está inativa. Atualize a lista.",
  CATEGORY_ALREADY_ACTIVE: "A categoria já está ativa. Atualize a lista.",
  FORBIDDEN: "A gestão de categorias exige uma conta de Super Admin ativa.",
};

export default function AdminCategoriesPage({ access, onNavigate }: Props) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = useState<Category | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reauth, setReauth] = useState(false);
  const [pending, setPending] = useState<{
    category: Category;
    impact: CategoryImpact;
  } | null>(null);
  const [confirmedImpact, setConfirmedImpact] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const superAdmin = access.role === "platform_super_admin";
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = AdminCategoriesResponseSchema.parse(
        await api<unknown>("/v1/admin/categories", { signal }),
      );
      if (signal?.aborted) return null;
      setCategories(result.categories);
      setState("ready");
      return result.categories;
    } catch {
      if (!signal?.aborted) {
        setState("error");
        setError("Não foi possível carregar as categorias. Tente novamente.");
      }
      return null;
    }
  }, []);
  useEffect(() => {
    if (!superAdmin) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, superAdmin]);
  useEffect(() => {
    if (pending) dialog.current?.showModal();
    else dialog.current?.close();
  }, [pending]);
  function failure(value: unknown) {
    const code = (value as ApiFailure).message;
    if (
      [
        "REAUTH_REQUIRED",
        "ADMIN_REAUTHENTICATION_REQUIRED",
        "SESSION_REQUIRED",
      ].includes(code)
    ) {
      setReauth(true);
      setError(
        "Confirme novamente sua sessão administrativa para salvar. Sua edição foi preservada.",
      );
    } else
      setError(
        messages[code] ??
          "Não foi possível concluir a operação. Sua edição foi preservada; tente novamente.",
      );
  }
  function select(category: Category | null) {
    setEditing(category);
    setEditorVersion((n) => n + 1);
    setError("");
    setNotice("");
  }
  async function refreshEditor() {
    setBusy(true);
    setError("");
    const rows = await load();
    if (rows) {
      setEditing(rows.find((row) => row.id === editing?.id) ?? null);
      setEditorVersion((n) => n + 1);
    }
    setBusy(false);
  }
  async function save(input: CreateCategory | CategoryFields) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = CategoryMutationResponseSchema.parse(
        await api<unknown>(
          editing
            ? `/v1/admin/categories/${editing.id}`
            : "/v1/admin/categories",
          { method: editing ? "PATCH" : "POST", body: JSON.stringify(input) },
        ),
      );
      setEditing(result.category);
      setEditorVersion((n) => n + 1);
      setNotice("Categoria salva. A alteração foi registrada na auditoria.");
      dispatchEvent(new Event("hvm:categories-changed"));
      await load();
    } catch (value) {
      failure(value);
    } finally {
      setBusy(false);
    }
  }
  async function askDeactivate(category: Category) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const impact = CategoryImpactSchema.parse(
        await api<unknown>(`/v1/admin/categories/${category.id}/impact`),
      );
      setConfirmedImpact(false);
      setPending({ category, impact });
    } catch (value) {
      failure(value);
    } finally {
      setBusy(false);
    }
  }
  async function changeState(category: Category, deactivate: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = CategoryMutationResponseSchema.parse(
        await api<unknown>(
          `/v1/admin/categories/${category.id}/${deactivate ? "deactivate" : "reactivate"}`,
          {
            method: "POST",
            body: JSON.stringify({
              expectedRevision: deactivate
                ? pending!.impact.revision
                : category.revision,
              commandId: cryptoRandomUUID(),
              ...(deactivate ? { confirmImpact: confirmedImpact } : {}),
            }),
          },
        ),
      );
      setEditing((current) =>
        current?.id === result.category.id
          ? {
              ...current,
              revision: result.category.revision,
              isActive: result.category.isActive,
            }
          : current,
      );
      setPending(null);
      setNotice(
        `Categoria ${deactivate ? "desativada" : "reativada"}. A alteração foi registrada na auditoria.`,
      );
      dispatchEvent(new Event("hvm:categories-changed"));
      await load();
      refreshButton.current?.focus();
    } catch (value) {
      failure(value);
      if (
        (value as ApiFailure).message ===
        "CATEGORY_IMPACT_CONFIRMATION_REQUIRED"
      ) {
        try {
          const impact = CategoryImpactSchema.parse(
            await api<unknown>(`/v1/admin/categories/${category.id}/impact`),
          );
          setPending({ category, impact });
          setConfirmedImpact(false);
        } catch (next) {
          failure(next);
        }
      }
    } finally {
      setBusy(false);
    }
  }
  if (!superAdmin)
    return (
      <section className="admin-page">
        <p role="alert">
          A gestão de categorias exige uma conta de Super Admin.
        </p>
      </section>
    );
  const parents = new Map(
    categories.map((category) => [category.id, category.name]),
  );
  return (
    <section className="admin-page hvm-category-admin">
      <header className="admin-page-header">
        <div>
          <h1>Categorias</h1>
          <p>Organize as categorias globais e sua ordem na vitrine.</p>
        </div>
        <button
          ref={refreshButton}
          className="admin-secondary"
          disabled={busy}
          onClick={() => void refreshEditor()}
        >
          {editing ? "Recarregar categoria" : "Atualizar lista"}
        </button>
      </header>
      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="admin-success" role="status">
          {notice}
        </p>
      )}
      {reauth && (
        <button
          className="admin-primary"
          onClick={() =>
            onNavigate("/entrar/super-administrador?reason=reauth")
          }
        >
          Confirmar sessão administrativa
        </button>
      )}
      <CategoryEditor
        key={`${editing?.id ?? "new"}:${editorVersion}`}
        category={editing}
        categories={categories}
        busy={busy}
        onSave={save}
        onCancel={() => select(null)}
      />
      <section className="admin-card" aria-busy={state === "loading"}>
        <h2>Catálogo global</h2>
        {state === "loading" && <p role="status">Carregando categorias…</p>}
        {state === "ready" && categories.length === 0 && (
          <p>Nenhuma categoria cadastrada.</p>
        )}
        <ul className="hvm-category-list">
          {categories.map((category) => (
            <li key={category.id}>
              <span className="hvm-category-list-icon">
                <CategoryIcon name={category.iconName} />
              </span>
              <div className="hvm-category-list-details">
                <strong>{category.name}</strong>
                <span>
                  {category.slug} · Ordem {category.displayOrder}
                </span>
                <small>
                  {category.parentId
                    ? `Superior: ${parents.get(category.parentId) ?? "Indisponível"}`
                    : "Categoria principal"}
                </small>
                <span
                  className={`hvm-category-badge ${category.isActive ? "active" : "inactive"}`}
                >
                  {category.isActive ? "Ativa" : "Inativa"}
                </span>
              </div>
              <div className="hvm-category-actions">
                <button
                  className="admin-secondary"
                  disabled={busy}
                  aria-label={`Editar ${category.name}`}
                  onClick={() => select(category)}
                >
                  Editar
                </button>
                <button
                  className="admin-secondary"
                  disabled={busy}
                  aria-label={`${category.isActive ? "Desativar" : "Reativar"} ${category.name}`}
                  onClick={() =>
                    void (category.isActive
                      ? askDeactivate(category)
                      : changeState(category, false))
                  }
                >
                  {category.isActive ? "Desativar" : "Reativar"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <dialog
        ref={dialog}
        className="hvm-category-dialog"
        aria-labelledby="hvm-category-impact-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setPending(null);
        }}
      >
        {pending && (
          <>
            <h2 id="hvm-category-impact-title">
              Desativar {pending.category.name}?
            </h2>
            <p>Esta categoria deixará de aparecer na vitrine.</p>
            <dl>
              <div>
                <dt>Produtos ativos vinculados</dt>
                <dd>{pending.impact.activeProducts}</dd>
              </div>
              <div>
                <dt>Subcategorias ativas</dt>
                <dd>{pending.impact.activeChildren}</dd>
              </div>
            </dl>
            {pending.impact.activeChildren > 0 && (
              <p>
                As subcategorias continuarão ativas e aparecerão como categorias
                principais. A hierarquia será restaurada ao reativar esta
                categoria.
              </p>
            )}
            {pending.impact.requiresConfirmation && (
              <label className="hvm-category-confirm">
                <input
                  type="checkbox"
                  checked={confirmedImpact}
                  disabled={busy}
                  onChange={(event) => setConfirmedImpact(event.target.checked)}
                />
                Conferi o impacto e confirmo a desativação.
              </label>
            )}
            {error && (
              <p className="admin-error" role="alert">
                {error}
              </p>
            )}
            <div className="hvm-category-actions">
              <button
                className="admin-secondary"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                Cancelar
              </button>
              <button
                className="admin-primary"
                disabled={
                  busy ||
                  (pending.impact.requiresConfirmation && !confirmedImpact)
                }
                onClick={() => void changeState(pending.category, true)}
              >
                {busy ? "Desativando…" : "Confirmar desativação"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </section>
  );
}
