-- Correções de papéis e central de notificações, aditivas sobre T24/schema 62.
-- Não reescreve histórico, não envia mensagens externas e não ativa gateway.
SET lock_timeout='5s';
CREATE SCHEMA hvm_notifications_private;
REVOKE ALL ON SCHEMA hvm_notifications_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_notifications_private TO service_role,authenticated;

CREATE TABLE public.app_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 recipient_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 recipient_role varchar(32) NOT NULL CHECK(recipient_role IN ('consumer','producer','platform_admin','platform_super_admin')),
 required_sector varchar(64) REFERENCES public.app_admin_sectors(code) ON DELETE CASCADE,
 event_key varchar(255) NOT NULL,
 category varchar(32) NOT NULL CHECK(category IN ('purchases','sales','orders','refunds','complaints','reviews','subscriptions','properties','documents','account','catalog','inventory','delivery','administration')),
 title varchar(160) NOT NULL CHECK(length(trim(title))>0),
 message varchar(500) NOT NULL CHECK(length(trim(message))>0),
 action_path varchar(512) NOT NULL CHECK(action_path ~ '^/[a-zA-Z0-9/_?=&%#.-]+$' AND action_path !~ '^//'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 read_at timestamptz,
 UNIQUE(recipient_user_id,recipient_role,event_key),
 CHECK(required_sector IS NULL OR recipient_role IN ('platform_admin','platform_super_admin')),
 CHECK(read_at IS NULL OR read_at>=created_at)
);
CREATE INDEX ix_notifications_feed ON public.app_notifications(recipient_user_id,recipient_role,created_at DESC,id DESC);
CREATE INDEX ix_notifications_unread ON public.app_notifications(recipient_user_id,recipient_role,created_at DESC) WHERE read_at IS NULL;
CREATE INDEX ix_notifications_sector ON public.app_notifications(required_sector) WHERE required_sector IS NOT NULL;

CREATE TABLE public.app_refund_seller_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 refund_id uuid NOT NULL REFERENCES public.app_refund_requests(id) ON DELETE CASCADE,
 author_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
 message text NOT NULL CHECK(length(trim(message)) BETWEEN 10 AND 4000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_refund_seller_contacts_refund ON public.app_refund_seller_contacts(refund_id,created_at,id);
CREATE INDEX ix_refund_seller_contacts_author ON public.app_refund_seller_contacts(author_user_id) WHERE author_user_id IS NOT NULL;

-- Private, bounded lookup. Live roles, account status and delegated sector are
-- rechecked even for direct Data API reads; there is no JWT metadata authority.
CREATE FUNCTION hvm_notifications_private.allowed_roles(uid uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(array_agg(r.role_code::text),'{}'::text[]) FROM public.app_user_role_assignments r
 JOIN public.app_users u ON u.id=r.user_id
 WHERE u.id=uid AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
 AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>now())
 AND (r.role_code IN ('consumer','producer') OR EXISTS(SELECT 1 FROM public.app_admin_principals a WHERE a.admin_user_id=uid AND a.portal_role=r.role_code))
$$;
CREATE FUNCTION hvm_notifications_private.readable(p_role text,p_sector text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_role=ANY(hvm_notifications_private.allowed_roles((SELECT auth.uid())))
 AND (p_sector IS NULL OR p_role='platform_super_admin' OR EXISTS(
 SELECT 1 FROM public.app_admin_sector_members m JOIN public.app_admin_sectors s ON s.code=m.sector_code AND s.is_active
 WHERE m.user_id=(SELECT auth.uid()) AND m.sector_code=p_sector AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>now())))
$$;
CREATE FUNCTION hvm_notifications_private.seller_contact_readable(case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.app_refund_requests r JOIN public.app_orders o ON o.id=r.order_id
 WHERE r.id=case_id AND (
 (o.producer_user_id=(SELECT auth.uid()) AND hvm_notifications_private.readable('producer',NULL))
 OR hvm_notifications_private.readable('platform_super_admin','refund_management')
 OR hvm_notifications_private.readable('platform_admin','refund_management')))
$$;
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_refund_seller_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_refund_seller_contacts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_notifications,public.app_refund_seller_contacts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.app_notifications,public.app_refund_seller_contacts TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.app_notifications TO service_role;
GRANT SELECT,INSERT ON public.app_refund_seller_contacts TO service_role;
CREATE POLICY notifications_recipient_read ON public.app_notifications FOR SELECT TO authenticated
 USING(recipient_user_id=(SELECT auth.uid()) AND hvm_notifications_private.readable(recipient_role,required_sector));
CREATE POLICY refund_seller_contacts_read ON public.app_refund_seller_contacts FOR SELECT TO authenticated
 USING(hvm_notifications_private.seller_contact_readable(refund_id));

CREATE FUNCTION hvm_notifications_private.freeze_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF (to_jsonb(NEW)-'read_at') IS DISTINCT FROM (to_jsonb(OLD)-'read_at') OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at) THEN
  RAISE EXCEPTION 'NOTIFICATION_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_notification BEFORE UPDATE ON public.app_notifications FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.freeze_notification();
