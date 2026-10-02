import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("../../server/db/pool.ts", () => ({
  dbPool: { connect: async () => mocks },
}));
import { VerificationQueueService } from "../../server/services/VerificationQueueService.ts";

const id = "22222222-2222-4222-8222-222222222222";
const actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  role: "platform_super_admin",
  isSuperAdmin: true,
  sectors: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT DISTINCT"))
      return { rows: [{ producer_id: id }] };
    if (sql.startsWith("SELECT r.id"))
      return {
        rows: [
          {
            id,
            property_id: id,
            producer_id: id,
            status: "approved",
            archived_at: "2026-10-01T00:00:00Z",
            superseded_at: null,
            property_status: "verified",
            deleted_at: "2026-10-02T00:00:00Z",
            registration_number: null,
            property_name: "Rascunho removido",
            municipality: "Ariquemes",
            line_vicinal: "Linha C-65",
            updated_at: "2026-10-02T00:00:00Z",
            documents: [],
            decision_history: [],
          },
        ],
      };
    return { rows: [] };
  });
});

it("exclui imóvel removido da fila e dos arquivados do superadministrador", async () => {
  const { requests } = await VerificationQueueService.list(actor, "archived");
  expect(requests).toEqual([]);
  expect(mocks.query.mock.calls[1][0]).toContain("p.deleted_at IS NULL");
  expect(mocks.query.mock.calls[2][0]).toContain("p.deleted_at IS NULL");
});
