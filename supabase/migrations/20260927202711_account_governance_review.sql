-- Exclusão administrativa lógica: preserva auditoria e credenciais para informar
-- o motivo após autenticação. Não equivale à eliminação de dados pessoais.
ALTER TABLE public.app_users DROP CONSTRAINT app_users_status_check;
ALTER TABLE public.app_users ADD CONSTRAINT app_users_status_check CHECK(status IN ('active','blocked','pending','suspended','deleted'));
ALTER TABLE public.app_people ADD COLUMN archived_at timestamptz;
ALTER TABLE public.app_people DROP CONSTRAINT app_people_cpf_normalized_key;
ALTER TABLE public.app_people DROP CONSTRAINT app_people_email_normalized_key;
CREATE UNIQUE INDEX uq_people_current_cpf ON public.app_people(cpf_normalized) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX uq_people_current_email ON public.app_people(email_normalized) WHERE archived_at IS NULL;

CREATE FUNCTION public.governance_name_key(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=public AS $$
 SELECT regexp_replace(lower(translate(trim(value),'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç','AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')), '\s+', ' ', 'g');
$$;
CREATE TABLE public.app_account_deletions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.app_users(id),
 cpf_normalized char(11) NOT NULL, name_key text NOT NULL,
 deleted_by uuid NOT NULL REFERENCES public.app_users(id), deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_account_deletions_cpf ON public.app_account_deletions(cpf_normalized);
CREATE INDEX ix_account_deletions_name ON public.app_account_deletions(name_key);
CREATE TABLE public.app_registration_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.app_users(id),
 matched_user_ids uuid[] NOT NULL, reasons text[] NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 requested_role text CHECK(requested_role IN ('consumer','producer')),
 property_name text, activity_type text,
 created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, reviewed_by uuid REFERENCES public.app_users(id),
 review_note text CHECK(length(review_note)<=1000)
);
CREATE UNIQUE INDEX uq_registration_review_pending ON public.app_registration_reviews(user_id) WHERE status='pending';
ALTER TABLE public.app_account_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_account_deletions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_registration_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_registration_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_account_deletions,public.app_registration_reviews FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.app_account_deletions,public.app_registration_reviews TO service_role;
COMMENT ON TABLE public.app_registration_reviews IS 'Revisão humana: nome coincidente é sinal, não prova de fraude. Nenhuma senha é armazenada.';

-- A verificação fica no banco, incluindo cadastro pelo Edge e fallback Express.
CREATE FUNCTION public.trg_registration_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE matches uuid[]; why text[];
BEGIN
 SELECT array_agg(DISTINCT d.user_id), array_remove(ARRAY[
  CASE WHEN bool_or(d.cpf_normalized=NEW.cpf_normalized) THEN 'cpf' END,
  CASE WHEN bool_or(d.name_key=public.governance_name_key(NEW.full_name)) THEN 'name' END],NULL)
 INTO matches,why FROM public.app_account_deletions d
 WHERE d.cpf_normalized=NEW.cpf_normalized OR d.name_key=public.governance_name_key(NEW.full_name);
 IF matches IS NOT NULL THEN
  UPDATE public.app_users SET status='pending',authorization_revision=authorization_revision+1 WHERE id=NEW.user_id;
  INSERT INTO public.app_registration_reviews(user_id,matched_user_ids,reasons) VALUES(NEW.user_id,matches,why);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trg_registration_review() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_people_registration_review AFTER INSERT ON public.app_people FOR EACH ROW EXECUTE FUNCTION public.trg_registration_review();

-- O mesmo e-mail reaproveita a identidade somente após comprovar a senha no
-- servidor. A aprovação nunca restitui privilégios administrativos por cadastro público.
CREATE FUNCTION public.request_account_reactivation(p_user_id uuid,p_role text,p_property_name text DEFAULT NULL,p_activity_type text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE result uuid;
BEGIN
 IF p_role NOT IN ('consumer','producer') OR NOT EXISTS(SELECT 1 FROM public.app_users WHERE id=p_user_id AND status='deleted')
 OR EXISTS(SELECT 1 FROM public.app_admin_principals WHERE admin_user_id=p_user_id)
 THEN RAISE EXCEPTION 'REACTIVATION_NOT_ALLOWED' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.app_users WHERE id=p_user_id FOR UPDATE;
 INSERT INTO public.app_registration_reviews(user_id,matched_user_ids,reasons,requested_role,property_name,activity_type)
 VALUES(p_user_id,ARRAY[p_user_id],ARRAY['cpf','name'],p_role,p_property_name,p_activity_type)
 ON CONFLICT(user_id) WHERE status='pending' DO UPDATE SET user_id=EXCLUDED.user_id
 RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.request_account_reactivation(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_reactivation(uuid,text,text,text) TO service_role;

-- Impede uma rota antiga de adicionar perfil a conta suspensa/excluída/pendente.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.add_public_role_to_existing_identity(uuid,text,text,text,text,text)'::regprocedure);
 definition:=replace(definition, 'IF p_role NOT IN', E'IF NOT EXISTS(SELECT 1 FROM public.app_users u WHERE u.id=p_user_id AND public.effective_account_status(u.status,u.block_starts_at,u.block_ends_at)=\'active\') THEN RAISE EXCEPTION \'ACCOUNT_UNAVAILABLE\' USING ERRCODE=\'22023\'; END IF;\n  IF p_role NOT IN');
 EXECUTE definition;
END $$;