CREATE FUNCTION hvm_notifications_private.freeze_seller_contact() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.app_refund_requests WHERE id=OLD.refund_id) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND NEW.author_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=OLD.author_user_id)
 AND (to_jsonb(NEW)-'author_user_id')=(to_jsonb(OLD)-'author_user_id') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'SELLER_CONTACT_IMMUTABLE' USING ERRCODE='23514';
END $$;
CREATE TRIGGER immutable_seller_contact BEFORE UPDATE OR DELETE ON public.app_refund_seller_contacts FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.freeze_seller_contact();

-- Backend and internal triggers only. Explicit roles prevent a producer account
-- from receiving consumer tasks merely because it owns a store.
CREATE FUNCTION hvm_notifications_private.emit(uid uuid,p_role text,event text,cat text,heading text,body text,path text,p_sector text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF uid IS NULL THEN RETURN; END IF;
 INSERT INTO public.app_notifications(recipient_user_id,recipient_role,required_sector,event_key,category,title,message,action_path)
 SELECT uid,p_role,p_sector,event,cat,heading,body,path
 WHERE EXISTS(SELECT 1 FROM public.app_user_role_assignments r WHERE r.user_id=uid AND r.role_code=p_role AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at>clock_timestamp()))
 ON CONFLICT(recipient_user_id,recipient_role,event_key) DO NOTHING;
END $$;
CREATE FUNCTION hvm_notifications_private.emit_admins(p_sector text,event text,cat text,heading text,body text,path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE admin_record record;
BEGIN
 FOR admin_record IN SELECT a.admin_user_id,a.portal_role FROM public.app_admin_principals a
 JOIN public.app_users u ON u.id=a.admin_user_id
 WHERE public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)='active'
 AND (a.portal_role='platform_super_admin' OR (p_sector IS NOT NULL AND EXISTS(SELECT 1 FROM public.app_admin_sector_members m JOIN public.app_admin_sectors s ON s.code=m.sector_code AND s.is_active WHERE m.user_id=a.admin_user_id AND m.sector_code=p_sector AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()))))
 LOOP PERFORM hvm_notifications_private.emit(admin_record.admin_user_id,admin_record.portal_role,event,cat,heading,body,path,p_sector); END LOOP;
