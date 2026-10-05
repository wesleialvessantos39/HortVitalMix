import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import express from "express";
import type { Server } from "node:http";
import { resolve } from "node:path";
const auth = vi.hoisted(() => ({ userId: "", token: "" }));
vi.mock("../../server/db/pool.ts", async () => {
  const value = process.env.HVM_FIX_LOCAL_DATABASE_URL;
  if (!value) return { dbPool: null };
  const url = new URL(value);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/postgres"
  )
    throw Error("LOCAL_DATABASE_REQUIRED");
  const { default: pg } = await import("pg");
  return { dbPool: new pg.Pool({ connectionString: value, max: 5 }) };
});
vi.mock("../../server/config/runtime.ts", async (original) => {
  const actual =
    await original<typeof import("../../server/config/runtime.ts")>();
  return {
    ...actual,
    runtime: {
      ...actual.runtime,
      appEnv: "development",
      ipPepper: "local-document-proof-only",
    },
  };
});
vi.mock("../../server/supabase/client.ts", () => {
  const client = {
    from: (table: string) => {
      if (table !== "app_global_config")
        throw Error("UNEXPECTED_DATA_API_TABLE:" + table);
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => {
          const { dbPool } = await import("../../server/db/pool.ts");
          return {
            data: (
              await dbPool!.query(
                "SELECT * FROM app_global_config WHERE singleton_guard=true",
              )
            ).rows[0],
            error: null,
          };
        },
      };
      return q;
    },
    auth: {
      getUser: async (token: string) => ({
        data: {
          user:
            token === auth.token
              ? {
                  id: auth.userId,
                  email: "local@example.test",
                  email_confirmed_at: "2026-01-01",
                }
              : null,
        },
        error: null,
      }),
    },
    storage: {
      from: () => ({
        download: async () => ({
          data: new Blob([
            `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 500]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 180>>stream
BT /F1 12 Tf 20 400 Td (Nome do imovel: Sitio original) Tj ET
BT /F1 12 Tf 20 370 Td (Municipio: Ariquemes) Tj ET
BT /F1 12 Tf 20 340 Td (Area total: 20 ha) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`,
          ]),
          error: null,
        }),
      }),
    },
  };
  return {
    supabaseAdmin: client,
    supabasePublic: client,
    createSupabasePublicClient: () => client,
    createSupabaseUserClient: () => client,
  };
});
import { dbPool } from "../../server/db/pool.ts";
import { DocumentStorageService } from "../../server/services/DocumentStorageService.ts";
import { GeminiDocumentProcessor } from "../../server/services/GeminiDocumentProcessor.ts";
import { RuralPropertyService } from "../../server/services/RuralPropertyService.ts";
import { effectiveDocumentFields } from "../../shared/documents/effectiveDocumentFields.ts";
import { app } from "../../server/app.ts";

