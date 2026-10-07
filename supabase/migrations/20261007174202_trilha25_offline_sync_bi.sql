-- T25: additive command journal and calculated facts; no new business ledger.
SET lock_timeout = '5s';
CREATE TABLE public.app_sync_command_journal (
 command_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 device_fingerprint varchar(128) NOT NULL CHECK(length(device_fingerprint)>=8),
 command_type varchar(64) NOT NULL,
 base_revision integer NOT NULL CHECK(base_revision>=0),
 payload_hash char(64) NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 execution_status varchar(32) NOT NULL CHECK(execution_status IN ('confirmed','conflict','rejected')),
 conflict_details jsonb,
 response_body jsonb NOT NULL CHECK(jsonb_typeof(response_body)='object'),
 processed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ix_sync_journal_user ON public.app_sync_command_journal(user_id,processed_at DESC);
CREATE TABLE public.app_kpi_definitions (
 code varchar(64) PRIMARY KEY, name varchar(128) NOT NULL, formula_description text NOT NULL,
 aggregation_interval varchar(32) NOT NULL DEFAULT 'daily' CHECK(aggregation_interval='daily'),is_active boolean NOT NULL DEFAULT true
);
INSERT INTO public.app_kpi_definitions(code,name,formula_description) VALUES
 ('gmv_cents','Volume Bruto Transacionado (GMV)','Soma de app_orders.total_cents de pedidos online entregues, pela primeira ocorrência delivered de app_order_events no dia da configuração timezone. Valor bruto, sem subtrair estornos posteriores; vendas POS não possuem entrega T21 e ficam fora.'),
 ('avg_ticket_cents','Ticket Médio','GMV dividido pelo número de pedidos online entregues no mesmo dia; zero quando não há pedidos. Cada pedido de loja é contado uma vez.'),
 ('active_producers','Produtores Ativos','Quantidade distinta de store_id com pelo menos um pedido online entregue no dia. A série é diária, não uma soma de produtores únicos do período.'),
 ('delivered_orders','Pedidos Entregues','Número de pedidos online entregues pela primeira ocorrência delivered no dia.'),
 ('checkout_quotes','Cotações de Checkout','Número de cotações T19 criadas no dia, independentemente de pagamento; cada cotação é contada uma vez.'),
 ('converted_quotes','Cotações Convertidas','Cotações criadas no dia com um payment intent T20 aprovado (ou depois reembolsado) até o momento do cálculo; conta cotações, não pedidos por loja.'),
 ('conversion_rate','Conversão de Checkout','Percentual de cotações criadas no dia com pagamento aprovado: converted_quotes / checkout_quotes × 100. Pode evoluir com pagamentos posteriores; recalcular sob demanda.'),
 ('subscription_revenue_cents','Receita Bruta de Assinaturas','Soma de app_payment_intents.amount_cents vinculados a app_billing_cycles, pela primeira confirmação approved em app_payment_transactions.processed_at. Receita de planos T23 separada do GMV de alimentos, sem subtrair estornos posteriores.');
CREATE TABLE public.app_kpi_metrics (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kpi_code varchar(64) NOT NULL REFERENCES public.app_kpi_definitions(code) ON DELETE RESTRICT,
 metric_value numeric(14,2) NOT NULL CHECK(metric_value>=0),reference_date date NOT NULL,
 calculated_at timestamptz NOT NULL DEFAULT clock_timestamp(),CONSTRAINT uq_kpi_date UNIQUE(kpi_code,reference_date)
);
CREATE INDEX ix_kpi_metrics_date ON public.app_kpi_metrics(reference_date,kpi_code);
CREATE INDEX ix_t25_delivered_events_date ON public.app_order_events(occurred_at,order_id) WHERE to_status='delivered';
CREATE INDEX ix_t25_quotes_created ON public.app_checkout_quotes(created_at,id);
CREATE INDEX ix_t25_payments_approved_date ON public.app_payment_transactions(processed_at,payment_intent_id) WHERE event_type='approved';
ALTER TABLE public.app_sync_command_journal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_sync_command_journal FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_kpi_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_kpi_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_kpi_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_kpi_metrics FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_sync_command_journal,public.app_kpi_definitions,public.app_kpi_metrics FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.app_sync_command_journal TO service_role;
GRANT SELECT ON public.app_kpi_definitions TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.app_kpi_metrics TO service_role;
CREATE SCHEMA hvm_sync_private;
REVOKE ALL ON SCHEMA hvm_sync_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA hvm_sync_private TO service_role;
CREATE FUNCTION hvm_sync_private.guard_journal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=OLD.user_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'SYNC_JOURNAL_IMMUTABLE' USING ERRCODE='23514';
END $$;
REVOKE ALL ON FUNCTION hvm_sync_private.guard_journal() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_sync_private.guard_journal() TO service_role;
CREATE TRIGGER trg_t25_journal_immutable BEFORE UPDATE OR DELETE ON public.app_sync_command_journal
 FOR EACH ROW EXECUTE FUNCTION hvm_sync_private.guard_journal();
COMMENT ON TABLE public.app_sync_command_journal IS 'T25 backend-only immutable per-item outcomes; account deletion cascade T06 preserved. No credentials or command payload persisted.';
COMMENT ON TABLE public.app_kpi_metrics IS 'T25 calculated daily facts on demand. Never an alternative financial source of truth.';