END $$;
CREATE FUNCTION hvm_notifications_private.producer_user(profile_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT pe.user_id FROM public.app_producer_profiles p JOIN public.app_people pe ON pe.id=p.person_id WHERE p.id=profile_id
$$;

-- Domain changes are the source of delivery. Webhooks, SQL commands and Edge
-- registration participate in the same transaction, without a worker or cron.
CREATE FUNCTION hvm_notifications_private.domain_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb:=to_jsonb(NEW); before_data jsonb:='{}'; event text; uid uuid; role_code text; order_data record; case_data record; sub_data record; heading text; body text; route text; status_text text;
BEGIN
 IF TG_OP='UPDATE' THEN before_data:=to_jsonb(OLD); END IF;
 event:=TG_TABLE_NAME||':'||coalesce(d->>'id',d->>'order_id',d->>'subscription_id')||':'||coalesce(d->>'revision',d->>'status',d->>'state','created');
 status_text:=coalesce(d->>'status',d->>'state');
 CASE TG_TABLE_NAME
 WHEN 'app_orders' THEN
  IF TG_OP='INSERT' THEN
   PERFORM hvm_notifications_private.emit((d->>'customer_user_id')::uuid,'consumer',event,'purchases','Compra confirmada','O pagamento foi confirmado. Consulte sua compra e o andamento da entrega.','/compras');
   PERFORM hvm_notifications_private.emit((d->>'producer_user_id')::uuid,'producer',event,'sales','Nova venda confirmada','Uma venda da sua loja foi confirmada. Confira os itens em Minhas vendas.','/produtor/vendas?orderId='||(d->>'id'));
  ELSIF d->>'status' IS DISTINCT FROM before_data->>'status' THEN
   PERFORM hvm_notifications_private.emit((d->>'customer_user_id')::uuid,'consumer',event,'purchases','Compra atualizada',CASE WHEN status_text='received' THEN 'O recebimento da compra foi registrado.' ELSE 'O reembolso desta compra foi confirmado.' END,'/compras');
   PERFORM hvm_notifications_private.emit((d->>'producer_user_id')::uuid,'producer',event,'sales','Venda atualizada',CASE WHEN status_text='received' THEN 'O consumidor confirmou o recebimento desta venda.' ELSE 'O reembolso desta venda foi confirmado.' END,'/produtor/vendas?orderId='||(d->>'id'));
  END IF;
 WHEN 'app_order_fulfillment' THEN
  IF TG_OP='UPDATE' AND status_text IS DISTINCT FROM before_data->>'status' THEN
   SELECT * INTO order_data FROM public.app_orders WHERE id=(d->>'order_id')::uuid;
   heading:=CASE status_text WHEN 'in_preparation' THEN 'Pedido em preparo' WHEN 'ready_for_dispatch' THEN 'Pedido pronto' WHEN 'out_for_delivery' THEN 'Pedido saiu para entrega' WHEN 'delivered' THEN 'Pedido entregue' WHEN 'cancelled' THEN 'Pedido cancelado' ELSE 'Pedido atualizado' END;
   body:=CASE status_text WHEN 'delivered' THEN 'A entrega foi registrada. Você já pode avaliar a compra.' WHEN 'cancelled' THEN 'O pedido foi cancelado. Consulte o andamento e, quando aplicável, o reembolso.' ELSE 'Confira o andamento atualizado do seu pedido.' END;
   PERFORM hvm_notifications_private.emit(order_data.customer_user_id,'consumer',event,'orders',heading,body,'/pedidos/'||(d->>'order_id'));
   PERFORM hvm_notifications_private.emit(order_data.producer_user_id,'producer',event,'orders',heading,'O andamento de um pedido da sua loja foi atualizado.','/produtor/pedidos?orderId='||(d->>'order_id'));
   IF status_text='delivered' THEN PERFORM hvm_notifications_private.emit(order_data.customer_user_id,'consumer',event||':review','reviews','Avalie sua compra','Conte como foi a compra entregue e ajude outras pessoas a conhecer a loja.','/pedidos/'||(d->>'order_id')); END IF;
  END IF;
 WHEN 'app_refund_requests' THEN
  IF TG_OP='INSERT' OR status_text IS DISTINCT FROM before_data->>'status' THEN
   SELECT * INTO order_data FROM public.app_orders WHERE id=(d->>'order_id')::uuid;
   PERFORM hvm_notifications_private.emit((d->>'requester_user_id')::uuid,'consumer',event,'refunds','Reembolso atualizado','Consulte o andamento e as orientações da equipe responsável.','/reembolsos?caseId='||(d->>'id'));
   PERFORM hvm_notifications_private.emit(order_data.producer_user_id,'producer',event,'refunds','Reembolso de uma venda','Há uma atualização no reembolso de uma venda da sua loja. O processo é conduzido pela administração.','/produtor/reembolsos?caseId='||(d->>'id'));
   PERFORM hvm_notifications_private.emit_admins('refund_management',event,'refunds',CASE WHEN TG_OP='INSERT' THEN 'Nova solicitação de reembolso' ELSE 'Reembolso atualizado' END,'Uma solicitação requer acompanhamento da equipe autorizada.','/admin/reembolsos?caseId='||(d->>'id'));
  END IF;
 WHEN 'app_complaints' THEN
  IF TG_OP='INSERT' OR status_text IS DISTINCT FROM before_data->>'status' THEN
   PERFORM hvm_notifications_private.emit((d->>'reporter_user_id')::uuid,d->>'reporter_role',event,'complaints','Denúncia atualizada','Consulte o andamento da sua denúncia na central privada.','/denuncias?caseId='||(d->>'id'));
   PERFORM hvm_notifications_private.emit_admins('complaint_management',event,'complaints',CASE WHEN TG_OP='INSERT' THEN 'Nova denúncia' ELSE 'Denúncia atualizada' END,'Uma denúncia requer acompanhamento da equipe autorizada.','/admin/denuncias?caseId='||(d->>'id'));
  END IF;
 WHEN 'app_case_messages','app_case_evidence' THEN
  IF d->>'refund_id' IS NOT NULL THEN
   SELECT requester_user_id AS owner,'consumer'::text AS owner_role INTO case_data FROM public.app_refund_requests WHERE id=(d->>'refund_id')::uuid;
   route:='/reembolsos?caseId='||(d->>'refund_id'); role_code:='refund_management';
  ELSE
   SELECT reporter_user_id AS owner,reporter_role::text AS owner_role INTO case_data FROM public.app_complaints WHERE id=(d->>'complaint_id')::uuid;
   route:='/denuncias?caseId='||(d->>'complaint_id'); role_code:='complaint_management';
  END IF;
  IF case_data.owner IS DISTINCT FROM coalesce(d->>'author_user_id',d->>'uploader_user_id')::uuid THEN
   PERFORM hvm_notifications_private.emit(case_data.owner,case_data.owner_role,event,CASE WHEN d->>'refund_id' IS NOT NULL THEN 'refunds' ELSE 'complaints' END,'Nova informação da equipe','Há uma mensagem ou anexo no seu atendimento privado.',route);
  END IF;
  PERFORM hvm_notifications_private.emit_admins(role_code,event,CASE WHEN d->>'refund_id' IS NOT NULL THEN 'refunds' ELSE 'complaints' END,'Atendimento atualizado','Uma mensagem ou anexo foi acrescentado ao atendimento.','/admin'||route);
 WHEN 'app_refund_seller_contacts' THEN
  SELECT o.producer_user_id INTO uid FROM public.app_refund_requests r JOIN public.app_orders o ON o.id=r.order_id WHERE r.id=(d->>'refund_id')::uuid;
  PERFORM hvm_notifications_private.emit(uid,'producer',event,'refunds','Contato da administração','A equipe responsável enviou uma orientação sobre o reembolso de uma venda.','/produtor/reembolsos?caseId='||(d->>'refund_id'));
  PERFORM hvm_notifications_private.emit_admins('refund_management',event,'refunds','Contato com vendedor registrado','Uma orientação ao vendedor foi registrada neste atendimento.','/admin/reembolsos?caseId='||(d->>'refund_id'));
 WHEN 'app_reviews' THEN
  SELECT producer_user_id INTO uid FROM public.app_orders WHERE id=(d->>'order_id')::uuid;
  IF TG_OP='INSERT' THEN
   PERFORM hvm_notifications_private.emit(uid,'producer',event,'reviews','Sua loja recebeu uma avaliação','Um consumidor avaliou uma compra entregue. Confira a reputação da loja.','/produtor/vendas?orderId='||(d->>'order_id'));
   PERFORM hvm_notifications_private.emit_admins('complaint_management',event,'reviews','Nova avaliação de compra','Uma avaliação verificada foi publicada.','/admin/avaliacoes');
  ELSIF d->>'is_moderated' IS DISTINCT FROM before_data->>'is_moderated' THEN
   PERFORM hvm_notifications_private.emit((SELECT pe.user_id FROM public.app_people pe WHERE pe.id=(d->>'customer_person_id')::uuid),'consumer',event||':'||coalesce(d->>'updated_at','')||':'||(d->>'is_moderated'),'reviews','Avaliação moderada','A equipe responsável moderou sua avaliação. Consulte a compra.','/pedidos/'||(d->>'order_id'));
   PERFORM hvm_notifications_private.emit(uid,'producer',event||':'||coalesce(d->>'updated_at','')||':'||(d->>'is_moderated'),'reviews','Reputação atualizada','Uma avaliação da loja foi moderada pela equipe responsável.','/produtor/vendas');
  END IF;
 WHEN 'app_subscriptions' THEN
  IF TG_OP='INSERT' OR status_text IS DISTINCT FROM before_data->>'status' THEN
   role_code:=d->'plan_snapshot'->>'targetAudience';
   PERFORM hvm_notifications_private.emit((d->>'user_id')::uuid,role_code,event,'subscriptions','Assinatura atualizada','Consulte a situação, os ciclos e a recorrência da sua assinatura.','/assinaturas/minhas');
   PERFORM hvm_notifications_private.emit_admins('payment_configuration',event,'subscriptions','Assinatura atualizada','Uma assinatura teve alteração no estado contratual.','/admin/assinaturas');
  END IF;
 WHEN 'app_billing_cycles' THEN
  IF TG_OP='INSERT' OR status_text IS DISTINCT FROM before_data->>'status' THEN
   SELECT * INTO sub_data FROM public.app_subscriptions WHERE id=(d->>'subscription_id')::uuid;
   role_code:=sub_data.plan_snapshot->>'targetAudience';
   PERFORM hvm_notifications_private.emit(sub_data.user_id,role_code,event,'subscriptions','Ciclo da assinatura atualizado','Confira o vencimento e a situação do ciclo da assinatura.','/assinaturas/minhas');
   IF status_text IN ('failed','refunded') THEN PERFORM hvm_notifications_private.emit_admins('payment_configuration',event,'subscriptions','Ciclo precisa de acompanhamento','Um ciclo de assinatura teve falha ou reembolso confirmado.','/admin/assinaturas'); END IF;
  END IF;
 WHEN 'app_trial_grants' THEN
  uid:=hvm_notifications_private.producer_user((d->>'producer_profile_id')::uuid);
  IF TG_OP='INSERT' OR d->>'is_converted' IS DISTINCT FROM before_data->>'is_converted' THEN
   PERFORM hvm_notifications_private.emit(uid,'producer',event||':'||(d->>'is_converted'),'subscriptions','Período gratuito do produtor','Consulte o prazo do período gratuito e as opções para sua loja.','/produtor/assinaturas');
  END IF;
 WHEN 'app_verification_requests' THEN
  IF TG_OP='INSERT' OR status_text IS DISTINCT FROM before_data->>'status' THEN
   uid:=hvm_notifications_private.producer_user((d->>'producer_id')::uuid);
   PERFORM hvm_notifications_private.emit(uid,'producer',event||':'||coalesce(d->>'updated_at',''),'properties','Análise do imóvel atualizada','Consulte a situação da solicitação de verificação do seu imóvel.','/produtor/propriedades');
   PERFORM hvm_notifications_private.emit_admins('document_verification',event||':'||coalesce(d->>'updated_at',''),'properties','Fila de imóveis atualizada','Há uma atualização na fila de verificação de imóveis.','/admin/documentos/fila');
  END IF;
 WHEN 'app_verification_decisions' THEN
  SELECT hvm_notifications_private.producer_user(producer_id) INTO uid FROM public.app_verification_requests WHERE id=(d->>'request_id')::uuid;
  PERFORM hvm_notifications_private.emit(uid,'producer',event,'properties','Parecer do imóvel disponível','Consulte o parecer e, se solicitado, ajuste os dados do imóvel.','/produtor/propriedades');
 WHEN 'app_documents' THEN
  IF TG_OP='INSERT' OR status_text IS DISTINCT FROM before_data->>'status' THEN
   PERFORM hvm_notifications_private.emit(hvm_notifications_private.producer_user((d->>'producer_id')::uuid),'producer',event||':'||coalesce(d->>'updated_at',''),'documents','Documento atualizado','Consulte a situação do documento vinculado ao seu imóvel.','/produtor/documentos/'||(d->>'id')||'?propertyId='||(d->>'property_id'));
   IF status_text='rejected' THEN PERFORM hvm_notifications_private.emit_admins('document_verification',event,'documents','Documento rejeitado na verificação','Um documento foi rejeitado na verificação de segurança.','/admin/documentos/fila'); END IF;
  END IF;
 WHEN 'app_registration_reviews' THEN
  IF TG_OP='INSERT' OR status_text IS DISTINCT FROM before_data->>'status' THEN
   PERFORM hvm_notifications_private.emit_admins('account_governance',event,'account','Cadastro em análise','Consulte a fila de revisão de cadastro.','/admin/usuarios');
   PERFORM hvm_notifications_private.emit((d->>'user_id')::uuid,coalesce(d->>'requested_role','consumer'),event,'account','Análise de cadastro atualizada','Consulte a situação da conta e siga as orientações de confirmação de acesso.','/conta');
  END IF;
 WHEN 'app_payment_intents' THEN
  IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND status_text IN ('failed','refunded') AND status_text IS DISTINCT FROM before_data->>'status') THEN
   role_code:='consumer';
   IF d->>'billing_cycle_id' IS NOT NULL THEN SELECT s.plan_snapshot->>'targetAudience' INTO role_code FROM public.app_billing_cycles c JOIN public.app_subscriptions s ON s.id=c.subscription_id WHERE c.id=(d->>'billing_cycle_id')::uuid; END IF;
   PERFORM hvm_notifications_private.emit((d->>'user_id')::uuid,role_code,event,CASE WHEN d->>'billing_cycle_id' IS NULL THEN 'purchases' ELSE 'subscriptions' END,CASE WHEN TG_OP='INSERT' THEN 'Pagamento preparado' ELSE 'Pagamento atualizado' END,'Consulte a situação e o prazo do pagamento.','/pagamentos/'||(d->>'id'));
   IF TG_OP='UPDATE' THEN PERFORM hvm_notifications_private.emit_admins('payment_configuration',event,'administration','Pagamento precisa de acompanhamento','Um pagamento foi marcado como falho ou reembolsado.','/admin/pagamentos'); END IF;
  END IF;
 WHEN 'app_pos_sales' THEN
  IF TG_OP='UPDATE' AND status_text IS DISTINCT FROM before_data->>'status' AND status_text IN ('accepted','cancelled') THEN
   PERFORM hvm_notifications_private.emit((d->>'producer_user_id')::uuid,'producer',event,'sales','Venda presencial atualizada','Consulte a revisão presencial e a confirmação do consumidor.','/produtor/vendas');
   PERFORM hvm_notifications_private.emit((d->>'customer_user_id')::uuid,'consumer',event,'purchases','Revisão presencial atualizada','Consulte a revisão da compra presencial.','/compras');
  END IF;
 WHEN 'app_delivery_allocations' THEN
  IF TG_OP='INSERT' OR d->>'scheduled_date' IS DISTINCT FROM before_data->>'scheduled_date' OR d->>'window_id' IS DISTINCT FROM before_data->>'window_id' THEN
   SELECT * INTO order_data FROM public.app_orders WHERE id=(d->>'order_id')::uuid;
   PERFORM hvm_notifications_private.emit(order_data.customer_user_id,'consumer',event||':'||coalesce(d->>'revision',d->>'updated_at',''),'delivery','Entrega agendada','Consulte a janela de entrega do seu pedido.','/pedidos/'||(d->>'order_id'));
   PERFORM hvm_notifications_private.emit(order_data.producer_user_id,'producer',event||':'||coalesce(d->>'revision',d->>'updated_at',''),'delivery','Janela do pedido atualizada','Confira a alocação da entrega nos pedidos da loja.','/produtor/pedidos?orderId='||(d->>'order_id'));
  END IF;
 WHEN 'app_financial_holds' THEN
  IF TG_OP='UPDATE' AND status_text='released' AND status_text IS DISTINCT FROM before_data->>'state' THEN
   SELECT producer_user_id INTO uid FROM public.app_orders WHERE id=(d->>'order_id')::uuid;
   PERFORM hvm_notifications_private.emit(uid,'producer',event,'sales','Retenção da venda atualizada','Consulte a situação financeira da venda.','/produtor/vendas?orderId='||(d->>'order_id'));
  END IF;
 ELSE NULL;
 END CASE;
 RETURN NEW;
