import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchCoverage,
  fetchMunicipalities,
  type LocalityCoverage,
  type Municipality,
} from "../services/LocalityCatalogService";
import {
  localityLabel,
  readStoredLocality,
  subscribeLocality,
  writeStoredLocality,
  type StoredLocality,
} from "../lib/localityStore";

export type UseLocalityResult = {
  /** Somente municípios ATIVOS — é o que a vitrine pode oferecer. */
  municipalities: Municipality[];
  selected: StoredLocality | null;
  label: string | null;
  coverage: LocalityCoverage | null;
  loading: boolean;
  unavailable: boolean;
  select: (municipality: Municipality | null) => void;
  isActive: (municipalityId: string) => boolean;
};

/**
 * Localidade da vitrine. Funciona sem sessão e continua valendo com sessão
 * (item 4): a região escolhida aqui não é derivada do login.
 *
 * Regra de vida da escolha guardada: se o município continua ATIVO a escolha
 * permanece; se o município foi bloqueado ou excluído do catálogo, a escolha
 * é mantida para que o sistema mostre a mensagem correta e impeça operação
 * silenciosa em uma região sem cobertura.
 */
export function useLocality(): UseLocalityResult {
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [selected, setSelected] = useState<StoredLocality | null>(() =>
    readStoredLocality(),
  );
  const [blockedSelection, setBlockedSelection] =
    useState<{selection:StoredLocality;coverage:LocalityCoverage} | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => subscribeLocality(setSelected), []);

  useEffect(() => {
    let cancelled = false;
    const refresh=()=>{
    if(document.visibilityState=== "hidden")return;
    void fetchMunicipalities()
      .then(async (result) => {
        if (cancelled) return;
        setMunicipalities(result.municipalities);
        setUnavailable(false);
        const stored = readStoredLocality();
        if (!stored) {
          setBlockedSelection(null);
          return;
        }
        if (result.activeMunicipalityIds.includes(stored.municipalityId)) {
          setBlockedSelection(null);
          return;
        }
        const replacement=result.municipalities.find(m=>m.state===stored.state && m.name.localeCompare(stored.name,"pt-BR",{sensitivity:"base"})===0);
        if(replacement?.isActive){writeStoredLocality({municipalityId:replacement.id,name:replacement.name,state:replacement.state});setBlockedSelection(null);return;}
        // Fora da lista ativa: pode estar desativado (mantém para avisar) ou
        // ter saído do catálogo (descarta).
        try {
          const resolution = await fetchCoverage(stored.state, stored.name);
          if (cancelled) return;
          if (resolution.coverage !== "active") {
            setBlockedSelection({selection:stored,coverage:resolution.coverage});
            return;
          }
        } catch {
          // Sem resposta do servidor a escolha é preservada.
          if (cancelled) return;
          setBlockedSelection(null);
          return;
        }
        if (cancelled) return;
        setBlockedSelection(null);

      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    };refresh();const timer=window.setInterval(refresh,15000);window.addEventListener("focus",refresh);
    return ()=>{cancelled=true;window.clearInterval(timer);window.removeEventListener("focus",refresh);};
  }, []);

  const select = useCallback((municipality: Municipality | null) => {
    setBlockedSelection(null);
    writeStoredLocality(
      municipality
        ? {
            municipalityId: municipality.id,
            name: municipality.name,
            state: municipality.state,
          }
        : null,
    );
  }, []);

  const coverage = useMemo<LocalityCoverage | null>(() => {
    if (!selected) return null;
    if (
      blockedSelection &&
      blockedSelection.selection.municipalityId === selected.municipalityId
    )
      return blockedSelection.coverage;
    const match = municipalities.find(
      (row) => row.id === selected.municipalityId,
    );
    return match && match.isActive ? "active" : "unknown";
  }, [municipalities, selected, blockedSelection]);

  const isActive = useCallback(
    (municipalityId: string) =>
      municipalities.some((row) => row.id === municipalityId && row.isActive),
    [municipalities],
  );

  return {
    municipalities,
    selected,
    label: localityLabel(selected),
    coverage,
    loading,
    unavailable,
    select,
    isActive,
  };
}
