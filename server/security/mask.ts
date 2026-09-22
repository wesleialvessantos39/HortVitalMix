export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  if (local.length <= 1) return `*@${domain}`;
  if (local.length === 2) return `${local[0]}*@${domain}`;
  const stars = "*".repeat(Math.max(1, local.length - 2));
  return `${local[0]}${stars}${local[local.length - 1]}@${domain}`;
}

export function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  const cc = digits.slice(0, 2);
  const ddd = digits.slice(2, 4);
  const prefix = digits.slice(4, 5);
  const suffix = digits.slice(-4);
  return `+${cc} (${ddd}) ${prefix}****-${suffix}`;
}

export function maskDestination(channel: "email" | "phone", value: string): string {
  return channel === "email" ? maskEmail(value) : maskPhone(value);
}