END $$;
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['app_orders','app_order_fulfillment','app_refund_requests','app_complaints','app_subscriptions','app_billing_cycles','app_trial_grants','app_verification_requests','app_documents','app_registration_reviews','app_payment_intents','app_pos_sales','app_delivery_allocations','app_financial_holds','app_reviews'] LOOP
  EXECUTE format('CREATE TRIGGER notifications_domain_event AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.domain_event()',tbl);
 END LOOP;
 FOREACH tbl IN ARRAY ARRAY['app_case_messages','app_case_evidence','app_refund_seller_contacts','app_verification_decisions'] LOOP
  EXECUTE format('CREATE TRIGGER notifications_domain_event AFTER INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.domain_event()',tbl);
 END LOOP;
END $$;

-- Existing audit producers are reused for ancillary modules and security events.
-- Explicit allowlist excludes reads, cart quantities, draft keystrokes and secrets.
CREATE FUNCTION hvm_notifications_private.audit_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE heading text; cat text; route text; sector_code text; event text:='audit:'||NEW.id; uid uuid; role_code text;
BEGIN
 CASE
 WHEN NEW.action LIKE 'profile.%' OR NEW.action LIKE 'address.%' OR NEW.action='preferences.updated' THEN heading:='Dados da conta atualizados'; cat:='account'; route:='/conta';
 WHEN NEW.action LIKE 'contact.confirmed.%' OR NEW.action IN ('password.reset.completed','password.changed','contact.challenge.confirmed','contact.verified','contact.email_changed','contact.phone_changed') THEN heading:='Segurança da conta atualizada'; cat:='account'; route:='/conta';
 WHEN NEW.action LIKE 'product.%' THEN heading:='Catálogo atualizado'; cat:='catalog'; route:='/produtor/produtos';
 WHEN NEW.action LIKE 'store.%' THEN heading:='Loja atualizada'; cat:='catalog'; route:='/produtor/loja';
 WHEN NEW.action LIKE 'inventory.%' AND NEW.action NOT LIKE '%expired%' THEN heading:='Estoque atualizado'; cat:='inventory'; route:='/produtor/produtos';
 WHEN NEW.action='locality.delivery_scope_updated' THEN heading:='Área de entrega atualizada'; cat:='delivery'; route:='/produtor/entrega';
 WHEN NEW.action IN ('delivery.settings_updated','delivery.settings_saved','delivery.window_created','delivery.window_updated','delivery.window_saved') THEN heading:='Entrega da loja atualizada'; cat:='delivery'; route:='/produtor/loja/janelas';
 WHEN NEW.action='subscription.recurrence_saved' THEN heading:='Recorrência atualizada'; cat:='subscriptions'; route:='/assinaturas/minhas';
 WHEN NEW.action IN ('document.extracted','document.reviewed','document.declared') THEN heading:='Dados do documento atualizados'; cat:='documents'; route:='/produtor/propriedades';
 WHEN NEW.action LIKE 'category.%' THEN heading:='Categorias atualizadas'; cat:='administration'; route:='/admin/categorias';
 WHEN NEW.action='config.updated' OR NEW.action='configuration.updated' THEN heading:='Configuração da plataforma atualizada'; cat:='administration'; route:='/admin/configuracao'; sector_code:='platform_configuration';
 WHEN NEW.action='commerce.settings_updated' THEN heading:='Configuração comercial atualizada'; cat:='administration'; route:='/admin/pagamentos'; sector_code:='payment_configuration';
 WHEN NEW.action LIKE 'plan.%' OR NEW.action='subscription.plan_saved' THEN heading:='Planos atualizados'; cat:='subscriptions'; route:='/admin/assinaturas'; sector_code:='payment_configuration';
 WHEN NEW.action LIKE 'locality.municipality_%' OR NEW.action LIKE 'locality.partial_block_%' THEN heading:='Cobertura da plataforma atualizada'; cat:='administration'; route:='/admin/localidades'; sector_code:='location_management';
 WHEN NEW.action LIKE 'admin.%' OR NEW.action LIKE 'governance.%' THEN heading:='Governança atualizada'; cat:='administration'; route:='/admin/governanca';
 ELSE RETURN NEW;
 END CASE;
 IF route LIKE '/admin/%' THEN
  PERFORM hvm_notifications_private.emit_admins(sector_code,event,cat,heading,'Consulte a alteração registrada na área responsável.',route);
 ELSIF NEW.actor_id IS NOT NULL THEN
  IF NEW.actor_role IN ('consumer','producer') THEN
   PERFORM hvm_notifications_private.emit(NEW.actor_id,NEW.actor_role,event,cat,heading,'Confira os dados atualizados na área responsável.',route);
  ELSIF route='/conta' THEN
   FOR role_code IN SELECT r.role_code FROM public.app_user_role_assignments r WHERE r.user_id=NEW.actor_id AND r.revoked_at IS NULL LOOP
    PERFORM hvm_notifications_private.emit(NEW.actor_id,role_code,event,cat,heading,'Confira os dados atualizados da sua conta.',CASE WHEN role_code IN ('consumer','producer') THEN '/conta' ELSE '/admin/conta' END);
   END LOOP;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notifications_audit_event AFTER INSERT ON public.app_audit_events FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.audit_event();

