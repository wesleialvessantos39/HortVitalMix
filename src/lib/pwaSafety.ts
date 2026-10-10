import { hasPendingApiMutations, hasPendingSessionChanges } from "./api";
import { hasOfflineWork, hasPendingOfflineWrites } from "./offlineDb";
import { pwaOperationBlockReason, pwaTransitionHeld } from "./pwaTransition";

const safeRoutes = new Set([
  "/",
  "/aplicativos",
  "/instalar/android",
  "/instalar/ios",
  "/produtos",
  "/produtores",
  "/sobre",
  "/conta",
  "/conta/atualizacoes",
  "/planos",
  "/assinaturas",
  "/assinaturas/minhas",
  "/produtor/assinaturas",
  "/admin/assinaturas",
  "/admin/avaliacoes",
  "/admin/politica-reembolso",
  "/admin/painel",
  "/admin/departamentos",
  "/admin/catalogo",
  "/admin/financeiro",
  "/admin/aplicativos",
]);
const dirtyForms = new WeakSet<HTMLFormElement>();
let uncontainedEdit = false;
let context = { path: "", loading: true, userId: "", role: "" };
let revision = 0;
let started = false;
const visible = (element: Element) => element.getClientRects().length > 0;

export function setPwaSafetyContext(
  path: string,
  loading: boolean,
  userId = "",
  role = "",
) {
  if (context.path !== path) uncontainedEdit = false;
  if (
    context.path !== path ||
    context.loading !== loading ||
    context.userId !== userId ||
    context.role !== role
  )
    revision++;
  context = { path, loading, userId, role };
}
export function appUpdateBlockReason(path = context.path): string | null {
  if (!navigator.onLine) return "Conecte-se à internet para atualizar.";
  if (context.loading) return "Aguarde a verificação da sessão.";
  if (!safeRoutes.has(path))
    return "A atualização será aplicada automaticamente ao concluir esta atividade.";
  if (
    hasPendingApiMutations() ||
    hasPendingSessionChanges() ||
    hasPendingOfflineWrites()
  )
    return "Aguarde a conclusão da operação em andamento.";
  const blocked = pwaOperationBlockReason();
  if (blocked) return blocked;
  if (
    [
      ...document.querySelectorAll(
        "dialog[open], [aria-modal='true'], [data-hvm-update-busy='true']",
      ),
    ].some(visible)
  )
    return "Conclua a operação da janela aberta.";
  if (
    [...document.querySelectorAll<HTMLInputElement>("input[type='file']")].some(
      (input) => Boolean(input.files?.length),
    )
  )
    return "Conclua o envio dos arquivos antes de atualizar.";
  if (
    uncontainedEdit ||
    [...document.forms].some(
      (form) => dirtyForms.has(form) || form.dataset.hvmUpdateDirty === "true",
    )
  )
    return "Salve ou conclua as alterações antes de atualizar.";
  const focused = document.activeElement;
  if (
    focused instanceof HTMLElement &&
    focused.matches(
      "input:not([type='button']):not([type='submit']), textarea, select, [contenteditable='true']",
    )
  )
    return "Conclua o preenchimento antes de atualizar.";
  return null;
}
export async function inspectPwaSafety() {
  const currentRevision = revision;
  const reason = appUpdateBlockReason();
  if (reason) return reason;
  try {
    if (await hasOfflineWork())
      return "Sincronize ou resolva as ações salvas sem internet antes de atualizar.";
  } catch {
    return "Não foi possível verificar as ações offline. Sua versão atual foi preservada.";
  }
  if (currentRevision !== revision)
    return "A atividade mudou. A atualização aguardará um momento seguro.";
  return appUpdateBlockReason();
}
export function startPwaSafety() {
  if (started) return;
  started = true;
  const edited = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest("[data-hvm-pwa-ui]"))
      return;
    const form = target.closest("form");
    if (form) dirtyForms.add(form);
    else if (
      target.matches("input, textarea, select, [contenteditable='true']")
    )
      uncontainedEdit = true;
    revision++;
  };
  const saved = (event: Event) => {
    if (event.target instanceof HTMLFormElement) {
      dirtyForms.delete(event.target);
      delete event.target.dataset.hvmUpdateDirty;
      revision++;
    }
  };
  document.addEventListener("input", edited, true);
  document.addEventListener("change", edited, true);
  document.addEventListener("reset", saved, true);
  document.addEventListener("hvm:form-saved", saved, true);
  // Freeze only during the bounded all-tab activation vote; never during a
  // user's operation. API/IndexedDB writes wait on the same transition lease.
  for (const name of [
    "pointerdown",
    "click",
    "keydown",
    "beforeinput",
    "submit",
  ]) {
    document.addEventListener(
      name,
      (event) => {
        if (!pwaTransitionHeld()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
  }
}
