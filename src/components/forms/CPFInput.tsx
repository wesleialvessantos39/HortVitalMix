import { formatCpf } from "../../../shared/utils/normalization";

type CPFInputProps = {
  error?: string;
  value?: string;
  onChange?: (value: string) => void;
  label?: string;
  required?: boolean;
};

export function CPFInput({ error, value, onChange, label="CPF", required=true }: CPFInputProps) {
  const controlled = value !== undefined && onChange;
  return <label>{label}<input
    name="cpf"
    inputMode="numeric"
    autoComplete="off"
    placeholder="000.000.000-00"
    maxLength={14}
    {...(controlled ? { value } : {})}
    onInput={(event) => {
      const formatted = formatCpf(event.currentTarget.value);
      if (controlled) onChange?.(formatted);
      else event.currentTarget.value = formatted;
    }}
    aria-invalid={Boolean(error)}
    aria-describedby={error ? "cpf-error" : undefined}
    required={required}
  />
    {error && <small id="cpf-error" className="field-error" role="alert">{error}</small>}
  </label>;
}