CREATE FUNCTION hvm_notifications_private.access_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb:=to_jsonb(NEW); before_data jsonb:='{}'; role_code text; event text; item record; uid uuid; path text;
BEGIN
 IF TG_OP='UPDATE' THEN before_data:=to_jsonb(OLD); END IF;
 uid:=coalesce(d->>'user_id',d->>'id')::uuid;
 event:=TG_TABLE_NAME||':'||coalesce(d->>'id',d->>'user_id')||':'||coalesce(d->>'authorization_revision',d->>'updated_at',d->>'granted_at',clock_timestamp()::text);
 IF TG_TABLE_NAME='app_users' THEN
  IF TG_OP='UPDATE' AND (d->>'status' IS DISTINCT FROM before_data->>'status' OR d->>'block_ends_at' IS DISTINCT FROM before_data->>'block_ends_at') THEN
   FOR item IN SELECT r.role_code FROM public.app_user_role_assignments r WHERE r.user_id=uid AND r.revoked_at IS NULL LOOP
    PERFORM hvm_notifications_private.emit(uid,item.role_code,event,'account','Situação da conta atualizada','Consulte as orientações de acesso da sua conta.',CASE WHEN item.role_code IN ('consumer','producer') THEN '/conta' ELSE '/admin/conta' END);
   END LOOP;
   PERFORM hvm_notifications_private.emit_admins('account_governance',event,'account','Acesso de conta atualizado','Uma conta teve alteração de acesso.','/admin/usuarios');
  END IF;
 ELSIF TG_TABLE_NAME='app_user_role_assignments' THEN
  IF TG_OP='INSERT' OR (d->>'revoked_at' IS NULL AND before_data->>'revoked_at' IS NOT NULL) THEN
   role_code:=d->>'role_code';
   PERFORM hvm_notifications_private.emit(uid,role_code,event,'account','Bem-vindo ao seu portal','Seu papel está cadastrado. Consulte os serviços disponíveis para sua conta.',CASE WHEN role_code IN ('consumer','producer') THEN '/conta' ELSE '/admin/painel' END);
  END IF;
 ELSIF TG_TABLE_NAME='app_admin_sector_members' AND d->>'revoked_at' IS NULL AND (TG_OP='INSERT' OR before_data->>'revoked_at' IS NOT NULL) THEN
  SELECT portal_role INTO role_code FROM public.app_admin_principals WHERE admin_user_id=uid;
  IF role_code IS NOT NULL THEN
   PERFORM hvm_notifications_private.emit(uid,role_code,event,'administration','Setor administrativo atribuído','Consulte as responsabilidades delegadas ao seu acesso.','/admin/painel');
   CASE d->>'sector_code'
   WHEN 'refund_management' THEN
    FOR item IN SELECT id FROM public.app_refund_requests WHERE status NOT IN ('rejected','refunded') LOOP PERFORM hvm_notifications_private.emit(uid,role_code,'assigned:refund:'||item.id,'refunds','Reembolso pendente','Há um reembolso na fila do setor atribuído.','/admin/reembolsos?caseId='||item.id,'refund_management'); END LOOP;
   WHEN 'complaint_management' THEN
    FOR item IN SELECT id FROM public.app_complaints WHERE status NOT IN ('resolved','dismissed') LOOP PERFORM hvm_notifications_private.emit(uid,role_code,'assigned:complaint:'||item.id,'complaints','Denúncia pendente','Há uma denúncia na fila do setor atribuído.','/admin/denuncias?caseId='||item.id,'complaint_management'); END LOOP;
   WHEN 'document_verification' THEN
    FOR item IN SELECT id FROM public.app_verification_requests WHERE status IN ('pending','claimed','in_review','escalated') LOOP PERFORM hvm_notifications_private.emit(uid,role_code,'assigned:verification:'||item.id,'properties','Imóvel pendente de análise','Há um imóvel na fila do setor atribuído.','/admin/documentos/fila','document_verification'); END LOOP;
   ELSE NULL;
   END CASE;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notifications_account_access AFTER UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.access_event();
