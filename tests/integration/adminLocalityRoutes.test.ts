import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../server/app";

/**
 * Regressão do defeito que chegou em produção na rodada T12: `adminLocalityRouter`
 * era importado em `server/app.ts` mas nunca montado. Toda a gestão de localidades
 * e de bloqueios parciais respondia o `NOT_FOUND` genérico da aplicação, e as telas
 * do Super administrador mostravam "não é possível carregar as localidades agora"
 * e "não foi possível concluir a operação agora".
 *
 * A asserção é deliberadamente sobre *não ser* o 404 da aplicação: sem sessão
 * administrativa o esperado é `401 UNAUTHORIZED`, o que prova que a rota existe e
 * que o guarda foi alcançado.
 */

const PREFIXES = ["/v1", "/api/v1", "/_hvm_api/v1"];

const ADMIN_ROUTES: Array<{ method: "get" | "post"; path: string }> = [
  { method: "get", path: "/admin/localities" },
  { method: "post", path: "/admin/localities" },
  { method: "get", path: "/admin/access-blocks" },
  { method: "get", path: "/admin/access-blocks/subject?term=maria" },
  { method: "post", path: "/admin/access-blocks" },
];

describe("adminLocalityRouter está montado nos três prefixos", () => {
  for (const prefix of PREFIXES) {
    for (const route of ADMIN_ROUTES) {
      it(`${route.method.toUpperCase()} ${prefix}${route.path} alcança o guarda (não é 404 da aplicação)`, async () => {
        const res = await request(app)[route.method](`${prefix}${route.path}`);
        // GET chega ao guarda de sessão (401). POST é barrado antes pela
        // proteção de origem (403). Nenhum dos dois é o 404 genérico, que era
        // exatamente o sintoma da rota não montada.
        expect(res.body.error).not.toBe("NOT_FOUND");
        expect(res.status).toBe(route.method === "get" ? 401 : 403);
      });
    }
  }

  it("rota inexistente continua devolvendo o NOT_FOUND da aplicação", async () => {
    const res = await request(app).get("/api/v1/admin/rota-que-nao-existe");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
  });

  it("mutações administrativas exigem sessão antes da reautenticação", async () => {
    for (const endpoint of ["/v1/admin/localities", "/v1/admin/access-blocks"]) {
      const res = await request(app)
        .post(endpoint)
        .set("sec-fetch-site", "same-origin")
        .send({});
      expect(res.status).toBe(401);
      expect(res.body.message).toBe("Token de sessão administrativa ausente.");
    }
  });

  it("o catálogo público de localidades segue acessível sem sessão", async () => {
    const res = await request(app).get("/api/v1/localities");
    // Sem banco configurado no teste o serviço pode responder 503; o que importa
    // aqui é que a rota pública não seja barrada por sessão administrativa.
    expect(res.status).not.toBe(401);
    expect(res.body.error).not.toBe("UNAUTHORIZED");
  });
});
