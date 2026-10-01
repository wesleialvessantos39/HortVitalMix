/**
 * Localidade escolhida pelo visitante.
 *
 * A escolha vive no navegador (localStorage) e NÃO depende de sessão: visitante
 * sem login, consumidor, produtor, Administrador e Super administrador trocam a
 * região que estão vendo do mesmo jeito (item 4 do proprietário).
 */

export const LOCALITY_STORAGE_KEY = "hvm.locality.v1";
export const LOCALITY_EVENT = "hvm:locality-changed";

export type StoredLocality = {
  municipalityId: string;
  name: string;
  state: string;
};

const listeners = new Set<(locality: StoredLocality | null) => void>();

function isLocality(value: unknown): value is StoredLocality {
  const candidate = value as Partial<StoredLocality> | null;
  return Boolean(
    candidate &&
      typeof candidate.municipalityId === "string" &&
      /^[0-9a-f-]{36}$/i.test(candidate.municipalityId) &&
      typeof candidate.name === "string" &&
      candidate.name.length > 0 &&
      typeof candidate.state === "string" &&
      candidate.state.length === 2,
  );
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readStoredLocality(): StoredLocality | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(LOCALITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isLocality(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredLocality(locality: StoredLocality | null) {
  const store = storage();
  try {
    if (locality) store?.setItem(LOCALITY_STORAGE_KEY, JSON.stringify(locality));
    else store?.removeItem(LOCALITY_STORAGE_KEY);
  } catch {
    // Armazenamento indisponível (modo privado): a sessão segue em memória.
  }
  for (const listener of listeners) listener(locality);
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(LOCALITY_EVENT, { detail: locality }));
}

export function subscribeLocality(
  listener: (locality: StoredLocality | null) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Rótulo pronto para a vitrine: "Ariquemes – RO". */
export function localityLabel(locality: StoredLocality | null) {
  return locality ? `${locality.name} – ${locality.state}` : null;
}
