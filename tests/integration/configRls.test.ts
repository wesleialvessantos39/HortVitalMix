import { createClient } from "@supabase/supabase-js";
import { expect } from "vitest";
import { runtime } from "../../server/config/runtime";
import { asIdentity, createEphemeralIdentity } from "../helpers/identity";
import { integrationDescribe, integrationIt } from "../helpers/integration";

async function readConfig(client: ReturnType<typeof createClient>) {
  return client
    .from("app_global_config")
    .select("slogan,revision")
    .eq("singleton_guard", true)
    .single();
}

integrationDescribe("RLS — app_global_config", () => {
  integrationIt("usuário autenticado comum NÃO consegue atualizar via SDK", async () => {
    const identity = await createEphemeralIdentity({ role: "consumer" });
    try {
      const client = asIdentity(identity);
      const before = await readConfig(client);
      expect(before.error).toBeNull();

      await client
        .from("app_global_config")
        .update({ slogan: "Alteração não autorizada" })
        .eq("singleton_guard", true);

      const after = await readConfig(client);
      expect(after.error).toBeNull();
      expect(after.data).toEqual(before.data);
    } finally {
      await identity.cleanup();
    }
  });

  integrationIt("usuário anônimo NÃO consegue atualizar", async () => {
    const anon = createClient(runtime.supabaseUrl, runtime.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const before = await readConfig(anon);
    expect(before.error).toBeNull();

    await anon
      .from("app_global_config")
      .update({ slogan: "Alteração anônima" })
      .eq("singleton_guard", true);

    const after = await readConfig(anon);
    expect(after.error).toBeNull();
    expect(after.data).toEqual(before.data);
  });

  integrationIt("qualquer usuário LÊ app_global_config (policy pública)", async () => {
    const anon = createClient(runtime.supabaseUrl, runtime.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon
      .from("app_global_config")
      .select("platform_name,revision")
      .limit(1);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});
