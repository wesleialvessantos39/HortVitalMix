export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeCpf(value: string): string {
  return onlyDigits(value).slice(0, 11);
}

export function formatCpf(value: string): string {
  const digits = normalizeCpf(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return digits.slice(0, 3) + "." + digits.slice(3);
  if (digits.length <= 9)
    return digits.slice(0, 3) + "." + digits.slice(3, 6) + "." + digits.slice(6);
  return digits.slice(0, 3) + "." + digits.slice(3, 6) + "." + digits.slice(6, 9) + "-" + digits.slice(9);
}

function localBrazilMobileDigits(value: string): string {
  const digits = onlyDigits(value);
  if (digits.length >= 12 && digits.startsWith("55")) return digits.slice(2, 13);
  return digits.slice(0, 11);
}

export function formatBrazilMobile(value: string): string {
  const digits = localBrazilMobileDigits(value);
  if (!digits) return "";
  if (digits.length <= 2) return "(" + digits;
  if (digits.length <= 7) return "(" + digits.slice(0, 2) + ") " + digits.slice(2);
  return "(" + digits.slice(0, 2) + ") " + digits.slice(2, 7) + "-" + digits.slice(7);
}

export function normalizeBrazilMobile(value: string): string {
  const local = localBrazilMobileDigits(value);
  return local.length === 11 ? "+55" + local : value.trim();
}
