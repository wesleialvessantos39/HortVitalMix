import { formatBrazilMobile } from "../../../shared/utils/normalization";

export function PhoneInput({ error }: { error?: string }) {
  return <label>Celular com DDD<input name="phone" type="tel" inputMode="numeric" autoComplete="tel-national"
    placeholder="(00) 00000-0000" maxLength={15}
    onInput={(event) => { event.currentTarget.value = formatBrazilMobile(event.currentTarget.value); }}
    aria-invalid={Boolean(error)} aria-describedby={error ? "phone-error" : undefined} required />
    {error && <small id="phone-error" className="field-error" role="alert">{error}</small>}
  </label>;
}
