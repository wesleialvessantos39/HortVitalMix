import { useRef, useState, type FormEvent } from "react";
import { api, type ApiFailure } from "../../lib/api";
import type { ShellSession } from "../../hooks/useSession";
import {
  ProductMutationResponseSchema,
  type Product,
} from "../../../shared/contracts/product";

export function productErrorMessage(error: unknown) {
  const fault = error as ApiFailure;
  const messages: Record<string, string> = {
    AUTH_REQUIRED: "Sua sessão expirou. Confirme sua senha para continuar.",
    RECENT_AUTH_REQUIRED: "Confirme sua senha para salvar esta alteração.",
    PRODUCT_CREATE_FORBIDDEN_UNVERIFIED_STORE:
      "Sua loja precisa estar ativa e habilitada para cadastrar ou publicar produtos. Confira Minha loja e a aprovação do imóvel.",
    PRODUCT_CATEGORY_INACTIVE:
      "Esta categoria não está ativa. Escolha uma categoria disponível.",
    PRODUCT_PRIMARY_MEDIA_REQUIRED:
      "Adicione uma foto principal antes de publicar o produto.",
    PRODUCT_REVISION_CONFLICT:
      "Este produto mudou em outra sessão. Sua edição foi preservada. Recarregue a versão atual antes de tentar novamente.",
    PRODUCT_COMMAND_CONFLICT:
      "Este comando não pode ser repetido com dados diferentes. Recarregue a versão atual.",
    PRODUCT_UNPUBLISH_BEFORE_MEDIA_REMOVAL:
      "Despublique o produto ou escolha outra foto principal antes de remover esta foto.",
    PRODUCT_MEDIA_UNAVAILABLE:
      "Não foi possível carregar ou salvar as fotos. Tente novamente.",
    PRODUCT_IMAGE_INVALID: "Escolha uma foto JPEG, PNG ou WebP válida.",
    PRODUCT_IMAGE_TOO_LARGE: "A foto deve ter no máximo 2 MB.",
    PRODUCT_MEDIA_LIMIT: "Cada produto pode ter até 6 fotos.",
    PRODUCT_NOT_FOUND: "Este produto não está disponível para sua conta.",
    VALIDATION_ERROR: "Revise os campos do produto antes de salvar.",
  };
  return (
    messages[fault.message] ??
    "Não foi possível concluir agora. Seus dados foram preservados. Tente novamente."
  );
}
export function useProductCommands(
  session: ShellSession,
  onSaved: (product: Product) => void,
) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false),
    [reauth, setReauth] = useState(false),
    [password, setPassword] = useState("");
  const [reauthError, setReauthError] = useState("");
  const ids = useRef(new Map<string, string>()),
    pending = useRef<null | (() => Promise<void>)>(null);
  function command(payload: unknown) {
    const key = JSON.stringify(payload);
    let id = ids.current.get(key);
    if (!id) {
      id = crypto.randomUUID();
      ids.current.set(key, id);
    }
    return id;
  }
  async function execute(
    path: string,
    body: unknown,
    message: string,
    method: "POST" | "PATCH" = "POST",
    file?: File,
  ) {
    const run = async () => {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const result = ProductMutationResponseSchema.parse(
          await api(path, {
            method,
            body: file ?? JSON.stringify(body),
            ...(file ? { headers: { "Content-Type": file.type } } : {}),
          }),
        );
        pending.current = null;
        ids.current.clear();
        setReauth(false);
        setPassword("");
        setConflict(false);
        onSaved(result.product);
        setNotice(message);
      } catch (failure) {
        const fault = failure as ApiFailure;
        if (
          fault.message === "RECENT_AUTH_REQUIRED" ||
          fault.message === "AUTH_REQUIRED"
        ) {
          pending.current = run;
          setReauth(true);
        } else {
          setError(productErrorMessage(fault));
          setConflict(fault.status === 409);
        }
      } finally {
        setBusy(false);
      }
    };
    await run();
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setReauthError("");
    try {
      const restored = await api<ShellSession>("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: session.email,
          password,
          portalRole: "producer",
        }),
      });
      if (restored.userId !== session.userId)
        throw new Error("IDENTITY_MISMATCH");
      window.dispatchEvent(new CustomEvent("hvm:session-changed"));
      setPassword("");
      await pending.current?.();
    } catch {
      setReauthError("Não foi possível confirmar sua senha. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  function clear() {
    setError("");
    setNotice("");
    setConflict(false);
    ids.current.clear();
  }
  return {
    busy,
    error,
    notice,
    conflict,
    reauth,
    password,
    reauthError,
    command,
    execute,
    confirm,
    setPassword,
    invalid: (message: string) => setError(message),
    clear,
    cancelReauth: () => {
      pending.current = null;
      setReauth(false);
      setPassword("");
    },
  };
}
export function ProductCommandFeedback({
  commands,
  onReload,
}: {
  commands: ReturnType<typeof useProductCommands>;
  onReload?: () => void;
}) {
  return (
    <>
      {commands.error && (
        <div className="hvm-product-notice hvm-product-error" role="alert">
          <p>{commands.error}</p>
          {commands.conflict && onReload && (
            <button type="button" className="secondary" onClick={onReload}>
              Recarregar versão atual
            </button>
          )}
        </div>
      )}
      {commands.notice && (
        <p className="hvm-product-notice" role="status">
          {commands.notice}
        </p>
      )}
      {commands.reauth && (
        <form
          className="hvm-product-panel hvm-product-reauth"
          onSubmit={commands.confirm}
          aria-label="Confirmar sessão"
        >
          <h2>Confirme sua senha</h2>
          <p>
            Seu formulário está preservado. Após confirmar, retomamos a
            alteração.
          </p>
          <label>
            Senha atual
            <input
              type="password"
              autoComplete="current-password"
              required
              value={commands.password}
              onChange={(e) => commands.setPassword(e.target.value)}
            />
          </label>
          {commands.reauthError && <p role="alert">{commands.reauthError}</p>}
          <div className="hvm-product-actions">
            <button
              className="primary"
              disabled={commands.busy || !commands.password}
            >
              Confirmar e continuar
            </button>
            <button
              className="secondary"
              type="button"
              onClick={commands.cancelReauth}
              disabled={commands.busy}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </>
  );
}
