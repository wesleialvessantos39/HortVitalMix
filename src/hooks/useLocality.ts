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
 * permanece; se o Super administrador DESATIVOU o município, a escolha é
 * mantida e a vitrine passa a exibir a mensagem de região desativada (item 2);
 * se o município saiu do catálogo por completo, a escolha é descartada.
 */
export function useLocality(): UseLocalityResult {
  const [municipalities, setMunicipalities] = useState<Municipality[]>([]);
  const [selected, setSelected] = useState<StoredLocality | null>(() =>
    readStoredLocality(),
  );
  const [disabledSelection, setDisabledSelection] =
    useState<StoredLocality | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => subscribeLocality(setSelected), []);

  useEffect(() => {
    let cancelled = false;
    fetchMunicipalities()
      .then(async (result) => {
        if (cancelled) return;
        setMunicipalities(result.municipalities);
        setUnavailable(false);
        const stored = readStoredLocality();
        if (!stored) {
          setDisabledSelection(null);
          return;
        }
        if (result.activeMunicipalityIds.includes(stored.municipalityId)) {
          setDisabledSelection(null);
          return;
        }
        // Fora da lista ativa: pode estar desativado (mantém para avisar) ou
        // ter saído do catálogo (descarta).
        try {
          const resolution = await fetchCoverage(stored.state, stored.name);
          if (cancelled) return;
          if (resolution.coverage === "inactive") {
            setDisabledSelection(stored);
            return;
          }
        } catch {
          // Sem resposta do servidor a escolha é preservada.
          if (cancelled) return;
          setDisabledSelection(null);
          return;
        }
        if (cancelled) return;
        setDisabledSelection(null);
        writeStoredLocality(null);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const select = useCallback((municipality: Municipality | null) => {
    setDisabledSelection(null);
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
      disabledSelection &&
      disabledSelection.municipalityId === selected.municipalityId
    )
      return "inactive";
    const match = municipalities.find(
      (row) => row.id === selected.municipalityId,
    );
    return match && match.isActive ? "active" : null;
  }, [municipalities, selected, disabledSelection]);

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
