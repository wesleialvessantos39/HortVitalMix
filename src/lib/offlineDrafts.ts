import { offlineTransaction } from "./offlineDb";
import {
  assertOfflineIdentity,
  currentOfflineIdentity,
  type OfflineIdentity,
} from "./portalOffline";

export type DraftField = { locator: string; value: string; checked?: boolean };
type Draft = {
  key: string;
  scope: string;
  path: string;
  fields: DraftField[];
  savedAt: number;
};
const fields = (form: HTMLFormElement) =>
  Array.from(
    form.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >("input,textarea,select"),
  ).filter(
    (el) =>
      !el.disabled &&
      !el.matches(
        "[readonly],[type=password],[type=file],[type=hidden],[type=submit],[type=button],[autocomplete='one-time-code'],[data-offline-exclude]",
      ) &&
      !/password|token|secret|otp|mfa|apiKey/i.test(el.name + el.id) &&
      !el.closest("[data-hvm-pwa-ui]"),
  );
function formKey(form: HTMLFormElement) {
  return (
    form.id ||
    form.getAttribute("aria-label") ||
    form.querySelector("h1,h2,h3,legend")?.textContent?.trim() ||
    fields(form)
      .map(
        (el, i) =>
          el.name || el.id || `${el.tagName}:${el.getAttribute("type")}:${i}`,
      )
      .join("|")
  );
}
const locator = (
  el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  index: number,
) =>
  el instanceof HTMLInputElement &&
  ["radio", "checkbox"].includes(el.type) &&
  el.name
    ? `${el.name}:${el.type}:${el.value}`
    : el.name || el.id || `${el.tagName}:${el.getAttribute("type")}:${index}`;
const formValues = (form: HTMLFormElement) =>
  fields(form).map((el, i) => ({
    locator: locator(el, i),
    value: el.value,
    ...(el instanceof HTMLInputElement &&
    ["checkbox", "radio"].includes(el.type)
      ? { checked: el.checked }
      : {}),
  }));