CREATE TRIGGER notifications_role_access AFTER INSERT OR UPDATE ON public.app_user_role_assignments FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.access_event();
CREATE TRIGGER notifications_sector_access AFTER INSERT OR UPDATE ON public.app_admin_sector_members FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.access_event();

CREATE FUNCTION hvm_notifications_private.coverage_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d jsonb:=to_jsonb(NEW); before_data jsonb:='{}'; item record; event text;
BEGIN
 IF TG_OP='UPDATE' THEN before_data:=to_jsonb(OLD); END IF;
 event:=TG_TABLE_NAME||':'||(d->>'id')||':'||coalesce(d->>'revision',d->>'updated_at',clock_timestamp()::text);
 IF TG_TABLE_NAME='app_access_partial_blocks' THEN
  IF TG_OP='INSERT' OR d->>'is_active' IS DISTINCT FROM before_data->>'is_active' THEN
   PERFORM hvm_notifications_private.emit((d->>'user_id')::uuid,CASE WHEN d->>'subject'='producer_publishing' THEN 'producer' ELSE 'consumer' END,event,'account','Permissão regional atualizada','Consulte as orientações e a situação de acesso aos serviços na sua região.','/conta');
  END IF;
 ELSIF TG_TABLE_NAME='app_municipalities' AND TG_OP='UPDATE' AND d->>'is_active' IS DISTINCT FROM before_data->>'is_active' THEN
  FOR item IN SELECT pe.user_id,r.role_code FROM public.app_people pe JOIN public.app_user_role_assignments r ON r.user_id=pe.user_id
  WHERE pe.municipality_id=(d->>'id')::uuid AND r.role_code IN ('consumer','producer') AND r.revoked_at IS NULL LOOP
   PERFORM hvm_notifications_private.emit(item.user_id,item.role_code,event,'account','Cobertura da região atualizada','Consulte a situação da sua região e as orientações disponíveis.','/conta');
  END LOOP;
 ELSIF TG_TABLE_NAME='app_locality_user_impacts' THEN
  IF TG_OP='INSERT' OR d->>'resolved_at' IS DISTINCT FROM before_data->>'resolved_at' THEN
   FOR item IN SELECT r.role_code FROM public.app_user_role_assignments r WHERE r.user_id=(d->>'user_id')::uuid AND r.role_code IN ('consumer','producer') AND r.revoked_at IS NULL LOOP
    PERFORM hvm_notifications_private.emit((d->>'user_id')::uuid,item.role_code,event,'account','Cobertura da região atualizada','Consulte as orientações de cobertura e acesso aos serviços na sua região.','/conta');
   END LOOP;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notifications_partial_access AFTER INSERT OR UPDATE ON public.app_access_partial_blocks FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.coverage_event();
