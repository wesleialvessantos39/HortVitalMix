import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "platform_super_admin",
  status: "active",
  principal: true,
  issued: "",
  verified: true,
}));
vi.mock("../../server/db/pool.ts", () => ({ dbPool: null }));
vi.mock("../../server/supabase/client.ts", () => {
  const client = {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: "11111111-1111-4111-8111-111111111111",
            email_confirmed_at: state.verified ? "2026-01-01" : null,
            last_sign_in_at: state.issued,
          },
        },
        error: null,
      }),
    },
    from: (table: string) => {
      const data =
        table === "app_admin_principals"
          ? state.principal
            ? {
                admin_user_id: "11111111-1111-4111-8111-111111111111",
                portal_role: state.role,
              }
            : null
          : table === "app_users"
            ? {
                status: state.status,
                block_starts_at: null,
                block_ends_at: null,
              }
            : table === "app_user_role_assignments"
              ? [{ role_code: state.role, expires_at: null }]
              : [{ sector_code: "document_verification", expires_at: null }];
      const builder: any = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data, error: null }).then(resolve),
        maybeSingle: async () => ({ data, error: null }),
      };
      for (const name of ["select", "eq", "is", "in"])
        builder[name] = () => builder;
      return builder;
    },
  };
  return { supabaseAdmin: client, createSupabasePublicClient: () => client };
});
import { categoryRouter } from "../../server/routes/categoryRoutes.ts";
import {
  CategoryError,
  CategoryService,
} from "../../server/services/CategoryService.ts";
const id = randomUUID();
function app() {
  const server = express();
  server.use(express.json());
  server.use((req, res, next) => {
    req.requestId = randomUUID();
    req.clientIpHash = "a".repeat(64);
    res.locals.requestId = req.requestId;
    next();
  });
  for (const prefix of ["/v1", "/api/v1", "/_hvm_api/v1"])
    server.use(prefix, categoryRouter);
  return server;
}
const authenticated = (test: request.Test) =>
  test
    .set("Authorization", "Bearer verified-test-token")
    .set("Sec-Fetch-Site", "same-origin");
