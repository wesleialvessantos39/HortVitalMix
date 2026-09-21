export function cryptoRandomUUID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();

  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else {
      const r = Math.floor(Math.random() * 16);
      out += hex[i === 19 ? (r & 0x3) | 0x8 : r];
    }
  }
  return out;
}
