-- HortiVitalMix v10 / Trilha 01.
CREATE TABLE public.app_users(
  id UUID PRIMARY KEY,
  status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked','pending','suspended')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  authorization_revision INTEGER NOT NULL DEFAULT 1 CHECK(authorization_revision>0),
  blocked_at TIMESTAMPTZ,
  blocked_by UUID,
  block_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.app_users IS 'Espelho de auth.users; tombstone preservado após exclusão no GoTrue.';
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_users FROM anon, authenticated;
GRANT ALL ON public.app_users TO service_role;

CREATE TABLE public.app_people(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.app_users(id) ON DELETE RESTRICT,
  full_name VARCHAR(255) NOT NULL CHECK(length(trim(full_name))>=3),
  cpf_normalized CHAR(11) NOT NULL UNIQUE CHECK(cpf_normalized ~ '^[0-9]{11}$'),
  email_normalized VARCHAR(255) NOT NULL UNIQUE CHECK(email_normalized=lower(trim(email_normalized)) AND email_normalized ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone_e164 VARCHAR(20) NOT NULL CHECK(phone_e164 ~ '^\+[1-9]\d{1,14}$'),
  email_verified_at TIMESTAMPTZ,
  phone_verified_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.app_people IS 'Pessoa canônica com CPF, email normalizado e telefone E.164; PII restrita por RLS.';
COMMENT ON COLUMN public.app_people.cpf_normalized IS 'CPF de 11 dígitos; DV validado no contrato de cadastro.';
ALTER TABLE public.app_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_people FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_people FROM anon, authenticated;
GRANT ALL ON public.app_people TO service_role;

CREATE TABLE public.app_roles(
  code VARCHAR(64) PRIMARY KEY CHECK(code ~ '^[a-z][a-z0-9_]{2,63}$'),
  name VARCHAR(128) NOT NULL,
  description TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.app_roles IS 'Catálogo de papéis; apenas consumer e producer são públicos.';
ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_roles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_roles FROM anon, authenticated;
GRANT ALL ON public.app_roles TO service_role;

CREATE TABLE public.app_user_role_assignments(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  role_code VARCHAR(64) NOT NULL REFERENCES public.app_roles(code) ON DELETE RESTRICT,
  granted_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  revoke_reason VARCHAR(255),
  CONSTRAINT uq_active_user_role UNIQUE(user_id,role_code),
  CONSTRAINT chk_role_expiry CHECK(expires_at IS NULL OR expires_at>granted_at)
);
COMMENT ON TABLE public.app_user_role_assignments IS 'Atribuições canônicas de papéis, com revogação e expiração.';
CREATE INDEX ix_app_user_role_active ON public.app_user_role_assignments(user_id,role_code) WHERE revoked_at IS NULL;
ALTER TABLE public.app_user_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_role_assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_user_role_assignments FROM anon, authenticated;
GRANT ALL ON public.app_user_role_assignments TO service_role;

CREATE TABLE public.app_producer_profiles(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL UNIQUE REFERENCES public.app_people(id) ON DELETE RESTRICT,
  brand_name VARCHAR(128) NOT NULL CHECK(length(trim(brand_name))>=2),
  rural_activity_type VARCHAR(64) NOT NULL DEFAULT 'misto' CHECK(rural_activity_type IN ('hortalicas_folhosas','legumes_picados','frutas','temperos','misto')),
  onboarding_step INTEGER NOT NULL DEFAULT 1 CHECK(onboarding_step BETWEEN 1 AND 5),
  verification_status VARCHAR(32) NOT NULL DEFAULT 'declared' CHECK(verification_status IN ('declared','pending','verified','partial','rejected','suspended')),
  trust_level INTEGER NOT NULL DEFAULT 0 CHECK(trust_level BETWEEN 0 AND 5),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.app_producer_profiles IS 'Perfil rural inicial; verificação e confiança só podem mudar por governança.';
ALTER TABLE public.app_producer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_producer_profiles FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_producer_profiles FROM anon, authenticated;
GRANT ALL ON public.app_producer_profiles TO service_role;

CREATE FUNCTION public.trg_fn_auth_user_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  INSERT INTO public.app_users(id,status) VALUES(NEW.id,'active') ON CONFLICT(id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_fn_auth_user_created() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_hortivital_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.trg_fn_auth_user_created();
COMMENT ON FUNCTION public.trg_fn_auth_user_created() IS 'Espelha a identidade criada pelo GoTrue, sem derivar papéis de user_metadata.';

CREATE FUNCTION public.trg_fn_app_users_bump_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.revision:=OLD.revision+1;
    NEW.updated_at:=clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_app_users_bump_revision BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.trg_fn_app_users_bump_revision();
COMMENT ON FUNCTION public.trg_fn_app_users_bump_revision() IS 'Revisiona alteração de estado da conta.';

CREATE FUNCTION public.trg_fn_entity_revision()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  NEW.revision:=OLD.revision+1;
  NEW.updated_at:=clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_app_people_revision BEFORE UPDATE ON public.app_people FOR EACH ROW EXECUTE FUNCTION public.trg_fn_entity_revision();
CREATE TRIGGER trg_app_producer_profiles_revision BEFORE UPDATE ON public.app_producer_profiles FOR EACH ROW EXECUTE FUNCTION public.trg_fn_entity_revision();
COMMENT ON FUNCTION public.trg_fn_entity_revision() IS 'Mantém revisão e timestamp de entidades editáveis.';