describe.runIf(Boolean(process.env.HVM_FIX_LOCAL_DATABASE_URL))(
  "Correções documentais e cadastro: PostgreSQL local real",
  () => {
    const pool = () => dbPool as Pool;
    const users: string[] = [];
    async function fixture() {
      const userId = randomUUID(),
        propertyId = randomUUID(),
        profileId = randomUUID(),
        docId = randomUUID();
      users.push(userId);
      await pool().query(
        "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
        [userId, userId + "@example.test"],
      );
      const person = await pool().query(
        "INSERT INTO app_people(user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [
          userId,
          "Titular " + userId,
          String(Math.floor(Math.random() * 1e11)).padStart(11, "0"),
          userId + "@example.test",
          "+5569" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"),
        ],
      );
      await pool().query(
        "INSERT INTO app_user_role_assignments(user_id,role_code) VALUES($1,'producer')",
        [userId],
      );
      await pool().query(
        "INSERT INTO app_producer_profiles(id,person_id) VALUES($1,$2)",
        [profileId, person.rows[0].id],
      );
      await pool().query(
        "INSERT INTO app_properties(id,producer_id,property_name,municipality,state,status,draft_data) VALUES($1,$2,'Imóvel sem nome','Ariquemes','RO','draft',$3)",
        [
          propertyId,
          profileId,
          JSON.stringify({
            step: 1,
            waterSource: "poco_artesiano",
            lineVicinal: "Linha preservada",
          }),
        ],
      );
      await pool().query(
        "INSERT INTO app_documents(id,property_id,producer_id,document_type,file_name,file_size_bytes,mime_type,storage_path,file_hash_sha256,status,uploaded_by,upload_command_id) VALUES($1,$2,$3,'car_sicar','local.pdf',2048,'application/pdf',$4,$5,'clean',$6,$7)",
        [
          docId,
          propertyId,
          profileId,
          "properties/" + propertyId + "/" + docId + ".pdf",
          "a".repeat(64),
          userId,
          randomUUID(),
        ],
      );
      const actor = {
        userId,
        role: "producer",
        auditor: false,
        requestId: randomUUID(),
        ipHash: "a".repeat(64),
      };
      return { userId, propertyId, docId, actor };
    }
    const data = () => ({
      commandId: randomUUID(),
      propertyRegisteredName: "Sítio original",
      municipality: "Ariquemes",
      totalAreaHectares: 20,
      consolidatedRuralAreaHectares: 12,
      latitudeSede: -9.91,
      longitudeSede: -63.04,
    });
    afterAll(async () => {
      for (const id of users)
        await pool().query("DELETE FROM auth.users WHERE id=$1", [id]);
      await dbPool?.end();
    });
    it("salva todos os campos e sincroniza imóvel/rascunho/extração efetiva; preserva original e conta", async () => {
      const f = await fixture();
      await DocumentStorageService.declare(f.actor, f.docId, {
        ...data(),
        source: "pdf_text",
      });
      const original = await GeminiDocumentProcessor.read(f.actor, f.docId);
      expect(effectiveDocumentFields(original.extraction)?.holderName).toBe(
        "Titular " + f.userId,
      );
      const personBefore = (
        await pool().query("SELECT * FROM app_people WHERE user_id=$1", [
          f.userId,
        ])
      ).rows[0];
      const propertyBefore = await RuralPropertyService.getProperty(
        f.userId,
        f.propertyId,
      );
      const changed = {
        ...data(),
        propertyRegisteredName: "Chácara corrigida",
        municipality: "Rio Crespo",
        totalAreaHectares: 10,
        consolidatedRuralAreaHectares: 4,
        legalReserveHectares: 2,
        appHectares: 1,
        fiscalModules: 0.3,
        carNumber: "RO-1100023-" + "B".repeat(32),
        holderName: "Titular conferido",
        holderCpfNormalized: personBefore.cpf_normalized,
        latitudeSede: -9.6,
        longitudeSede: -62.9,
        expectedRevision: propertyBefore.revision,
      };
      const saved = await DocumentStorageService.declare(
        f.actor,
        f.docId,
        changed,
      );
      expect(saved).toMatchObject({
        propertyUpdated: true,
        areaApplied: true,
        locationApplied: true,
        cultivatedApplied: true,
      });
      const property = await RuralPropertyService.getProperty(
        f.userId,
        f.propertyId,
      );
      expect(property).toMatchObject({
        propertyName: "Chácara corrigida",
        municipality: "Rio Crespo",
        totalAreaHectares: 10,
        cultivatedAreaHectares: 4,
        latitudeSede: -9.6,
        longitudeSede: -62.9,
      });
      expect(property.draftData).toMatchObject({
        propertyName: "Chácara corrigida",
        totalAreaHectares: "10",
        cultivatedAreaHectares: "4",
        waterSource: "poco_artesiano",
        lineVicinal: "Linha preservada",
      });
      const read = await GeminiDocumentProcessor.read(f.actor, f.docId);
      expect(read.extraction?.payload_jsonb).toEqual(
        original.extraction?.payload_jsonb,
      );
      expect(effectiveDocumentFields(read.extraction)).toMatchObject({
        holderName: "Titular conferido",
        propertyRegisteredName: "Chácara corrigida",
        totalAreaHectares: 10,
        legalReserveHectares: 2,
      });
      expect(
        (
          await pool().query("SELECT * FROM app_people WHERE user_id=$1", [
            f.userId,
          ])
        ).rows[0],
      ).toEqual(personBefore);
      const replay = await DocumentStorageService.declare(
        f.actor,
        f.docId,
        changed,
      );
      expect(replay).toMatchObject({ propertyUpdated: true });
      expect(
        (await RuralPropertyService.getProperty(f.userId, f.propertyId))
          .revision,
      ).toBe(property.revision);
      await expect(
        DocumentStorageService.declare(f.actor, f.docId, {
          ...changed,
          propertyRegisteredName: "Outro",
        }),
      ).rejects.toThrow("COMMAND_CONFLICT");
      const reopened = await DocumentStorageService.declare(f.actor, f.docId, {
        ...data(),
        source: "pdf_text",
      });
      expect(reopened).toMatchObject({
        alreadySaved: true,
        propertyUpdated: false,
      });
      expect(
        (await RuralPropertyService.getProperty(f.userId, f.propertyId))
          .revision,
      ).toBe(property.revision);
    });
    it("conferência posterior não esconde correção; valida titular divergente", async () => {
      const f = await fixture();
      await DocumentStorageService.declare(f.actor, f.docId, {
        ...data(),
        holderName: "Titular do documento",
        holderCpfNormalized: "52998224725",
      });
      await GeminiDocumentProcessor.review(f.actor, f.docId, {
        commandId: randomUUID(),
        decision: "disputed",
        note: "Conferência documental posterior.",
      });
      const read = await GeminiDocumentProcessor.read(f.actor, f.docId);
      expect(read.extraction?.review?.decision).toBe("disputed");
      expect(effectiveDocumentFields(read.extraction)?.holderName).toBe(
        "Titular do documento",
      );
      expect(read.extraction?.effective_discrepancies).toContain(
        "CPF do titular ausente ou divergente",
      );
    });
    it("revisão obsoleta e áreas incompatíveis abortam sem salvar parcialmente", async () => {
      const f = await fixture();
      await DocumentStorageService.declare(f.actor, f.docId, data());
      const before = await RuralPropertyService.getProperty(
        f.userId,
        f.propertyId,
      );
      const reviews = (
        await pool().query(
          "SELECT count(*)::int n FROM app_document_reviews WHERE extraction_id IN(SELECT id FROM app_document_extractions WHERE document_id=$1)",
          [f.docId],
        )
      ).rows[0].n;
      await expect(
        DocumentStorageService.declare(f.actor, f.docId, {
          ...data(),
          expectedRevision: before.revision - 1,
        }),
      ).rejects.toThrow("PROPERTY_REVISION_CONFLICT");
      await expect(
        DocumentStorageService.declare(f.actor, f.docId, {
          ...data(),
          totalAreaHectares: 3,
          consolidatedRuralAreaHectares: 4,
        }),
      ).rejects.toThrow("PROPERTY_AREA_CONFLICT");
      expect(
        await RuralPropertyService.getProperty(f.userId, f.propertyId),
      ).toEqual(before);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_document_reviews WHERE extraction_id IN(SELECT id FROM app_document_extractions WHERE document_id=$1)",
            [f.docId],
          )
        ).rows[0].n,
      ).toBe(reviews);
    });
    it("outro produtor não pode corrigir o documento", async () => {
      const f = await fixture(),
        other = await fixture();
      await expect(
        DocumentStorageService.declare(other.actor, f.docId, data()),
      ).rejects.toThrow("DOCUMENT_NOT_FOUND");
    });
    it("concorrência com mesmo comando grava uma única correção", async () => {
      const f = await fixture(),
        input = data();
      await Promise.all([
        DocumentStorageService.declare(f.actor, f.docId, input),
        DocumentStorageService.declare(f.actor, f.docId, input),
      ]);
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_document_reviews WHERE command_id=$1",
            [input.commandId],
          )
        ).rows[0].n,
      ).toBe(1);
    });
    it.each(["consumer", "producer"])(
      "cadastro %s grava identidade, papel, perfil e aceite em uma transação",
      async (role) => {
        const id = randomUUID();
        users.push(id);
        await pool().query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
          id,
          id + "@example.test",
        ]);
        const result = await pool().query(
          "SELECT complete_public_registration_with_consent($1,$2,$3,$4,$5,$6,'Ariquemes','RO','lgpd-cadastro-2026-10-02',$7,'local test') result",
          [
            id,
            "Novo " + id,
            String(Math.floor(Math.random() * 1e11)).padStart(11, "0"),
            id + "@example.test",
            "+5569" + String(Math.floor(Math.random() * 1e9)).padStart(9, "0"),
            role,
            "a".repeat(64),
          ],
        );
        expect(result.rows[0].result).toMatchObject({
          status: "active",
          role,
          lgpdRecorded: true,
        });
        expect(
          (
            await pool().query(
              "SELECT role_code FROM app_user_role_assignments WHERE user_id=$1",
              [id],
            )
          ).rows,
        ).toEqual([{ role_code: role }]);
        expect(
          (
            await pool().query(
              "SELECT count(*)::int n FROM app_consent_records WHERE person_id=$1 AND consent_type='lgpd_cadastro'",
              [result.rows[0].result.personId],
            )
          ).rows[0].n,
        ).toBe(1);
        expect(
          (
            await pool().query(
              "SELECT count(*)::int n FROM app_producer_profiles WHERE person_id=$1",
              [result.rows[0].result.personId],
            )
          ).rows[0].n,
        ).toBe(role === "producer" ? 1 : 0);
        expect(
          (
            await pool().query(
              "SELECT email_confirmed_at FROM auth.users WHERE id=$1",
              [id],
            )
          ).rows[0].email_confirmed_at,
        ).toBeNull();
      },
    );
    it("RPC de consentimento é privado e erro não deixa pessoa/papel parcial", async () => {
      const id = randomUUID();
      users.push(id);
      await pool().query("INSERT INTO auth.users(id,email) VALUES($1,$2)", [
        id,
        id + "@example.test",
      ]);
      await expect(
        pool().query(
          "SELECT complete_public_registration_with_consent($1,'Teste','12345678909',$2,'+5569999999999','consumer','Ariquemes','RO','versao-invalida',$3,'local')",
          [id, id + "@example.test", "a".repeat(64)],
        ),
      ).rejects.toThrow("INVALID_REGISTRATION_CONSENT");
      expect(
        (
          await pool().query(
            "SELECT count(*)::int n FROM app_people WHERE user_id=$1",
            [id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await pool().query(
            "SELECT has_function_privilege('authenticated','public.complete_public_registration_with_consent(uuid,text,text,text,text,text,text,text,text,text,text)','EXECUTE') allowed",
          )
        ).rows[0].allowed,
      ).toBe(false);
    });
    it("React → API → PostgreSQL: correção aparece nas etapas 2/3 e após recarga em mobile/desktop", async () => {
      const f = await fixture();
      auth.userId = f.userId;
      await pool().query(
        "UPDATE app_people SET full_name='Maria Aparecida Silva' WHERE user_id=$1",
        [f.userId],
      );
      await DocumentStorageService.declare(f.actor, f.docId, {
        ...data(),
        source: "pdf_text",
      });
      const sessionId = randomUUID();
      await pool().query(
        "INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)",
        [sessionId, f.userId],
      );
      auth.token =
        "local." +
        Buffer.from(JSON.stringify({ session_id: sessionId })).toString(
          "base64url",
        ) +
        ".local";
      const outer = express();
      outer.use(["/api", "/_hvm_api"], app);
      outer.use(express.static(resolve("dist")));
      outer.get("*", (_req, res) => res.sendFile(resolve("dist/index.html")));
      const server = await new Promise<Server>((done) => {
        const s = outer.listen(0, "127.0.0.1", () => done(s));
      });
      const baseURL =
        "http://127.0.0.1:" + (server.address() as { port: number }).port;
      const { chromium, expect: be } = await import("@playwright/test"),
        portable = (await import("@sparticuz/chromium")).default;
      const browser = await chromium.launch({
        executablePath: await portable.executablePath(),
        args: ["--disable-gpu", "--no-zygote"],
      });
      try {
        for (const width of [390, 1440]) {
          const ctx = await browser.newContext({
            viewport: { width, height: 1000 },
            isMobile: width === 390,
            hasTouch: width === 390,
          });
          await ctx.addCookies([
            { name: "hvm_access", value: auth.token, url: baseURL },
            { name: "hvm_portal_role", value: "producer", url: baseURL },
          ]);
          const page = await ctx.newPage(),
            errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          await page.route("**/tile.openstreetmap.org/**", (r) =>
            r.fulfill({ status: 204, body: "" }),
          );
          await page.goto(
            baseURL + "/produtor/propriedades/novo?id=" + f.propertyId,
          );
          await page
            .getByRole("button", { name: "Ver documento", exact: true })
            .click();
          await be(
            page.getByRole("heading", { name: "Dados lidos" }),
          ).toBeVisible();
          await be(
            page
              .locator(".document-data dl")
              .getByText("Maria Aparecida Silva", { exact: true }),
          ).toBeVisible();
          const revision = (
            await RuralPropertyService.getProperty(f.userId, f.propertyId)
          ).revision;
          await page.locator(".document-data summary").click();
          const form = page.getByRole("form", {
            name: "Correção dos dados do documento",
          });
          await be(form.getByLabel("Titular", { exact: true })).toHaveValue(
            "Maria Aparecida Silva",
          );
          await form
            .getByLabel("Nome do imóvel no documento")
            .fill("Chácara corrigida " + width);
          await form.getByLabel("Área total (ha)", { exact: true }).fill("10");
          await form.getByLabel("Área consolidada (ha)").fill("4");
          await form.getByLabel("Reserva legal (ha)").fill("2");
          await page
            .getByRole("button", { name: "Salvar correção", exact: true })
            .click();
          await be(
            page.getByText("Dados salvos. O cadastro do imóvel foi corrigido", {
              exact: false,
            }),
          ).toBeVisible();
          expect(
            (await RuralPropertyService.getProperty(f.userId, f.propertyId))
              .revision,
          ).toBe(revision + 1);
          await page.evaluate(() => window.scrollTo(0, 0));
          const management = await page
              .locator(".documents-panel--embedded")
              .boundingBox(),
            card = await page.locator(".rural-wizard-card").boundingBox();
          expect(management!.width / card!.width).toBeGreaterThan(0.8);
          const dataBox = await page.locator(".document-data").boundingBox(),
            originalBox = await page
              .locator(".document-original")
              .boundingBox();
          if (width === 1440) {
            expect(dataBox!.x).toBeGreaterThan(originalBox!.x);
            expect(dataBox!.width).toBeGreaterThan(400);
            expect(Math.abs(dataBox!.y - originalBox!.y)).toBeLessThan(10);
          } else expect(dataBox!.y).toBeGreaterThan(originalBox!.y);
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: `/workspace/scratch/fix-property-${width}.png`,
            fullPage: true,
          });
          await page
            .getByRole("button", { name: /Etapa 2: Identificação/ })
            .click();
          await be(
            page.getByLabel("Nome da propriedade ou chácara"),
          ).toHaveValue("Chácara corrigida " + width);
          await page
            .getByRole("button", { name: /Etapa 3: Dimensões/ })
            .click();
          await be(page.getByLabel("Área total (ha)")).toHaveValue("10");
          await be(page.getByLabel("Área cultivada ativa (ha)")).toHaveValue(
            "4",
          );
          await page.reload();
          await be(page.getByLabel("Área total (ha)")).toHaveValue("10");
          await page
            .getByRole("button", { name: /Etapa 1: Documentos/ })
            .click();
          await page
            .getByRole("button", { name: "Ver documento", exact: true })
            .click();
          await be(
            page
              .locator(".document-data dl")
              .getByText("Chácara corrigida " + width, { exact: true }),
          ).toBeVisible();
          await page.getByRole("button", { name: "Atualizar leitura" }).click();
          await be(
            page
              .locator(".document-data dl")
              .getByText("Chácara corrigida " + width, { exact: true }),
          ).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          ).toBe(true);
          expect(errors).toEqual([]);
          await ctx.close();
        }
      } finally {
        await browser.close();
        await new Promise<void>((done) => server.close(() => done()));
      }
    }, 60000);
  },
);