const create = () => ({
  name: "Hortaliças",
  slug: "hortalicas",
  iconName: "leaf",
  commandId: randomUUID(),
});
beforeEach(() => {
  vi.restoreAllMocks();
  Object.assign(state, {
    role: "platform_super_admin",
    status: "active",
    principal: true,
    issued: new Date().toISOString(),
    verified: true,
  });
});
describe("T13 fronteira HTTP de categorias", () => {
  it.each(["/v1", "/api/v1", "/_hvm_api/v1"])(
    "catálogo público e admin em %s",
    async (prefix) => {
      vi.spyOn(CategoryService, "listActiveCategories").mockResolvedValue([]);
      const response = await request(app()).get(prefix + "/categories");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ categories: [] });
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(
        (await request(app()).get(prefix + "/admin/categories")).status,
      ).toBe(401);
    },
  );
  it.each(["create", "edit", "deactivate", "reactivate"])(
    "mutações %s exigem sessão",
    async (operation) => {
      const path =
        operation === "create"
          ? "/v1/admin/categories"
          : `/v1/admin/categories/${id}${operation === "edit" ? "" : "/" + operation}`;
      expect(
        (
          await request(app())
            [operation === "edit" ? "patch" : "post"](path)
            .send(create())
        ).status,
      ).toBe(401);
    },
  );
  it("Administrador setorial não edita slug nem lê catálogo de gestão", async () => {
    state.role = "platform_admin";
    const save = vi.spyOn(CategoryService, "updateCategory");
    expect(
      (
        await authenticated(
          request(app()).patch(`/v1/admin/categories/${id}`),
        ).send({ ...create(), expectedRevision: 1 })
      ).status,
    ).toBe(403);
    expect(
      (await authenticated(request(app()).get("/v1/admin/categories"))).status,
    ).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });
  it("conta pública com token válido não atravessa fronteira administrativa", async () => {
    state.principal = false;
    expect(
      (
        await authenticated(request(app()).post("/v1/admin/categories")).send(
          create(),
        )
      ).status,
    ).toBe(401);
  });
  it("sessão com email não confirmado é rejeitada", async () => {
    state.verified = false;
    expect(
      (await authenticated(request(app()).get("/v1/admin/categories"))).status,
    ).toBe(401);
  });
  it("bloqueio da conta é aplicado antes do serviço", async () => {
    state.status = "blocked";
    expect(
      (
        await authenticated(request(app()).post("/v1/admin/categories")).send(
          create(),
        )
      ).status,
    ).toBe(403);
  });
  it("reautenticação e proteção de origem precedem a mutação", async () => {
    const service = vi.spyOn(CategoryService, "createCategory");
    state.issued = new Date(Date.now() - 20 * 60000).toISOString();
    expect(
      (
        await authenticated(request(app()).post("/v1/admin/categories")).send(
          create(),
        )
      ).status,
    ).toBe(401);
    state.issued = new Date().toISOString();
    expect(
      (
        await request(app())
          .post("/v1/admin/categories")
          .set("Authorization", "Bearer test")
          .set("Sec-Fetch-Site", "cross-site")
          .send(create())
      ).status,
    ).toBe(403);
    expect(service).not.toHaveBeenCalled();
  });
  it.each([
    { id: "invalid", extra: {} },
    { id, extra: { isActive: false } },
  ])("recusa ID inválido/campos adicionais %#", async (value) => {
    const save = vi.spyOn(CategoryService, "updateCategory");
    expect(
      (
        await authenticated(
          request(app()).patch(`/v1/admin/categories/${value.id}`),
        ).send({ ...create(), expectedRevision: 1, ...value.extra })
      ).status,
    ).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("edição autorizada utiliza o ator e o contexto do servidor", async () => {
    const save = vi
      .spyOn(CategoryService, "updateCategory")
      .mockResolvedValue({ slug: "novo-slug" } as any);
    const response = await authenticated(
      request(app()).patch(`/v1/admin/categories/${id}`),
    ).send({ ...create(), slug: "novo-slug", expectedRevision: 1 });
    expect(response.status).toBe(200);
    expect(save.mock.calls[0][2]).toMatchObject({
      role: "platform_super_admin",
      isSuperAdmin: true,
    });
    expect(save.mock.calls[0][3]).toMatchObject({ ipHash: "a".repeat(64) });
  });
  it.each([
    ["CATEGORY_SLUG_CONFLICT", 409],
    ["CATEGORY_CYCLE_FORBIDDEN", 422],
    ["CATEGORY_PARENT_NOT_FOUND", 422],
  ])("propaga erro %s", async (code, status) => {
    vi.spyOn(CategoryService, "updateCategory").mockRejectedValue(
      new CategoryError(String(code), Number(status)),
    );
    expect(
      (
        await authenticated(
          request(app()).patch(`/v1/admin/categories/${id}`),
        ).send({ ...create(), expectedRevision: 1 })
      ).status,
    ).toBe(status);
  });
  it("conflito retorna revisão corrente e request ID", async () => {
    vi.spyOn(CategoryService, "updateCategory").mockRejectedValue(
      new CategoryError("CATEGORY_REVISION_CONFLICT", 409, 3),
    );
    const response = await authenticated(
      request(app()).patch(`/v1/admin/categories/${id}`),
    ).send({ ...create(), expectedRevision: 1 });
    expect(response.body.currentRevision).toBe(3);
    expect(response.body.requestId).toBeTruthy();
  });
  it("impacto novo retorna relatório para confirmação explícita", async () => {
    const impact = {
      categoryId: id,
      revision: 1,
      activeProducts: 3,
      activeChildren: 0,
      requiresConfirmation: true,
    };
    vi.spyOn(CategoryService, "deactivateCategory").mockRejectedValue(
      new CategoryError(
        "CATEGORY_IMPACT_CONFIRMATION_REQUIRED",
        409,
        undefined,
        impact,
      ),
    );
    const response = await authenticated(
      request(app()).post(`/v1/admin/categories/${id}/deactivate`),
    ).send({ commandId: randomUUID(), expectedRevision: 1 });
    expect(response.status).toBe(409);
    expect(response.body.impact).toEqual(impact);
  });
  it("não oferece DELETE nem mutações públicas", async () => {
    expect(
      (await authenticated(request(app()).delete(`/v1/admin/categories/${id}`)))
        .status,
    ).toBe(404);
    expect(
      (
        await authenticated(request(app()).patch(`/v1/categories/${id}`)).send(
          create(),
        )
      ).status,
    ).toBe(404);
  });
});
