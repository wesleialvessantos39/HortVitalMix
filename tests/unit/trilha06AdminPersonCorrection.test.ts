import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AccountPersonResolutionError,
  resolveAccountPersonId,
} from "../../server/services/AccountPersonResolver";

function clientWith(
  handler: (sql: string, params: unknown[]) => { rows: Array<Record<string, unknown>> },
) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) =>
      handler(sql, params),
    ),
  };
}

describe("T06 — correção da pessoa canônica em sessão administrativa", () => {
  it("consumer resolve somente app_people.user_id e não tenta principal administrativo", async () => {
    const client = clientWith((sql, params) => {
      expect(sql).toContain("FROM public.app_people p");
      expect(params).toEqual(["public-user"]);
      return { rows: [{ id: "person-public" }] };
    });

    await expect(
      resolveAccountPersonId(client as never, "public-user", "consumer"),
    ).resolves.toBe("person-public");
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("producer preserva a mesma pessoa civil sem misturar imóvel rural", async () => {
    const client = clientWith((sql) => {
      expect(sql).toContain("public.app_people");
      expect(sql).not.toContain("app_properties");
      return { rows: [{ id: "person-producer" }] };
    });

    await expect(
      resolveAccountPersonId(client as never, "producer-user", "producer"),
    ).resolves.toBe("person-producer");
  });

  it("admin_user_id diferente de people.user_id resolve o person_id do principal ativo do mesmo portal", async () => {
    let call = 0;
    const client = clientWith((sql, params) => {
      call += 1;
      if (call === 1) return { rows: [] };
      expect(sql).toContain("app_admin_principals");
      expect(sql).toContain("u.status='active'");
      expect(sql).toContain("r.role_code=ap.portal_role");
      expect(sql).toContain("ap.portal_role=$2");
      expect(params).toEqual(["admin-auth-user", "platform_admin"]);
      return { rows: [{ id: "person-linked" }] };
    });

    await expect(
      resolveAccountPersonId(
        client as never,
        "admin-auth-user",
        "platform_admin",
      ),
    ).resolves.toBe("person-linked");
  });

  it("admin sem principal ativo retorna PERSON_NOT_FOUND sem consultar CPF ou e-mail", async () => {
    const observed: string[] = [];
    const client = clientWith((sql) => {
      observed.push(sql);
      return { rows: [] };
    });

    await expect(
      resolveAccountPersonId(
        client as never,
        "orphan-admin",
        "platform_super_admin",
      ),
    ).rejects.toMatchObject<AccountPersonResolutionError>({
      code: "PERSON_NOT_FOUND",
      status: 404,
    });

    expect(observed.join("\n")).not.toMatch(/cpf|email/i);
  });

  it("consumer sem app_people falha fechado e nunca usa principal de outra credencial", async () => {
    const client = clientWith(() => ({ rows: [] }));

    await expect(
      resolveAccountPersonId(client as never, "consumer-missing", "consumer"),
    ).rejects.toMatchObject({ code: "PERSON_NOT_FOUND", status: 404 });
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("mutações mantêm lock pessimista na própria app_people", async () => {
    const client = clientWith((sql) => {
      expect(sql).toContain("FOR UPDATE OF p");
      return { rows: [{ id: "person-locked" }] };
    });

    await expect(
      resolveAccountPersonId(client as never, "user", "consumer", {
        lock: true,
      }),
    ).resolves.toBe("person-locked");
  });

  it("hub isola falha de endereços da saudação e carrega apenas a seção aberta", () => {
    const ui = readFileSync("src/pages/account/AccountHub.tsx", "utf8");
    expect(ui).toContain("Promise.allSettled");
    expect(ui).toContain("Não foi possível carregar seu perfil agora.");
    expect(ui).toContain("Seus endereços não puderam ser carregados agora.");
    expect(ui).toContain('if (path === "/conta/perfil")');
    expect(ui).toContain(
      'if (path === "/conta/preferencias" || path === "/conta/privacidade")',
    );
  });

  it("exportação administrativa reautentica no portal admin e T07 permanece dona do CRUD", () => {
    const privacy = readFileSync(
      "src/pages/account/PrivacyExportButton.tsx",
      "utf8",
    );
    const adminRoutes = readFileSync(
      "server/routes/adminGovernanceRoutes.ts",
      "utf8",
    );
    const addresses = readFileSync(
      "server/services/AddressManagementService.ts",
      "utf8",
    );
    const profile = readFileSync(
      "server/services/ProfilePrivacyService.ts",
      "utf8",
    );

    expect(privacy).toContain('"/v1/admin/auth/login"');
    expect(privacy).toContain('"/v1/auth/login"');
    expect(adminRoutes).toContain("issueRecentAuthProof");
    expect(adminRoutes).toContain('res.cookie("hvm_reauth"');
    expect(profile).toContain("includeInactive: true");
    expect(profile).toContain("getPreferences(userId, role, true)");

    expect(addresses).toContain("class AddressManagementService");
    expect(addresses).toContain("activeCount");
    expect(addresses).toContain(">= 10");
    expect(addresses).toContain('addressDeletionMode(openOrders)');
    expect(addresses).toContain("is_active=false");
    expect(addresses).toContain("resolveAccountPersonId");
    expect(addresses).not.toContain("app_properties");
  });
});
