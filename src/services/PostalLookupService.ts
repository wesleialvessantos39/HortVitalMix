type PostalResult = {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export class PostalLookupService {
  static async lookup(raw: string): Promise<PostalResult | null> {
    const cep = raw.replace(/\D/g, "");
    if (!/^\d{8}$/.test(cep)) return null;

    const cacheKey = "hvm:postal:" + cep;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null") as
        | { at: number; data: PostalResult }
        | null;
      if (cached && Date.now() - cached.at < CACHE_TTL_MS)
        return cached.data;
    } catch {}

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(
        "https://viacep.com.br/ws/" + cep + "/json/",
        {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) return null;
      const json = (await response.json()) as Record<string, unknown>;
      if (json.erro) return null;
      const data: PostalResult = {
        cep,
        street: String(json.logradouro ?? ""),
        neighborhood: String(json.bairro ?? ""),
        city: String(json.localidade ?? ""),
        state: String(json.uf ?? ""),
      };
      try {
        localStorage.setItem(
          cacheKey,
          JSON.stringify({ at: Date.now(), data }),
        );
      } catch {}
      return data;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
