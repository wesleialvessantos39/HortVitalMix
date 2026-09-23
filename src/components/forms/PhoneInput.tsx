import { formatBrazilMobile } from "../../../shared/utils/normalization";

type PhoneInputProps = {
  error?: string;
  value?: string;
  onChange?: (value: string) => void;
};

export function PhoneInput({ error, value, onChange }: PhoneInputProps) {
  const controlled = value !== undefined && onChange;
  return <label>Celular com DDD<input
    name="phone"
    type="tel"
    inputMode="numeric"
    autoComplete="tel-national"
    placeholder="(00) 00000-0000"
    maxLength={15}
    {...(controlled ? { value } : {})}
    onInput={(event) => {
      const formatted = formatBrazilMobile(event.currentTarget.value);
      if (controlled) onChange?.(formatted);
      else event.currentTarget.value = formatted;
    }}
    aria-invalid={Boolean(error)}
    aria-describedby={error ? "phone-error" : undefined}
    required
  />
    {error && <small id="phone-error" className="field-error" role="alert">{error}</small>}
  </label>;
}
