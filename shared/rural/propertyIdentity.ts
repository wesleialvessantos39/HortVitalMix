export function normalizePropertyToken(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function propertyIdentityKey(input: {
  producerId: string;
  registrationNumber?: unknown;
  propertyName?: unknown;
  municipality?: unknown;
  lineVicinal?: unknown;
}) {
  const registration = normalizePropertyToken(input.registrationNumber);
  if (registration.length >= 4)
    return input.producerId + ":registro:" + registration;
  const name = normalizePropertyToken(input.propertyName);
  const city = normalizePropertyToken(input.municipality);
  const line = normalizePropertyToken(input.lineVicinal);
  if (name.length < 3 || city.length < 3) return null;
  return input.producerId + ":nome:" + name + ":" + city + ":" + line;
}
