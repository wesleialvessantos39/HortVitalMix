import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { AdminActorContext } from "../middleware/adminSession.ts";
import { supabaseAdmin } from "../supabase/client.ts";
import { getPaymentGateway } from "../payments/gateway.ts";
import {
  CreateRefundSchema,
  RefundDecisionSchema,
  CreateComplaintSchema,
  ComplaintDecisionSchema,
  CaseMessageSchema,
  CaseEvidenceSchema,
  CommercePolicySchema,
  type CaseView,
} from "../../shared/contracts/commerce.ts";
import {
  CommerceError,
  commerceTransaction,
  commerceIdentity,
  commerceAdmin,
  commerceCommand,
  commerceAudit,
  type CommerceAudit,
} from "./CommerceSupport.ts";

type Kind = "refund" | "complaint";
const table = (kind: Kind) =>
  kind === "refund" ? "app_refund_requests" : "app_complaints";
const field = (kind: Kind) =>
  kind === "refund" ? "refund_id" : "complaint_id";
const sector = (kind: Kind) =>
  kind === "refund"
    ? ("refund_management" as const)
    : ("complaint_management" as const);
async function ownCase(
  client: PoolClient,
  userId: string,
  kind: Kind,
  id: string,
  admin?: AdminActorContext,
  lock = false,
  portalRole?: "consumer"|"producer",
) {
  z.uuid().parse(id);
  if (admin) await commerceAdmin(client, admin, sector(kind));
  else await commerceIdentity(client, userId, kind === "refund" ? "consumer" : undefined);
  const row = (
    await client.query(
      `SELECT * FROM public.${table(kind)} WHERE id=$1 ${admin ? "" : `AND ${kind === "refund" ? "requester_user_id" : "reporter_user_id"}=$2`} ${lock ? "FOR UPDATE" : ""}`,
      admin ? [id] : [id, userId],
    )
  ).rows[0];
  if (!row || (!admin && portalRole && (kind === "refund" ? portalRole!=="consumer" : row.reporter_role!==portalRole))) throw new CommerceError("CASE_NOT_FOUND", 404);
  return row;
}
async function history(
  client: PoolClient,
  kind: Kind,
  id: string,
  actorId: string,
  status: string,
  notes: string,
) {
  await client.query(
    `INSERT INTO public.app_case_history(${field(kind)},actor_user_id,status,notes) VALUES($1,$2,$3,$4)`,
    [id, actorId, status, notes],
  );
}
async function caseView(
  client: PoolClient,
  kind: Kind,
  row: Record<string, any>,
  admin = false,
): Promise<CaseView> {
  const params = [row.id];
  const messages = (
    await client.query(
      `SELECT id,author_role,message,created_at FROM public.app_case_messages WHERE ${field(kind)}=$1 ORDER BY created_at,id`,
      params,
    )
  ).rows;
  const events = (
    await client.query(
      `SELECT status,notes,created_at FROM public.app_case_history WHERE ${field(kind)}=$1 ORDER BY created_at,id`,
      params,
    )
  ).rows;
  const evidence = (
    await client.query(
      `SELECT id,file_name FROM public.app_case_evidence WHERE ${field(kind)}=$1 ORDER BY created_at,id`,
      params,
    )
  ).rows;
  return {
    id: row.id,
    kind,
    status: row.status,
    revision: row.revision,
    reason: row.reason,
    description: row.description,
    orderId: row.order_id ?? null,
    createdAt: new Date(row.created_at).toISOString(),
    ...(kind === "refund"
      ? {
          requestedAmountCents: row.requested_amount_cents,
          approvedAmountCents: row.approved_amount_cents,
        }
      : {
          targetType: row.target_type,
          targetId: row.target_id,
          ...(admin ? { subjectUserId: row.subject_user_id } : {}),
        }),
    messages: messages.map((value) => ({
      id: value.id,
      author: value.author_role,
      message: value.message,
      createdAt: value.created_at.toISOString(),
    })),
    history: events.map((value) => ({
      status: value.status,
      notes: value.notes,
      createdAt: value.created_at.toISOString(),
    })),
    evidence: evidence.map((value) => ({
      id: value.id,
      fileName: value.file_name,
    })),
    ...(admin && kind === "refund" ? {
      sellerContacts: (await client.query("SELECT id,message,created_at FROM public.app_refund_seller_contacts WHERE refund_id=$1 ORDER BY created_at,id",params)).rows.map(v=>({id:v.id,message:v.message,createdAt:v.created_at.toISOString()})),
      seller: await (async()=>{const order=(await client.query("SELECT store_snapshot,order_number,created_at FROM public.app_orders WHERE id=$1",[row.order_id])).rows[0];return {storeName:order.store_snapshot.name,orderNumber:`#HVM-${new Date(order.created_at).getFullYear()}-${String(order.order_number).padStart(5,"0")}`};})(),
    } : {}),
  };
}
export const AfterSalesService = {
  async contactSeller(actor:AdminActorContext,id:string,raw:unknown,context:CommerceAudit) {
    const input=CaseMessageSchema.parse(raw);
    return commerceTransaction(async c=>{
      await commerceAdmin(c,actor,"refund_management");
      return commerceCommand(c,actor.userId,input.commandId,"refund.seller_contact:"+id,input,async()=>{
        const row=await ownCase(c,actor.userId,"refund",id,actor,true);
        if(["rejected","refunded"].includes(row.status))throw new CommerceError("CASE_CLOSED");
        const order=(await c.query("SELECT producer_user_id FROM public.app_orders WHERE id=$1",[row.order_id])).rows[0];
        if(!order?.producer_user_id)throw new CommerceError("SELLER_UNAVAILABLE",409);
        const count=(await c.query("SELECT count(*)::int AS n FROM public.app_refund_seller_contacts WHERE refund_id=$1",[id])).rows[0].n;
        if(count>=100)throw new CommerceError("CASE_MESSAGE_LIMIT",429);
        await c.query("INSERT INTO public.app_refund_seller_contacts(refund_id,author_user_id,message) VALUES($1,$2,$3)",[id,actor.userId,input.message]);
        await commerceAudit(c,actor.userId,actor.role,"refund.seller_contacted","app_refund_requests",id,{},context,input.commandId);
        return caseView(c,"refund",row,true);
      });
    });
  },
  async targets(
    userId: string,
    type: "store" | "producer" | "product" | "customer",
    search: string,
  ) {
    return commerceTransaction(async (client) => {
      const actor = await commerceIdentity(client, userId);
      if (type === "customer") {
        if (!actor.roles.includes("producer"))
          throw new CommerceError("PRODUCER_REQUIRED", 403);
        return {
          targets: (
            await client.query(
              "SELECT customer_user_id AS id,id AS order_id,order_number FROM public.app_orders WHERE producer_user_id=$1 ORDER BY created_at DESC LIMIT 500",
              [userId],
            )
          ).rows.map((row) => ({
            id: row.id,
            name: `Cliente da compra #HVM-${String(row.order_number).padStart(5, "0")}`,
            orderId: row.order_id,
          })),
        };
      }
      const text = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
      const rows =
        type === "product"
          ? (
              await client.query(
                `SELECT p.id,p.title||' · '||s.store_name AS name FROM public.app_products p JOIN public.app_producer_stores s ON s.id=p.store_id WHERE p.is_published AND hvm_store_private.store_is_visible(s.id) AND p.title ILIKE $1 ORDER BY p.title,p.id LIMIT 100`,
                [text],
              )
            ).rows
          : (
              await client.query(
                "SELECT s.id,s.store_name AS name,s.store_slug FROM public.app_producer_stores s WHERE hvm_store_private.store_is_visible(s.id) AND s.store_name ILIKE $1 ORDER BY s.store_name,s.id LIMIT 100",
                [text],
              )
            ).rows;
      return {
        targets: rows.map((row) => ({
          id: row.id,
          name: type === "producer" ? "Produtor de " + row.name : row.name,
          orderId: null,
          storeSlug: row.store_slug,
        })),
      };
    });
  },
  async cases(
    userId: string,
    kind: Kind,
    admin?: AdminActorContext,
    page = 1,
    filter: "all" | "open" | "closed" = "all",
    portalRole?: "consumer"|"producer",
  ) {
    return commerceTransaction(async (client) => {
      if (admin) await commerceAdmin(client, admin, sector(kind));
      else await commerceIdentity(client, userId, kind === "refund" ? "consumer" : undefined);
      const closed =
        kind === "refund"
          ? ["rejected", "refunded"]
          : ["resolved", "dismissed"];
      const params: unknown[] = admin ? [] : [userId];
      const owner = admin
        ? "true"
        : `${kind === "refund" ? "requester_user_id" : "reporter_user_id"}=$1`;
      const stateFilter =
        filter === "all"
          ? ""
          : `AND status ${filter === "open" ? "<> ALL" : "= ANY"}($${params.push(closed)}::varchar[])`;
      const portalFilter = !admin&&portalRole ? (kind === "refund" ? (portalRole === "consumer" ? "" : "AND false") : `AND reporter_role=$${params.push(portalRole)}`) : "";
      const where = `WHERE ${owner} ${stateFilter} ${portalFilter}`;
      const total = (
        await client.query(
          `SELECT count(*)::int AS n FROM public.${table(kind)} ${where}`,
          params,
        )
      ).rows[0].n;
      const limitParam = params.push(50),
        offsetParam = params.push((page - 1) * 50);
      const rows = (
        await client.query(
          `SELECT * FROM public.${table(kind)} ${where} ORDER BY created_at DESC,id DESC LIMIT $${limitParam} OFFSET $${offsetParam}`,
          params,
        )
      ).rows;
      // List summaries avoid N+1 message/evidence queries; detail is separately authorized.
      return {
        page,
        pages: Math.max(1, Math.ceil(total / 50)),
        total,
        cases: rows.map((row) => ({
          id: row.id,
          kind,
          status: row.status,
          revision: row.revision,
          reason: row.reason,
          description: row.description,
          orderId: row.order_id,
          createdAt: row.created_at.toISOString(),
          ...(kind === "refund"
            ? {
                requestedAmountCents: row.requested_amount_cents,
                approvedAmountCents: row.approved_amount_cents,
              }
            : {
                targetType: row.target_type,
                targetId: row.target_id,
                ...(admin ? { subjectUserId: row.subject_user_id } : {}),
              }),
          messages: [],
          history: [],
          evidence: [],
        })),
      };
    });
  },
  async detail(
    userId: string,
    kind: Kind,
    id: string,
    admin?: AdminActorContext,
    portalRole?: "consumer"|"producer",
  ) {
    return commerceTransaction(async (client) =>
      caseView(
        client,
        kind,
        await ownCase(client, userId, kind, id, admin, false, portalRole),
        !!admin,
      ),
    );
  },
  async requestRefund(userId: string, raw: unknown, context: CommerceAudit) {
    const input = CreateRefundSchema.parse(raw);
    return commerceTransaction(async (client) => {
      await commerceIdentity(client, userId, "consumer");
      return commerceCommand(
        client,
        userId,
        input.commandId,
        "refund.request",
        input,
        async () => {
          const order = (
            await client.query(
              `SELECT o.*,h.refunded_cents,h.state AS hold_state FROM public.app_orders o JOIN public.app_financial_holds h ON h.order_id=o.id WHERE o.id=$1 AND o.customer_user_id=$2 FOR UPDATE OF o,h`,
              [input.orderId, userId],
            )
          ).rows[0];
          if (!order) throw new CommerceError("ORDER_NOT_FOUND", 404);
          if (
            order.status === "refunded" ||
            input.requestedAmountCents >
              order.total_cents - order.refunded_cents
          )
            throw new CommerceError("REFUND_AMOUNT_INVALID", 422);
          if (order.hold_state === "released")
            throw new CommerceError("REFUND_REQUIRES_RECONCILIATION");
          if (input.reason === "withdrawal") {
            const policy = CommercePolicySchema.parse(order.policy_snapshot),
              days =
                order.source === "online"
                  ? policy.onlineWithdrawalDays
                  : policy.inPersonReturnDays;
            if (!days)
              throw new CommerceError(
                "IN_PERSON_WITHDRAWAL_NOT_APPLICABLE",
                422,
              );
            if (
              order.received_at &&
              new Date(order.received_at).getTime() + days * 86400000 <
                Date.now()
            )
              throw new CommerceError("WITHDRAWAL_PERIOD_ENDED", 422);
          }
          // Quality/hidden-defect and fraud claims are accepted for human review;
          // a commercial date must never erase statutory rights.
          const refund = (
            await client.query(
              `INSERT INTO public.app_refund_requests(order_id,requester_user_id,reason,description,requested_amount_cents) VALUES($1,$2,$3,$4,$5) RETURNING *`,
              [
                input.orderId,
                userId,
                input.reason,
                input.description,
                input.requestedAmountCents,
              ],
            )
          ).rows[0];
          await client.query(
            "UPDATE public.app_financial_holds SET state='disputed',updated_at=clock_timestamp() WHERE order_id=$1",
            [order.id],
          );
          await history(
            client,
            "refund",
            refund.id,
            userId,
            "requested",
            "Solicitação registrada pelo cliente. Repasse bloqueado durante a análise.",
          );
          await commerceAudit(
            client,
            userId,
            "consumer",
            "refund.requested",
            "app_refund_requests",
            refund.id,
            {
              orderId: order.id,
              reason: input.reason,
              amountCents: input.requestedAmountCents,
            },
            context,
            input.commandId,
          );
          return caseView(client, "refund", refund);
        },
      );
    });
  },
  async decideRefund(
    actor: AdminActorContext,
    id: string,
    raw: unknown,
    context: CommerceAudit,
  ) {
    const input = RefundDecisionSchema.parse(raw);
    return commerceTransaction(async (client) => {
      await commerceAdmin(client, actor, "refund_management");
      return commerceCommand(
        client,
        actor.userId,
        input.commandId,
        "refund.decision:" + id,
        input,
        async () => {
          // Every financial case locks its order before its request/hold.
          const located = (
            await client.query(
              "SELECT order_id FROM public.app_refund_requests WHERE id=$1",
              [z.uuid().parse(id)],
            )
          ).rows[0];
          if (!located) throw new CommerceError("CASE_NOT_FOUND", 404);
          await client.query(
            "SELECT id FROM public.app_orders WHERE id=$1 FOR UPDATE",
            [located.order_id],
          );
          const row = await ownCase(
            client,
            actor.userId,
            "refund",
            id,
            actor,
            true,
          );
          if (row.revision !== input.expectedRevision)
            throw new CommerceError("REVISION_CONFLICT");
          if (!["requested", "under_review"].includes(row.status))
            throw new CommerceError("CASE_STATE_CONFLICT");
          const hold = (
            await client.query(
              "SELECT * FROM public.app_financial_holds WHERE order_id=$1 FOR UPDATE",
              [row.order_id],
            )
          ).rows[0];
          if (
            input.decision === "approve" &&
            (!input.approvedAmountCents ||
              input.approvedAmountCents > row.requested_amount_cents ||
              input.approvedAmountCents >
                hold.amount_cents - hold.refunded_cents)
          )
            throw new CommerceError("REFUND_AMOUNT_INVALID", 422);
          const status =
            input.decision === "approve"
              ? "approved"
              : input.decision === "reject"
                ? "rejected"
                : "under_review";
          const next = (
            await client.query(
              "UPDATE public.app_refund_requests SET status=$2,approved_amount_cents=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
              [id, status, input.approvedAmountCents ?? null],
            )
          ).rows[0];
          // Approval is not a payment. The hold remains blocked until a verified refund.
          const unresolved = (
            await client.query(
              "SELECT 1 FROM public.app_complaints WHERE order_id=$1 AND status NOT IN ('resolved','dismissed') LIMIT 1",
              [row.order_id],
            )
          ).rowCount;
          await client.query(
            "UPDATE public.app_financial_holds SET state=$2,updated_at=clock_timestamp() WHERE order_id=$1",
            [
              row.order_id,
              status === "approved"
                ? "refund_pending"
                : status === "rejected" && !unresolved
                  ? hold.refunded_cents
                    ? "partially_refunded"
                    : "held"
                  : "disputed",
            ],
          );
          await history(
            client,
            "refund",
            id,
            actor.userId,
            status,
            input.notes,
          );
          await commerceAudit(
            client,
            actor.userId,
            actor.role,
            "refund.decided",
            "app_refund_requests",
            id,
            { status, amountCents: input.approvedAmountCents ?? null },
            context,
            input.commandId,
          );
          return caseView(client, "refund", next, true);
        },
      );
    });
  },
  async processRefund(
    actor: AdminActorContext,
    id: string,
    context: CommerceAudit,
  ) {
    const gateway = getPaymentGateway();
    if (!gateway) throw new CommerceError("GATEWAY_NOT_CONFIGURED", 503);
    const request = await commerceTransaction(async (client) => {
      await commerceAdmin(client, actor, "refund_management");
      const refund = await ownCase(
        client,
        actor.userId,
        "refund",
        id,
        actor,
        true,
      );
      if (refund.status === "refunded") return { done: true } as const;
      if (!["approved", "processing"].includes(refund.status))
        throw new CommerceError("CASE_STATE_CONFLICT");
      const intent = (
        await client.query(
          "SELECT p.gateway_reference FROM public.app_payment_intents p JOIN public.app_orders o ON o.payment_intent_id=p.id WHERE o.id=$1",
          [refund.order_id],
        )
      ).rows[0];
      if (!intent?.gateway_reference)
        throw new CommerceError("PAYMENT_REFERENCE_MISSING");
      await client.query(
        "UPDATE public.app_refund_requests SET status='processing',revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 AND status='approved'",
        [id],
      );
      return {
        done: false,
        paymentReference: intent.gateway_reference as string,
        amountCents: refund.approved_amount_cents as number,
      } as const;
    });
    if (request.done) return { status: "refunded" };
    // Provider idempotency key is the immutable refund id, including retries.
    const result = await gateway.refund({
      paymentReference: request.paymentReference,
      refundId: id,
      amountCents: request.amountCents,
    });
    if (result.status !== "refunded") return { status: "processing" };
    return commerceTransaction((client) =>
      completeVerifiedRefund(
        client,
        id,
        gateway.provider,
        result.reference,
        request.amountCents,
        actor,
        context,
      ),
    );
  },
  async createComplaint(userId: string, raw: unknown, context: CommerceAudit, portalRole?: "consumer"|"producer") {
    const input = CreateComplaintSchema.parse(raw);
    return commerceTransaction(async (client) => {
      const actor = await commerceIdentity(client, userId);
      return commerceCommand(
        client,
        userId,
        input.commandId,
        "complaint.create",
        input,
        async () => {
          let subject: string | null = null;
          let reporterRole = portalRole ?? (actor.roles.includes("consumer") ? "consumer" : "producer");
          if(!actor.roles.includes(reporterRole))throw new CommerceError("FORBIDDEN",403);
          const order = input.orderId
            ? (
                await client.query(
                  "SELECT * FROM public.app_orders WHERE id=$1 AND (customer_user_id=$2 OR producer_user_id=$2) FOR UPDATE",
                  [input.orderId, userId],
                )
              ).rows[0]
            : null;
          if (input.orderId && !order)
            throw new CommerceError("ORDER_NOT_FOUND", 404);
          if (input.targetType === "customer") {
            if (
              !actor.roles.includes("producer") ||
              !order ||
              order.producer_user_id !== userId ||
              order.customer_user_id !== input.targetId
            )
              throw new CommerceError("COMPLAINT_RELATIONSHIP_REQUIRED", 403);
            subject = input.targetId;
            reporterRole = "producer";
          } else {
            // Only the buyer's own order can grant access to a hidden purchased target.
            const purchased = order?.customer_user_id === userId;
            if (input.targetType === "store") {
              const store = (
                await client.query(
                  `SELECT pe.user_id FROM public.app_producer_stores s JOIN public.app_producer_profiles pp ON pp.id=s.producer_profile_id JOIN public.app_people pe ON pe.id=pp.person_id WHERE s.id=$1 AND (hvm_store_private.store_is_visible(s.id) OR $2)`,
                  [
                    input.targetId,
                    !!purchased && order.store_id === input.targetId,
                  ],
                )
              ).rows[0];
              if (!store)
                throw new CommerceError("COMPLAINT_TARGET_NOT_FOUND", 404);
              subject = store.user_id;
            } else if (input.targetType === "product") {
              const product = (
                await client.query(
                  `SELECT pe.user_id FROM public.app_products p JOIN public.app_producer_stores s ON s.id=p.store_id JOIN public.app_producer_profiles pp ON pp.id=s.producer_profile_id JOIN public.app_people pe ON pe.id=pp.person_id WHERE p.id=$1 AND ((p.is_published AND hvm_store_private.store_is_visible(s.id)) OR $2)`,
                  [
                    input.targetId,
                    !!purchased &&
                      (
                        order.items_snapshot as Array<{ productId: string }>
                      ).some((item) => item.productId === input.targetId),
                  ],
                )
              ).rows[0];
              if (!product)
                throw new CommerceError("COMPLAINT_TARGET_NOT_FOUND", 404);
              subject = product.user_id;
            } else {
              const producer = (
                await client.query(
                  `SELECT pe.user_id FROM public.app_people pe JOIN public.app_producer_profiles pp ON pp.person_id=pe.id JOIN public.app_producer_stores s ON s.producer_profile_id=pp.id WHERE (s.id=$1 OR pe.user_id=$1) AND (hvm_store_private.store_is_visible(s.id) OR $2)`,
                  [
                    input.targetId,
                    !!purchased &&
                      (order.producer_user_id === input.targetId ||
                        order.store_id === input.targetId),
                  ],
                )
              ).rows[0];
              if (!producer)
                throw new CommerceError("COMPLAINT_TARGET_NOT_FOUND", 404);
              subject = producer.user_id;
            }
            if (subject === userId)
              throw new CommerceError("COMPLAINT_SELF_TARGET", 422);
            if (order && purchased) {
              const relates =
                input.targetType === "store"
                  ? order.store_id === input.targetId
                  : input.targetType === "producer"
                    ? order.producer_user_id === input.targetId ||
                      order.store_id === input.targetId
                    : (
                        order.items_snapshot as Array<{ productId: string }>
                      ).some((item) => item.productId === input.targetId);
              if (!relates)
                throw new CommerceError("COMPLAINT_RELATIONSHIP_REQUIRED", 403);
            } else if (order)
              throw new CommerceError("COMPLAINT_RELATIONSHIP_REQUIRED", 403);
          }
          const recent = (
            await client.query(
              "SELECT count(*)::int AS n FROM public.app_complaints WHERE reporter_user_id=$1 AND created_at>clock_timestamp()-interval '1 day'",
              [userId],
            )
          ).rows[0].n;
          if (recent >= 20)
            throw new CommerceError("COMPLAINT_RATE_LIMIT", 429);
          const row = (
            await client.query(
              `INSERT INTO public.app_complaints(reporter_user_id,reporter_role,target_type,target_id,subject_user_id,order_id,reason,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
              [
                userId,
                reporterRole,
                input.targetType,
                input.targetId,
                subject,
                input.orderId,
                input.reason,
                input.description,
              ],
            )
          ).rows[0];
          if (order)
            await client.query(
              "UPDATE public.app_financial_holds SET state=CASE WHEN state IN ('held','partially_refunded') THEN 'disputed' ELSE state END,updated_at=clock_timestamp() WHERE order_id=$1",
              [order.id],
            );
          await history(
            client,
            "complaint",
            row.id,
            userId,
            "submitted",
            "Denúncia registrada. A análise será conduzida pela equipe autorizada de segurança.",
          );
          await commerceAudit(
            client,
            userId,
            reporterRole,
            "complaint.submitted",
            "app_complaints",
            row.id,
            {
              targetType: input.targetType,
              targetId: input.targetId,
              reason: input.reason,
            },
            context,
            input.commandId,
          );
          return caseView(client, "complaint", row);
        },
      );
    });
  },
  async decideComplaint(
    actor: AdminActorContext,
    id: string,
    raw: unknown,
    context: CommerceAudit,
  ) {
    const input = ComplaintDecisionSchema.parse(raw);
    return commerceTransaction(async (client) => {
      await commerceAdmin(client, actor, "complaint_management");
      return commerceCommand(
        client,
        actor.userId,
        input.commandId,
        "complaint.decision:" + id,
        input,
        async () => {
          const located = (
            await client.query(
              "SELECT order_id FROM public.app_complaints WHERE id=$1",
              [z.uuid().parse(id)],
            )
          ).rows[0];
          if (!located) throw new CommerceError("CASE_NOT_FOUND", 404);
          if (located.order_id)
            await client.query(
              "SELECT id FROM public.app_orders WHERE id=$1 FOR UPDATE",
              [located.order_id],
            );
          const row = await ownCase(
            client,
            actor.userId,
            "complaint",
            id,
            actor,
            true,
          );
          if (row.revision !== input.expectedRevision)
            throw new CommerceError("REVISION_CONFLICT");
          if (["resolved", "dismissed"].includes(row.status))
            throw new CommerceError("CASE_STATE_CONFLICT");
          const status = (
            {
              review: "under_review",
              request_information: "awaiting_information",
              resolve: "resolved",
              dismiss: "dismissed",
            } as const
          )[input.decision];
          const next = (
            await client.query(
              "UPDATE public.app_complaints SET status=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
              [id, status],
            )
          ).rows[0];
          if (row.order_id && ["resolved", "dismissed"].includes(status)) {
            const other = (
              await client.query(
                "SELECT 1 FROM public.app_complaints WHERE order_id=$1 AND status NOT IN ('resolved','dismissed') LIMIT 1",
                [row.order_id],
              )
            ).rowCount;
            const refunds = (
              await client.query(
                "SELECT 1 FROM public.app_refund_requests WHERE order_id=$1 AND status NOT IN ('rejected','refunded') LIMIT 1",
                [row.order_id],
              )
            ).rowCount;
            if (!other && !refunds)
              await client.query(
                "UPDATE public.app_financial_holds SET state=CASE WHEN refunded_cents>0 THEN 'partially_refunded' ELSE 'held' END,updated_at=clock_timestamp() WHERE order_id=$1 AND state='disputed'",
                [row.order_id],
              );
          }
          await history(
            client,
            "complaint",
            id,
            actor.userId,
            status,
            input.notes,
          );
          await commerceAudit(
            client,
            actor.userId,
            actor.role,
            "complaint.decided",
            "app_complaints",
            id,
            { status, subjectUserId: row.subject_user_id },
            context,
            input.commandId,
          );
          return caseView(client, "complaint", next, true);
        },
      );
    });
  },
  async message(
    userId: string,
    kind: Kind,
    id: string,
    raw: unknown,
    context: CommerceAudit,
    admin?: AdminActorContext,
    portalRole?: "consumer"|"producer",
  ) {
    const input = CaseMessageSchema.parse(raw);
    return commerceTransaction(async (client) => {
      await ownCase(client, userId, kind, id, admin, false, portalRole);
      return commerceCommand(
        client,
        userId,
        input.commandId,
        kind + ".message:" + id,
        input,
        async () => {
          const row = await ownCase(client, userId, kind, id, admin, true, portalRole);
          if (
            ["resolved", "dismissed", "rejected", "refunded"].includes(
              row.status,
            )
          )
            throw new CommerceError("CASE_CLOSED");
          if (
            (
              await client.query(
                `SELECT count(*)::int AS n FROM public.app_case_messages WHERE ${field(kind)}=$1`,
                [id],
              )
            ).rows[0].n >= 200
          )
            throw new CommerceError("CASE_MESSAGE_LIMIT", 429);
          const role = admin
            ? "admin"
            : kind === "complaint" && row.reporter_role === "producer"
              ? "producer"
              : "customer";
          await client.query(
            `INSERT INTO public.app_case_messages(${field(kind)},author_user_id,author_role,message) VALUES($1,$2,$3,$4)`,
            [id, userId, role, input.message],
          );
          await commerceAudit(
            client,
            userId,
            admin?.role ?? role,
            "case.message_added",
            table(kind),
            id,
            {},
            context,
            input.commandId,
          );
          return caseView(client, kind, row, !!admin);
        },
      );
    });
  },
  async uploadEvidence(
    userId: string,
    raw: unknown,
    context: CommerceAudit,
    admin?: AdminActorContext,
    portalRole?: "consumer"|"producer",
  ) {
    const input = CaseEvidenceSchema.parse(raw),
      bytes = Buffer.from(input.base64, "base64");
    const magic =
      input.mimeType === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : input.mimeType === "image/png"
          ? bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : input.mimeType === "image/webp"
            ? bytes.subarray(0, 4).toString() === "RIFF" &&
              bytes.subarray(8, 12).toString() === "WEBP"
            : bytes.subarray(0, 5).toString() === "%PDF-";
    if (!magic || bytes.length < 12 || bytes.length > 2097152)
      throw new CommerceError("EVIDENCE_INVALID", 422);
    const existing = await commerceTransaction(async (client) => {
      await ownCase(client, userId, input.caseType, input.caseId, admin, false, portalRole);
      const receipt = (
        await client.query(
          "SELECT response_body FROM public.app_commerce_receipts WHERE command_id=$1 AND user_id=$2 AND operation=$3",
          [input.commandId, userId, "case.evidence:" + input.caseId],
        )
      ).rows[0];
      if (receipt) return receipt;
      const n = (
        await client.query(
          `SELECT count(*)::int AS n FROM public.app_case_evidence WHERE ${field(input.caseType)}=$1`,
          [input.caseId],
        )
      ).rows[0].n;
      if (n >= 10) throw new CommerceError("EVIDENCE_LIMIT", 422);
      return null;
    });
    // All replays still pass through payload hash verification below.
    const id = randomUUID(),
      extension = (
        {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
          "application/pdf": "pdf",
        } as const
      )[input.mimeType];
    const path = `${userId}/${input.caseId}/${id}.${extension}`;
    if (!supabaseAdmin) throw new CommerceError("DEPENDENCY_UNAVAILABLE", 503);
    let uploaded = false;
    try {
      if (!existing) {
        const result = await supabaseAdmin.storage
          .from("case-evidence")
          .upload(path, bytes, {
            contentType: input.mimeType,
            upsert: false,
            cacheControl: "60",
          });
        if (result.error)
          throw new CommerceError("EVIDENCE_UPLOAD_FAILED", 503);
        uploaded = true;
      }
      const value = await commerceTransaction(async (client) => {
        await ownCase(client, userId, input.caseType, input.caseId, admin, false, portalRole);
        return commerceCommand(
          client,
          userId,
          input.commandId,
          "case.evidence:" + input.caseId,
          input,
          async () => {
            const row = await ownCase(
              client,
              userId,
              input.caseType,
              input.caseId,
              admin,
              true,
              portalRole,
            );
            if (
              ["resolved", "dismissed", "rejected", "refunded"].includes(
                row.status,
              )
            )
              throw new CommerceError("CASE_CLOSED");
            if (
              (
                await client.query(
                  `SELECT count(*)::int AS n FROM public.app_case_evidence WHERE ${field(input.caseType)}=$1`,
                  [input.caseId],
                )
              ).rows[0].n >= 10
            )
              throw new CommerceError("EVIDENCE_LIMIT", 422);
            await client.query(
              `INSERT INTO public.app_case_evidence(id,${field(input.caseType)},uploader_user_id,storage_path,file_name,mime_type) VALUES($1,$2,$3,$4,$5,$6)`,
              [
                id,
                input.caseId,
                userId,
                path,
                input.fileName.replace(/[\x00-\x1f/\\]/g, "_"),
                input.mimeType,
              ],
            );
            await commerceAudit(
              client,
              userId,
              admin?.role ?? "authenticated",
              "case.evidence_added",
              table(input.caseType),
              input.caseId,
              { evidenceId: id },
              context,
              input.commandId,
            );
            return { id };
          },
        );
      });
      if (uploaded && value.id !== id) {
        const removed = await supabaseAdmin.storage
          .from("case-evidence")
          .remove([path])
          .catch(() => ({ error: true }));
        if (removed.error)
          await commerceTransaction((client) =>
            client.query(
              "INSERT INTO public.app_storage_deletion_queue(bucket,object_path,reason) VALUES('case-evidence',$1,'replayed-case-evidence') ON CONFLICT DO NOTHING",
              [path],
            ),
          ).catch(() => {});
      }
      return value;
    } catch (error) {
      if (uploaded) {
        const removed = await supabaseAdmin.storage
          .from("case-evidence")
          .remove([path])
          .catch(() => ({ error: true }));
        if (removed.error)
          await commerceTransaction((client) =>
            client.query(
              "INSERT INTO public.app_storage_deletion_queue(bucket,object_path,reason) VALUES('case-evidence',$1,'failed-case-evidence') ON CONFLICT DO NOTHING",
              [path],
            ),
          ).catch(() => {});
      }
      throw error;
    }
  },
  async evidence(userId: string, id: string, admin?: AdminActorContext, portalRole?: "consumer"|"producer") {
    return commerceTransaction(async (client) => {
      z.uuid().parse(id);
      const row = (
        await client.query(
          "SELECT * FROM public.app_case_evidence WHERE id=$1",
          [id],
        )
      ).rows[0];
      if (!row) throw new CommerceError("EVIDENCE_NOT_FOUND", 404);
      await ownCase(
        client,
        userId,
        row.refund_id ? "refund" : "complaint",
        row.refund_id ?? row.complaint_id,
        admin,
        false,
        portalRole,
      );
      if (!supabaseAdmin)
        throw new CommerceError("DEPENDENCY_UNAVAILABLE", 503);
      const result = await supabaseAdmin.storage
        .from("case-evidence")
        .createSignedUrl(row.storage_path, 60, { download: row.file_name });
      if (result.error || !result.data?.signedUrl)
        throw new CommerceError("DEPENDENCY_UNAVAILABLE", 503);
      return { url: result.data.signedUrl };
    });
  },
};

/** Only called with a refund retrieved from the authenticated gateway API. */
export async function completeVerifiedRefund(
  client: PoolClient,
  id: string,
  provider: string,
  reference: string,
  amountCents: number,
  actor: AdminActorContext,
  context: CommerceAudit,
) {
  z.string().min(1).max(120).parse(reference);
  const located = (
    await client.query(
      "SELECT order_id FROM public.app_refund_requests WHERE id=$1",
      [z.uuid().parse(id)],
    )
  ).rows[0];
  if (!located) throw new CommerceError("CASE_NOT_FOUND", 404);
  const order = (
    await client.query(
      "SELECT * FROM public.app_orders WHERE id=$1 FOR UPDATE",
      [located.order_id],
    )
  ).rows[0];
  const refund = (
    await client.query(
      "SELECT * FROM public.app_refund_requests WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (refund.status === "refunded") {
    if (
      refund.gateway_refund_reference !== reference ||
      refund.approved_amount_cents !== amountCents
    )
      throw new CommerceError("REFUND_EVENT_CONFLICT");
    return { status: "refunded", replayed: true };
  }
  if (
    !["approved", "processing"].includes(refund.status) ||
    refund.approved_amount_cents !== amountCents
  )
    throw new CommerceError("REFUND_VALUES_MISMATCH");
  const hold = (
    await client.query(
      "SELECT * FROM public.app_financial_holds WHERE order_id=$1 FOR UPDATE",
      [order.id],
    )
  ).rows[0];
  if (hold.refunded_cents + amountCents > hold.amount_cents)
    throw new CommerceError("REFUND_VALUES_MISMATCH");
  const refunded = hold.refunded_cents + amountCents;
  await client.query(
    "INSERT INTO public.app_payment_transactions(provider,gateway_event_id,payment_intent_id,event_type,amount_received_cents) VALUES($1,$2,$3,'refunded',$4)",
    [provider, "refund:" + reference, order.payment_intent_id, amountCents],
  );
  await client.query(
    "UPDATE public.app_refund_requests SET status='refunded',gateway_refund_reference=$2,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",
    [id, reference],
  );
  const unresolved = (
    await client.query(
      "SELECT 1 FROM public.app_complaints WHERE order_id=$1 AND status NOT IN ('resolved','dismissed') LIMIT 1",
      [order.id],
    )
  ).rowCount;
  await client.query(
    "UPDATE public.app_financial_holds SET refunded_cents=$2,state=$3,updated_at=clock_timestamp() WHERE order_id=$1",
    [
      order.id,
      refunded,
      refunded === hold.amount_cents
        ? "refunded"
        : unresolved
          ? "disputed"
          : "partially_refunded",
    ],
  );
  if (refunded === hold.amount_cents)
    await client.query(
      "UPDATE public.app_orders SET status='refunded' WHERE id=$1",
      [order.id],
    );
  const remaining = (
    await client.query(
      "SELECT 1 FROM public.app_orders o JOIN public.app_financial_holds h ON h.order_id=o.id WHERE o.payment_intent_id=$1 AND h.refunded_cents<h.amount_cents LIMIT 1",
      [order.payment_intent_id],
    )
  ).rowCount;
  if (!remaining)
    await client.query(
      "UPDATE public.app_payment_intents SET status='refunded',updated_at=clock_timestamp() WHERE id=$1",
      [order.payment_intent_id],
    );
  await history(
    client,
    "refund",
    id,
    actor.userId,
    "refunded",
    "O provedor confirmou o estorno. O valor devolvido está registrado no histórico financeiro.",
  );
  await commerceAudit(
    client,
    actor.userId,
    actor.role,
    "refund.gateway_confirmed",
    "app_refund_requests",
    id,
    { amountCents, provider },
    context,
  );
  return { status: "refunded", replayed: false };
}
