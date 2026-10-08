import { describe, it, expect } from "vitest";
import {
  NotificationListQuerySchema,
  NotificationSchema,
  NotificationDetailSchema,
  ReadNotificationsSchema,
} from "../../shared/contracts/notification.ts";
import {
  ProducerSalesQuerySchema,
  ProducerRefundQuerySchema,
} from "../../shared/contracts/producerSales.ts";
import { randomUUID } from "node:crypto";
describe("Central de notificações: contratos estritos", () => {
  it("normaliza paginação e filtros sem aceitar destinatários ou papéis enviados pelo cliente", () => {
    expect(
      NotificationListQuerySchema.parse({ page: "2", category: "refunds" }),
    ).toEqual({ page: 2, filter: "all", category: "refunds" });
    for (const q of [
      { userId: randomUUID() },
      { role: "platform_super_admin" },
      { page: 0 },
      { filter: "closed" },
      { category: "unknown" },
    ])
      expect(NotificationListQuerySchema.safeParse(q).success).toBe(false);
  });
  it.each([
    "https://attacker.invalid",
    "//attacker.invalid",
    "javascript:alert(1)",
    "/compras\nother",
  ])("recusa destino externo %s", (path) => {
    expect(
      NotificationSchema.safeParse({
        id: randomUUID(),
        category: "purchases",
        title: "Aviso",
        message: "Compra confirmada",
        actionPath: path,
        createdAt: new Date().toISOString(),
        readAt: null,
      }).success,
    ).toBe(false);
  });
  it("leitura em lote requer a data observada e não recebe ids de usuários", () => {
    expect(
      ReadNotificationsSchema.safeParse({ through: new Date().toISOString() })
        .success,
    ).toBe(true);
    expect(
      ReadNotificationsSchema.safeParse({
        through: new Date().toISOString(),
        userId: randomUUID(),
      }).success,
    ).toBe(false);
  });
  it("detalhe mantém ação explícita opcional e rejeita destino externo ou contexto extra", () => {
    const detail = {
      id: randomUUID(),
      category: "refunds",
      title: "Reembolso atualizado",
      message: "Há uma nova informação no atendimento.",
      actionPath: "/reembolsos",
      createdAt: new Date().toISOString(),
      readAt: null,
      recipientRole: "consumer",
      context: {
        categoryLabel: "Reembolsos",
        audienceLabel: "Consumidor",
        why: "Atualização destinada à sua conta.",
        nextStep: "Consulte o atendimento.",
      },
      action: { label: "Consultar reembolso", path: "/reembolsos" },
    };
    expect(NotificationDetailSchema.safeParse(detail).success).toBe(true);
    expect(
      NotificationDetailSchema.safeParse({ ...detail, action: null }).success,
    ).toBe(true);
    expect(
      NotificationDetailSchema.safeParse({
        ...detail,
        action: { label: "Abrir", path: "//attacker.invalid" },
      }).success,
    ).toBe(false);
    expect(
      NotificationDetailSchema.safeParse({
        ...detail,
        context: { ...detail.context, privateUserId: randomUUID() },
      }).success,
    ).toBe(false);
  });
  it("filtros de vendas e reembolsos não aceitam substituição de loja", () => {
    expect(
      ProducerSalesQuerySchema.safeParse({
        source: "pos",
        orderId: randomUUID(),
      }).success,
    ).toBe(true);
    expect(
      ProducerSalesQuerySchema.safeParse({ storeId: randomUUID() }).success,
    ).toBe(false);
    expect(
      ProducerRefundQuerySchema.safeParse({ filter: "open", page: "2" })
        .success,
    ).toBe(true);
  });
});