CREATE TRIGGER notifications_municipality_access AFTER UPDATE ON public.app_municipalities FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.coverage_event();
CREATE TRIGGER notifications_locality_impact AFTER INSERT OR UPDATE ON public.app_locality_user_impacts FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.coverage_event();

CREATE FUNCTION hvm_notifications_private.inventory_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid;
BEGIN
 IF NEW.current_quantity=0 AND OLD.current_quantity>0 AND NOT EXISTS(SELECT 1 FROM public.app_inventory_lots l WHERE l.product_id=NEW.product_id AND l.current_quantity>0 AND l.expiration_date>=CURRENT_DATE) THEN
  SELECT pe.user_id INTO uid FROM public.app_products p JOIN public.app_producer_stores s ON s.id=p.store_id JOIN public.app_producer_profiles pr ON pr.id=s.producer_profile_id JOIN public.app_people pe ON pe.id=pr.person_id WHERE p.id=NEW.product_id;
  PERFORM hvm_notifications_private.emit(uid,'producer','stock:'||NEW.id||':'||txid_current(),'inventory','Estoque esgotado','Um produto ficou sem unidades disponíveis. Confira os lotes e a próxima colheita.','/produtor/produtos/'||NEW.product_id||'/lotes');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER notifications_inventory AFTER UPDATE ON public.app_inventory_lots FOR EACH ROW EXECUTE FUNCTION hvm_notifications_private.inventory_event();

