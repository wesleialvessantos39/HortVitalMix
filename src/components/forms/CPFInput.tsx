import { formatCpf } from "../../../shared/utils/normalization";

export function CPFInput({ error }: { error?: string }) {
  return <label>CPF<input name="cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" maxLength={14}
    onInput={(event) => { event.currentTarget.value = formatCpf(event.currentTarget.value); }}
    aria-invalid={Boolean(error)} aria-describedby={error ? "cpf-error" : undefined} required />
    {error && <small id="cpf-error" className="field-error" role="alert">{error}</small>}
  </label>;
}
