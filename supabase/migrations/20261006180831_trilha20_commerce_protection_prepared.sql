-- T20 preparada a pedido do titular: nenhuma cobrança, estorno ou repasse sem
-- gateway real. Aditiva sobre schema 57; preserva hard deletion T06/v46.
SET lock_timeout = '5s';
-- Scoped read access for live capability checks; no client grants change.
GRANT SELECT ON public.app_admin_principals,public.app_admin_sector_members,public.app_admin_sectors TO service_role;
ALTER TABLE public.app_payment_intents DROP CONSTRAINT app_payment_intents_method_check;
ALTER TABLE public.app_payment_intents ADD CONSTRAINT app_payment_intents_method_check CHECK (method IN ('pix','credit_card','debit_card'));

INSERT INTO public.app_admin_sectors(code,name,description) VALUES
 ('refund_management','Reembolsos e proteção da compra','Análise de solicitações e política comercial; decisões auditadas, estorno confirmado somente pelo gateway'),
 ('complaint_management','Denúncias e segurança','Triagem privada, investigação e encaminhamento à governança existente'),
 ('payment_configuration','Preparação de pagamentos','Configuração de referências da conta central e maquininha, sem acesso a dados de cartão')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE public.app_commerce_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 policy jsonb NOT NULL CHECK (jsonb_typeof(policy)='object'),
 gateway jsonb NOT NULL CHECK (jsonb_typeof(gateway)='object'),
 updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.app_commerce_settings(policy,gateway) VALUES (
 '{"version":1,"onlineWithdrawalDays":7,"inPersonReturnDays":0,"holdingDays":7,"additionalTerms":""}',
 '{"provider":"unselected","accountLabel":"","merchantReference":"","platformPixKey":"","terminalReference":""}'
);
CREATE TABLE public.app_commerce_receipts (
 command_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 operation varchar(100) NOT NULL,
 payload_hash char(64) NOT NULL,
 response_body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_commerce_receipts_user ON public.app_commerce_receipts(user_id);

CREATE TABLE public.app_pos_sales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code char(32) NOT NULL UNIQUE CHECK (code ~ '^[a-f0-9]{32}$'),
 producer_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 store_id uuid REFERENCES public.app_producer_stores(id) ON DELETE SET NULL,
 store_snapshot jsonb NOT NULL,
 customer_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 items_snapshot jsonb NOT NULL CHECK (jsonb_typeof(items_snapshot)='array' AND jsonb_array_length(items_snapshot)>0),
 total_cents integer NOT NULL CHECK (total_cents>0),
 payment_method varchar(32) NOT NULL CHECK (payment_method IN ('pix','credit_card','debit_card')),
 payment_channel varchar(32) NOT NULL CHECK (payment_channel IN ('system_pix','terminal')),
 status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','accepted','cancelled','paid')),
 policy_snapshot jsonb NOT NULL,
 accepted_at timestamptz,
 reservation_ids uuid[] NOT NULL DEFAULT '{}',
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT pos_payment_channel CHECK ((payment_method='pix')=(payment_channel='system_pix'))
);
CREATE INDEX ix_pos_sales_producer ON public.app_pos_sales(producer_user_id,created_at DESC);
CREATE INDEX ix_pos_sales_customer ON public.app_pos_sales(customer_user_id,created_at DESC) WHERE customer_user_id IS NOT NULL;
CREATE INDEX ix_pos_sales_store ON public.app_pos_sales(store_id) WHERE store_id IS NOT NULL;
ALTER TABLE public.app_payment_intents ALTER COLUMN quote_id DROP NOT NULL;
ALTER TABLE public.app_payment_intents ADD COLUMN pos_sale_id uuid UNIQUE REFERENCES public.app_pos_sales(id) ON DELETE CASCADE;
ALTER TABLE public.app_payment_intents ADD CONSTRAINT payment_intent_source CHECK (num_nonnulls(quote_id,pos_sale_id)=1);
CREATE TABLE public.app_payment_policy_acceptances (
 payment_intent_id uuid PRIMARY KEY REFERENCES public.app_payment_intents(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 policy_snapshot jsonb NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_payment_acceptances_user ON public.app_payment_policy_acceptances(user_id);

CREATE TABLE public.app_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 payment_intent_id uuid NOT NULL REFERENCES public.app_payment_intents(id) ON DELETE CASCADE,
 customer_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 producer_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 store_id uuid REFERENCES public.app_producer_stores(id) ON DELETE SET NULL,
 store_snapshot jsonb NOT NULL,
 source varchar(16) NOT NULL CHECK (source IN ('online','pos')),
 items_snapshot jsonb NOT NULL CHECK (jsonb_typeof(items_snapshot)='array' AND jsonb_array_length(items_snapshot)>0),
 address_snapshot jsonb,
 subtotal_cents integer NOT NULL CHECK (subtotal_cents>0),
 delivery_fee_cents integer NOT NULL CHECK (delivery_fee_cents>=0),
 total_cents integer NOT NULL CHECK (total_cents=subtotal_cents+delivery_fee_cents AND total_cents>0),
 policy_snapshot jsonb NOT NULL,
 status varchar(16) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','received','refunded')),
 received_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(payment_intent_id,store_id)
);
CREATE INDEX ix_orders_customer ON public.app_orders(customer_user_id,created_at DESC);
CREATE INDEX ix_orders_producer ON public.app_orders(producer_user_id,created_at DESC) WHERE producer_user_id IS NOT NULL;
CREATE INDEX ix_orders_store ON public.app_orders(store_id) WHERE store_id IS NOT NULL;
CREATE TABLE public.app_financial_holds (
 order_id uuid PRIMARY KEY REFERENCES public.app_orders(id) ON DELETE CASCADE,
 amount_cents integer NOT NULL CHECK (amount_cents>0),
 state varchar(24) NOT NULL DEFAULT 'held' CHECK (state IN ('held','disputed','refund_pending','partially_refunded','refunded','released')),
 release_after timestamptz,
 refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents BETWEEN 0 AND amount_cents),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Provider events/ledger are append only; they are never exposed to clients.
CREATE TABLE public.app_payment_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider varchar(32) NOT NULL,
 gateway_event_id varchar(255) NOT NULL,
 payment_intent_id uuid NOT NULL REFERENCES public.app_payment_intents(id) ON DELETE CASCADE,
 event_type varchar(24) NOT NULL CHECK (event_type IN ('approved','refunded')),
 amount_received_cents integer NOT NULL CHECK (amount_received_cents>0),
 raw_payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(raw_payload)='object'),
 processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(provider,gateway_event_id)
);
CREATE INDEX ix_payment_events_intent ON public.app_payment_transactions(payment_intent_id);
CREATE TABLE public.app_refund_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.app_orders(id) ON DELETE CASCADE,
 requester_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 reason varchar(32) NOT NULL CHECK (reason IN ('withdrawal','quality','missing_items','not_delivered','wrong_product','other')),
 description text NOT NULL CHECK (length(description) BETWEEN 10 AND 4000),
 requested_amount_cents integer NOT NULL CHECK (requested_amount_cents>0),
 approved_amount_cents integer CHECK (approved_amount_cents>0 AND approved_amount_cents<=requested_amount_cents),
 status varchar(24) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','under_review','approved','rejected','processing','refunded')),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 gateway_refund_reference varchar(128),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_refunds_order ON public.app_refund_requests(order_id);