-- Populate only current, real pending work in the NEW notification table.
-- Historical domain rows and audit records remain untouched.
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT id FROM public.app_refund_requests WHERE status NOT IN ('rejected','refunded') LOOP
  PERFORM hvm_notifications_private.emit_admins('refund_management','bootstrap:refund:'||item.id,'refunds','Reembolso pendente','Uma solicitação aguarda acompanhamento da equipe autorizada.','/admin/reembolsos?caseId='||item.id);
 END LOOP;
 FOR item IN SELECT id FROM public.app_complaints WHERE status NOT IN ('resolved','dismissed') LOOP
  PERFORM hvm_notifications_private.emit_admins('complaint_management','bootstrap:complaint:'||item.id,'complaints','Denúncia pendente','Uma denúncia aguarda acompanhamento da equipe autorizada.','/admin/denuncias?caseId='||item.id);
 END LOOP;
 FOR item IN SELECT id FROM public.app_verification_requests WHERE status IN ('pending','claimed','in_review','escalated') LOOP
  PERFORM hvm_notifications_private.emit_admins('document_verification','bootstrap:verification:'||item.id,'properties','Imóvel pendente de análise','Há uma solicitação de verificação na fila.','/admin/documentos/fila');
 END LOOP;
 FOR item IN SELECT id FROM public.app_registration_reviews WHERE status='pending' LOOP
  PERFORM hvm_notifications_private.emit_admins('account_governance','bootstrap:registration:'||item.id,'account','Cadastro pendente de revisão','Há um cadastro aguardando revisão da equipe autorizada.','/admin/usuarios');
 END LOOP;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hvm_notifications_private FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_notifications_private.readable(text,text),hvm_notifications_private.seller_contact_readable(uuid) TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA hvm_notifications_private TO service_role;
COMMENT ON TABLE public.app_notifications IS 'Avisos transacionais e idempotentes por usuário/papel; conteúdo imutável, leitura via backend, autorização administrativa atual por setor.';
COMMENT ON TABLE public.app_refund_seller_contacts IS 'Canal separado, somente a administração de reembolso inicia contato. Produtor titular acompanha; conversa e anexos consumidor/admin permanecem privados.';