export function captureSubmittedDraft(owner: OfflineIdentity) {
  const focused = document.activeElement?.closest("form");
  const form =
    focused instanceof HTMLFormElement
      ? focused
      : document.forms.length === 1
        ? document.forms[0]
        : null;
  return form && !form.closest("[data-hvm-pwa-ui]")
    ? {
        draftKey: `${owner.scope}:${location.pathname}:${formKey(form)}`,
        draftFields: formValues(form),
      }
    : {};
}
export async function acknowledgeSubmittedDraft(row: {
  scope: string;
  draftKey?: string;
  draftFields?: DraftField[];
}) {
  if (!row.draftKey || !row.draftFields) return;
  const values = JSON.stringify(row.draftFields);
  await offlineTransaction<void>(
    ["portal_drafts"],
    "readwrite",
    (tx, finish) => {
      const store = tx.objectStore("portal_drafts"),
        r = store.get(row.draftKey!);
      r.onsuccess = () => {
        if (
          r.result?.scope === row.scope &&
          JSON.stringify(r.result.fields) === values
        )
          store.delete(row.draftKey!);
        finish();
      };
    },
  );
  if (currentOfflineIdentity()?.scope !== row.scope) return;
  for (const form of Array.from(document.forms)) {
    const key = `${row.scope}:${location.pathname}:${formKey(form)}`;
    if (key === row.draftKey && JSON.stringify(formValues(form)) === values)
      form.dispatchEvent(new Event("hvm:form-saved", { bubbles: true }));
  }
}
async function save(
  form: HTMLFormElement,
  path: string,
  owner: OfflineIdentity,
) {
  const values = formValues(form);
  if (!values.length || JSON.stringify(values).length > 100000) return;
  await offlineTransaction<void>(
    ["portal_drafts"],
    "readwrite",
    (tx, finish) => {
      assertOfflineIdentity(owner);
      tx.objectStore("portal_drafts").put({
        key: `${owner.scope}:${path}:${formKey(form)}`,
        scope: owner.scope,
        path,
        fields: values,
        savedAt: Date.now(),
      } satisfies Draft);
      finish();
    },
  );
}
/** Store values, never HTML, credentials, hidden proofs or permission grants. */
export function mountOfflineDrafts(path: string) {
  const owner = currentOfflineIdentity();
  if (
    !owner ||
    /\/entrar|\/acesso|\/cadastro|\/recuperar|\/confirmar|\/redefinir|\/excluir/.test(
      path,
    )
  )
    return () => {};
  let disposed = false,
    restoring = false;
  const visited = new WeakSet<HTMLFormElement>(),
    edited = new WeakSet<HTMLFormElement>();
  const restore = async () => {
    for (const form of Array.from(document.forms)) {
      if (
        visited.has(form) ||
        form.closest("[data-hvm-pwa-ui]") ||
        !fields(form).length
      )
        continue;
      visited.add(form);
      const key = `${owner.scope}:${path}:${formKey(form)}`;
      const row = await offlineTransaction<Draft | undefined>(
        ["portal_drafts"],
        "readonly",
        (tx, finish) => {
          const r = tx.objectStore("portal_drafts").get(key);
          r.onsuccess = () => finish(r.result);
        },
      ).catch(() => undefined);
      if (
        !row ||
        disposed ||
        edited.has(form) ||
        !form.isConnected ||
        row.scope !== owner.scope ||
        !row.fields.length
      )
        continue;
      try {
        assertOfflineIdentity(owner);
      } catch {
        return;
      }
      restoring = true;
      fields(form).forEach((el, i) => {
        const value =
          row.fields.find((field) => field.locator === locator(el, i)) ??
          (el instanceof HTMLInputElement &&
          ["radio", "checkbox"].includes(el.type)
            ? row.fields.find(
                (field) =>
                  field.locator === el.name && field.value === el.value,
              )
            : undefined);
        if (!value) return;
        const proto =
          el instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : el instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLSelectElement.prototype;
        if (el instanceof HTMLInputElement && value.checked !== undefined) {
          // React tracks checkbox/radio clicks; restoring only the DOM would
          // leave controlled state stale when the next action is submitted.
          if (
            el.checked !== value.checked &&
            (el.type !== "radio" || value.checked)
          )
            el.click();
        } else
          Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(
            el,
            value.value,
          );
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      form.dataset.hvmUpdateDirty = "true";
      restoring = false;
    }
  };
  const edit = (event: Event) => {
    if (restoring || !(event.target instanceof HTMLElement)) return;
    const form = event.target.closest("form");
    if (
      !form ||
      form.closest("[data-hvm-pwa-ui]") ||
      !fields(form).includes(event.target as HTMLInputElement)
    )
      return;
    edited.add(form);
    form.dataset.hvmUpdateDirty = "true";
    void save(form, path, owner).catch(() =>
      window.dispatchEvent(new Event("hvm:offline-storage-error")),
    );
  };
  const clear = (event: Event) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    const form = event.target;
    void offlineTransaction<void>(
      ["portal_drafts"],
      "readwrite",
      (tx, finish) => {
        tx.objectStore("portal_drafts").delete(
          `${owner.scope}:${path}:${formKey(form)}`,
        );
        finish();
      },
    ).catch(() => {});
  };
  const observer = new MutationObserver(() => void restore());
  observer.observe(document.body, { subtree: true, childList: true });
  void restore();
  document.addEventListener("input", edit);
  document.addEventListener("change", edit);
  document.addEventListener("hvm:form-saved", clear);
  document.addEventListener("reset", clear);
  return () => {
    disposed = true;
    observer.disconnect();
    document.removeEventListener("input", edit);
    document.removeEventListener("change", edit);
    document.removeEventListener("hvm:form-saved", clear);
    document.removeEventListener("reset", clear);
  };
}