CREATE INDEX ix_refunds_requester ON public.app_refund_requests(requester_user_id,created_at DESC);
CREATE INDEX ix_refunds_queue ON public.app_refund_requests(status,created_at);
CREATE UNIQUE INDEX uq_refunds_open_order ON public.app_refund_requests(order_id) WHERE status NOT IN ('rejected','refunded');
CREATE TABLE public.app_complaints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 reporter_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 reporter_role varchar(16) NOT NULL CHECK (reporter_role IN ('consumer','producer')),
 target_type varchar(16) NOT NULL CHECK (target_type IN ('store','producer','product','customer')),
 target_id uuid NOT NULL,
 subject_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 order_id uuid REFERENCES public.app_orders(id) ON DELETE SET NULL,
 reason varchar(32) NOT NULL CHECK (reason IN ('fraud','unsafe_food','harassment','misleading_information','payment_issue','other')),
 description text NOT NULL CHECK (length(description) BETWEEN 10 AND 4000),
 status varchar(24) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','awaiting_information','resolved','dismissed')),
 revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_complaints_reporter ON public.app_complaints(reporter_user_id,created_at DESC);
CREATE INDEX ix_complaints_subject ON public.app_complaints(subject_user_id) WHERE subject_user_id IS NOT NULL;
CREATE INDEX ix_complaints_order ON public.app_complaints(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX ix_complaints_queue ON public.app_complaints(status,created_at);
CREATE INDEX ix_complaints_target ON public.app_complaints(target_type,target_id);
CREATE TABLE public.app_case_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 refund_id uuid REFERENCES public.app_refund_requests(id) ON DELETE CASCADE,
 complaint_id uuid REFERENCES public.app_complaints(id) ON DELETE CASCADE,
 author_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 author_role varchar(16) NOT NULL CHECK (author_role IN ('customer','producer','admin')),
 message text NOT NULL CHECK (length(message) BETWEEN 10 AND 4000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (num_nonnulls(refund_id,complaint_id)=1)
);
CREATE TABLE public.app_case_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 refund_id uuid REFERENCES public.app_refund_requests(id) ON DELETE CASCADE,
 complaint_id uuid REFERENCES public.app_complaints(id) ON DELETE CASCADE,
 actor_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 status varchar(24) NOT NULL,
 notes text NOT NULL CHECK (length(notes) BETWEEN 10 AND 4000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (num_nonnulls(refund_id,complaint_id)=1)
);
CREATE TABLE public.app_case_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 refund_id uuid REFERENCES public.app_refund_requests(id) ON DELETE CASCADE,
 complaint_id uuid REFERENCES public.app_complaints(id) ON DELETE CASCADE,
 uploader_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 storage_path text NOT NULL UNIQUE,
 file_name varchar(120) NOT NULL,
 mime_type varchar(32) NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK (num_nonnulls(refund_id,complaint_id)=1)
);
CREATE INDEX ix_case_messages_refund ON public.app_case_messages(refund_id,created_at) WHERE refund_id IS NOT NULL;
CREATE INDEX ix_case_messages_complaint ON public.app_case_messages(complaint_id,created_at) WHERE complaint_id IS NOT NULL;
CREATE INDEX ix_case_messages_author ON public.app_case_messages(author_user_id) WHERE author_user_id IS NOT NULL;
CREATE INDEX ix_case_history_refund ON public.app_case_history(refund_id,created_at) WHERE refund_id IS NOT NULL;
CREATE INDEX ix_case_history_complaint ON public.app_case_history(complaint_id,created_at) WHERE complaint_id IS NOT NULL;
CREATE INDEX ix_case_history_actor ON public.app_case_history(actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE INDEX ix_case_evidence_refund ON public.app_case_evidence(refund_id) WHERE refund_id IS NOT NULL;
CREATE INDEX ix_case_evidence_complaint ON public.app_case_evidence(complaint_id) WHERE complaint_id IS NOT NULL;
CREATE INDEX ix_case_evidence_uploader ON public.app_case_evidence(uploader_user_id) WHERE uploader_user_id IS NOT NULL;
CREATE INDEX ix_commerce_settings_actor ON public.app_commerce_settings(updated_by) WHERE updated_by IS NOT NULL;

CREATE SCHEMA hvm_commerce_private;
REVOKE ALL ON SCHEMA hvm_commerce_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_commerce_private TO authenticated,service_role;
CREATE FUNCTION hvm_commerce_private.case_owned(p_refund uuid,p_complaint uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_refund_requests WHERE id=p_refund AND requester_user_id=(SELECT auth.uid()))
 OR EXISTS(SELECT 1 FROM public.app_complaints WHERE id=p_complaint AND reporter_user_id=(SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION hvm_commerce_private.case_owned(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_commerce_private.case_owned(uuid,uuid) TO authenticated,service_role;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['app_commerce_settings','app_commerce_receipts','app_pos_sales','app_payment_policy_acceptances','app_orders','app_financial_holds','app_payment_transactions','app_refund_requests','app_complaints','app_case_messages','app_case_history','app_case_evidence'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM service_role',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE public.app_orders_order_number_seq TO service_role;
GRANT SELECT ON public.app_pos_sales,public.app_payment_policy_acceptances,public.app_orders,public.app_financial_holds,public.app_refund_requests,public.app_complaints,public.app_case_messages,public.app_case_history TO authenticated;
CREATE POLICY pos_owner_read ON public.app_pos_sales FOR SELECT TO authenticated USING (producer_user_id=(SELECT auth.uid()) OR customer_user_id=(SELECT auth.uid()));
CREATE POLICY payment_policy_owner_read ON public.app_payment_policy_acceptances FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
CREATE POLICY orders_participant_read ON public.app_orders FOR SELECT TO authenticated USING (customer_user_id=(SELECT auth.uid()) OR producer_user_id=(SELECT auth.uid()));
CREATE POLICY holds_participant_read ON public.app_financial_holds FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.app_orders o WHERE o.id=order_id));
CREATE POLICY refunds_owner_read ON public.app_refund_requests FOR SELECT TO authenticated USING (requester_user_id=(SELECT auth.uid()));
CREATE POLICY complaints_reporter_read ON public.app_complaints FOR SELECT TO authenticated USING (reporter_user_id=(SELECT auth.uid()));
CREATE POLICY messages_owner_read ON public.app_case_messages FOR SELECT TO authenticated USING (hvm_commerce_private.case_owned(refund_id,complaint_id));
CREATE POLICY history_owner_read ON public.app_case_history FOR SELECT TO authenticated USING (hvm_commerce_private.case_owned(refund_id,complaint_id));

-- Freeze purchase facts while allowing status/receipt updates and FK SET NULL.
CREATE FUNCTION hvm_commerce_private.freeze_order() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
 BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','received_at','producer_user_id','store_id']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','received_at','producer_user_id','store_id'])
 OR (NEW.producer_user_id IS DISTINCT FROM OLD.producer_user_id AND NEW.producer_user_id IS NOT NULL)
 OR (NEW.store_id IS DISTINCT FROM OLD.store_id AND NEW.store_id IS NOT NULL)
 OR (OLD.received_at IS NOT NULL AND NEW.received_at IS DISTINCT FROM OLD.received_at) THEN
  RAISE EXCEPTION 'ORDER_SNAPSHOT_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
 END $$;
CREATE TRIGGER freeze_order BEFORE UPDATE ON public.app_orders FOR EACH ROW EXECUTE FUNCTION hvm_commerce_private.freeze_order();
CREATE FUNCTION hvm_commerce_private.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
 BEGIN
 IF TG_OP='DELETE' AND ((to_jsonb(OLD)->>'refund_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.app_refund_requests WHERE id=(to_jsonb(OLD)->>'refund_id')::uuid)
 OR (to_jsonb(OLD)->>'complaint_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.app_complaints WHERE id=(to_jsonb(OLD)->>'complaint_id')::uuid)
 OR (to_jsonb(OLD)->>'payment_intent_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.app_payment_intents WHERE id=(to_jsonb(OLD)->>'payment_intent_id')::uuid)
 OR (to_jsonb(OLD)->>'user_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=(to_jsonb(OLD)->>'user_id')::uuid)) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['author_user_id','actor_user_id','uploader_user_id'])=(to_jsonb(OLD)-ARRAY['author_user_id','actor_user_id','uploader_user_id'])
 AND coalesce(to_jsonb(NEW)->>'author_user_id',to_jsonb(NEW)->>'actor_user_id',to_jsonb(NEW)->>'uploader_user_id') IS NULL THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'COMMERCE_RECORD_IMMUTABLE' USING ERRCODE='23514';
 END $$;
CREATE TRIGGER immutable_commerce_receipt BEFORE UPDATE OR DELETE ON public.app_commerce_receipts FOR EACH ROW EXECUTE FUNCTION hvm_commerce_private.append_only();
CREATE TRIGGER immutable_payment_event BEFORE UPDATE OR DELETE ON public.app_payment_transactions FOR EACH ROW EXECUTE FUNCTION hvm_commerce_private.append_only();
CREATE TRIGGER immutable_payment_policy BEFORE UPDATE OR DELETE ON public.app_payment_policy_acceptances FOR EACH ROW EXECUTE FUNCTION hvm_commerce_private.append_only();
CREATE TRIGGER immutable_case_history BEFORE UPDATE OR DELETE ON public.app_case_history FOR EACH ROW EXECUTE FUNCTION hvm_commerce_private.append_only();
CREATE TRIGGER immutable_case_message BEFORE UPDATE OR DELETE ON public.app_case_messages FOR EACH ROW EXECUTE FUNCTION hvm_commerce_private.append_only();
REVOKE ALL ON FUNCTION hvm_commerce_private.freeze_order(),hvm_commerce_private.append_only() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_commerce_private.freeze_order(),hvm_commerce_private.append_only() TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('case-evidence','case-evidence',false,2097152,ARRAY['image/jpeg','image/png','image/webp','application/pdf']) ON CONFLICT(id) DO NOTHING;
COMMENT ON TABLE public.app_commerce_settings IS 'Preparação sem segredo: referências públicas da conta central. Credenciais futuras somente no servidor; gateway não ativado por esta migration.';
COMMENT ON TABLE public.app_financial_holds IS 'Controle interno de retenção e disputas. Custódia e repasses reais dependem do contrato/API do gateway; nenhum saque manual.';
COMMENT ON TABLE public.app_complaints IS 'Relato privado e auditado; denúncia não aplica sanção automaticamente. Sanções usam governança existente e sua permissão própria.';
CREATE FUNCTION hvm_commerce_private.queue_evidence_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
 BEGIN
 INSERT INTO public.app_storage_deletion_queue(bucket,object_path,reason) VALUES ('case-evidence',OLD.storage_path,'case-erasure') ON CONFLICT DO NOTHING;
 RETURN OLD;
 END $$;
CREATE TRIGGER queue_case_evidence_delete AFTER DELETE ON public.app_case_evidence FOR EACH ROW EXECUTE FUNCTION hvm_commerce_private.queue_evidence_delete();
REVOKE ALL ON FUNCTION hvm_commerce_private.queue_evidence_delete() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_commerce_private.queue_evidence_delete() TO service_role;
