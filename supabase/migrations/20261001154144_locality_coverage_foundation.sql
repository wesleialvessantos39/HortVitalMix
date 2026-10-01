-- HortiVitalMix — Base de Localidades, Cobertura e Escopo de Entrega
-- Rodada de correções pré-T12 (itens 1, 2, 3 e 5 do proprietário) — 2026-10-01.
-- Estritamente aditivo: nenhuma tabela, coluna ou regra vigente é removida.
--
-- Escopo desta migration:
--   (1) catálogo canônico de municípios de cobertura (app_municipalities) + seed dos 6;
--   (2) escopo de entrega do produtor (propriedade / todos / personalizado);
--   (3) bloqueios parciais por localidade (publicação do produtor e compra do consumidor);
--   (4) setor administrativo 'location_management' para delegação pelo Super administrador;
--   (5) funções de cobertura usadas pelo cadastro, pelo imóvel rural e pelo endereço de entrega.
--
-- Regra de cobertura (decisão do proprietário): só existe operação nos municípios
-- cadastrados e ATIVOS. Desativar um município interrompe publicação e novos cadastros
-- nele, sem apagar histórico.

-- ---------------------------------------------------------------------------
-- 1. Normalização de nome de município (sem extensões, determinística e imutável)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_locality_normalize(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT trim(BOTH '-' FROM regexp_replace(
    lower(translate(
      coalesce(p_value,''),
      'ÁÀÂÃÄÅáàâãäåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñÝýÿ',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy'
    )),
    '[^a-z0-9]+','-','g'))
$$;

COMMENT ON FUNCTION public.fn_locality_normalize(text) IS
  'Normaliza nome de município para comparação: sem acento, minúsculo, separado por hífen.';

-- ---------------------------------------------------------------------------
-- 2. Catálogo de municípios de cobertura
-- ---------------------------------------------------------------------------

CREATE TABLE public.app_municipalities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ibge_code varchar(7) NOT NULL CHECK (ibge_code ~ '^[0-9]{7}$'),
  name varchar(100) NOT NULL CHECK (length(trim(name))>=3),
  name_normalized varchar(120) NOT NULL,
  state char(2) NOT NULL DEFAULT 'RO' CHECK (state ~ '^[A-Z]{2}$'),
  is_active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  deactivated_at timestamptz NULL,
  deactivated_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  CONSTRAINT uq_app_municipalities_ibge UNIQUE (ibge_code),
  CONSTRAINT uq_app_municipalities_name UNIQUE (state, name_normalized),
  CONSTRAINT ck_app_municipalities_deactivation CHECK (
    (is_active AND deactivated_at IS NULL AND deactivated_by IS NULL)
    OR (NOT is_active AND deactivated_at IS NOT NULL)
  )
);

CREATE INDEX ix_app_municipalities_active
  ON public.app_municipalities(state, name) WHERE is_active;

CREATE OR REPLACE FUNCTION public.trg_fn_municipality_normalize()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_catalog AS $$
BEGIN
  NEW.name := trim(regexp_replace(NEW.name, '\s+', ' ', 'g'));
  NEW.state := upper(NEW.state);
  NEW.name_normalized := public.fn_locality_normalize(NEW.name);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_app_municipalities_normalize
BEFORE INSERT OR UPDATE OF name, state ON public.app_municipalities
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_municipality_normalize();

CREATE TRIGGER trg_app_municipalities_updated_at
BEFORE UPDATE ON public.app_municipalities
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_bump_updated_at();

-- Seed canônico dos 6 municípios autorizados (códigos IBGE oficiais, RO).
INSERT INTO public.app_municipalities(ibge_code,name,state) VALUES
 ('1100023','Ariquemes','RO'),
 ('1100130','Machadinho D''Oeste','RO'),
 ('1100262','Rio Crespo','RO'),
 ('1100601','Cacaulândia','RO'),
 ('1100940','Cujubim','RO'),
 ('1101757','Vale do Anari','RO')
ON CONFLICT (ibge_code) DO UPDATE
SET name=excluded.name, state=excluded.state, is_active=true,
    deactivated_at=NULL, deactivated_by=NULL,
    revision=public.app_municipalities.revision+1;

-- ---------------------------------------------------------------------------
-- 3. Funções de cobertura
-- ---------------------------------------------------------------------------

-- Resolve um município informado pelo usuário para a linha canônica do catálogo.
CREATE OR REPLACE FUNCTION public.fn_resolve_municipality(p_state text, p_name text)
RETURNS TABLE(id uuid, name varchar, state char(2), is_active boolean)
LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
  SELECT m.id, m.name, m.state, m.is_active
    FROM public.app_municipalities m
   WHERE m.state = upper(coalesce(p_state,''))
     AND m.name_normalized = public.fn_locality_normalize(p_name)
   LIMIT 1
$$;

-- 'active'     — município cadastrado e em operação
-- 'inactive'   — município cadastrado, mas desativado pelo Super administrador
-- 'unknown'    — município fora do catálogo (sem cobertura)
CREATE OR REPLACE FUNCTION public.fn_locality_coverage(p_state text, p_name text)
RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
  SELECT coalesce(
    (SELECT CASE WHEN m.is_active THEN 'active' ELSE 'inactive' END
       FROM public.app_municipalities m
      WHERE m.state = upper(coalesce(p_state,''))
        AND m.name_normalized = public.fn_locality_normalize(p_name)
      LIMIT 1),
    'unknown')
$$;

CREATE OR REPLACE FUNCTION public.fn_locality_coverage_by_id(p_municipality_id uuid)
RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
  SELECT coalesce(
    (SELECT CASE WHEN m.is_active THEN 'active' ELSE 'inactive' END
       FROM public.app_municipalities m WHERE m.id = p_municipality_id),
    'unknown')
$$;

COMMENT ON FUNCTION public.fn_locality_coverage(text,text) IS
  'Cobertura de um município por nome/UF: active, inactive ou unknown.';
COMMENT ON FUNCTION public.fn_locality_coverage_by_id(uuid) IS
  'Cobertura de um município por id: active, inactive ou unknown.';

-- ---------------------------------------------------------------------------
-- 4. Escopo de entrega do produtor (item 3 do proprietário)
--    property_municipality — somente no município do imóvel rural (padrão)
--    all                   — em todos os municípios cadastrados e ativos
--    custom                — somente no conjunto explicitamente escolhido
-- ---------------------------------------------------------------------------

CREATE TABLE public.app_producer_delivery_scopes (
  producer_id uuid PRIMARY KEY REFERENCES public.app_producer_profiles(id) ON DELETE CASCADE,
  scope varchar(24) NOT NULL DEFAULT 'property_municipality'
    CHECK (scope IN ('property_municipality','all','custom')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL
);

CREATE TABLE public.app_producer_delivery_municipalities (
  producer_id uuid NOT NULL REFERENCES public.app_producer_delivery_scopes(producer_id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES public.app_municipalities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(producer_id, municipality_id)
);

CREATE INDEX ix_app_producer_delivery_municipality_reverse
  ON public.app_producer_delivery_municipalities(municipality_id, producer_id);

CREATE TRIGGER trg_app_producer_delivery_scopes_updated_at
BEFORE UPDATE ON public.app_producer_delivery_scopes
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_bump_updated_at();

-- Um produtor só entrega em município ativo: desativar o município corta a entrega
-- sem apagar a escolha, que volta a valer quando o município for reativado.
CREATE OR REPLACE FUNCTION public.fn_producer_delivers_to(p_producer_id uuid, p_municipality_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
  SELECT
    public.fn_locality_coverage_by_id(p_municipality_id) = 'active'
    AND (
      CASE coalesce((
        SELECT s.scope FROM public.app_producer_delivery_scopes s
         WHERE s.producer_id = p_producer_id
      ), 'property_municipality')
        WHEN 'all' THEN true
        WHEN 'custom' THEN EXISTS (
          SELECT 1 FROM public.app_producer_delivery_municipalities dm
           WHERE dm.producer_id = p_producer_id
             AND dm.municipality_id = p_municipality_id
        )
        ELSE EXISTS (
          SELECT 1
            FROM public.app_properties p
            JOIN public.app_municipalities m
              ON m.state = p.state
             AND m.name_normalized = public.fn_locality_normalize(p.municipality)
           WHERE p.producer_id = p_producer_id
             AND p.status <> 'withdrawn'
             AND m.id = p_municipality_id
        )
      END
    )
$$;

COMMENT ON FUNCTION public.fn_producer_delivers_to(uuid,uuid) IS
  'Visibilidade de entrega: o produtor entrega no município informado conforme o escopo escolhido e a cobertura ativa.';

-- ---------------------------------------------------------------------------
-- 5. Bloqueios parciais por localidade (item 5 do proprietário)
--    subject producer_publishing — scope all = todos os imóveis; custom = imóveis listados
--    subject consumer_purchasing — scope all = todas as regiões; custom = regiões listadas
-- ---------------------------------------------------------------------------

CREATE TABLE public.app_access_partial_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  subject varchar(32) NOT NULL CHECK (subject IN ('producer_publishing','consumer_purchasing')),
  scope varchar(16) NOT NULL CHECK (scope IN ('all','custom')),
  reason varchar(500) NOT NULL DEFAULT 'denuncia_analisada',
  is_active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  command_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  revoked_at timestamptz NULL,
  revoked_by uuid NULL REFERENCES public.app_users(id) ON DELETE SET NULL,
  revoke_reason varchar(500) NULL,
  CONSTRAINT ck_app_partial_blocks_revocation CHECK (
    (is_active AND revoked_at IS NULL)
    OR (NOT is_active AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_app_access_partial_blocks_active
  ON public.app_access_partial_blocks(user_id, subject) WHERE is_active;
CREATE INDEX ix_app_access_partial_blocks_user
  ON public.app_access_partial_blocks(user_id, subject, created_at DESC);

CREATE TABLE public.app_access_partial_block_municipalities (
  block_id uuid NOT NULL REFERENCES public.app_access_partial_blocks(id) ON DELETE CASCADE,
  municipality_id uuid NOT NULL REFERENCES public.app_municipalities(id) ON DELETE CASCADE,
  PRIMARY KEY(block_id, municipality_id)
);

CREATE TABLE public.app_access_partial_block_properties (
  block_id uuid NOT NULL REFERENCES public.app_access_partial_blocks(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.app_properties(id) ON DELETE CASCADE,
  PRIMARY KEY(block_id, property_id)
);

-- 'none'   — sem bloqueio parcial
-- 'all'    — bloqueio total para o escopo do assunto
-- 'custom' — bloqueio restrito às localidades/imóveis listados
CREATE OR REPLACE FUNCTION public.fn_partial_block_kind(p_user_id uuid, p_subject text)
RETURNS text LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
  SELECT coalesce(
    (SELECT b.scope FROM public.app_access_partial_blocks b
      WHERE b.user_id = p_user_id AND b.subject = p_subject AND b.is_active
      LIMIT 1),
    'none')
$$;

-- Verdadeiro quando a publicação do produtor está bloqueada em um município.
CREATE OR REPLACE FUNCTION public.fn_is_publish_blocked(p_producer_user_id uuid, p_municipality_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.app_access_partial_blocks b
     WHERE b.user_id = p_producer_user_id
       AND b.subject = 'producer_publishing'
       AND b.is_active
       AND (
         b.scope = 'all'
         OR EXISTS (
           SELECT 1 FROM public.app_access_partial_block_municipalities bm
            WHERE bm.block_id = b.id AND bm.municipality_id = p_municipality_id
         )
       )
  )
$$;

-- Verdadeiro quando a compra do consumidor está bloqueada em um município.
CREATE OR REPLACE FUNCTION public.fn_is_purchase_blocked(p_consumer_user_id uuid, p_municipality_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=public,pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.app_access_partial_blocks b
     WHERE b.user_id = p_consumer_user_id
       AND b.subject = 'consumer_purchasing'
       AND b.is_active
       AND (
         b.scope = 'all'
         OR p_municipality_id IS NULL
         OR EXISTS (
           SELECT 1 FROM public.app_access_partial_block_municipalities bm
            WHERE bm.block_id = b.id AND bm.municipality_id = p_municipality_id
         )
       )
  )
$$;

COMMENT ON TABLE public.app_access_partial_blocks IS
  'Bloqueio parcial por localidade: restringe publicação (produtor) ou compra (consumidor) sem bloquear a conta.';
COMMENT ON FUNCTION public.fn_is_publish_blocked(uuid,uuid) IS
  'Trava de publicação do produtor em um município, considerando bloqueio total ou personalizado.';
COMMENT ON FUNCTION public.fn_is_purchase_blocked(uuid,uuid) IS
  'Trava de compra do consumidor em um município, considerando bloqueio total ou personalizado.';

-- ---------------------------------------------------------------------------
-- 6. Setor administrativo para delegação da gestão de localidades
-- ---------------------------------------------------------------------------

INSERT INTO public.app_admin_sectors(code,name,description) VALUES
 ('location_management','Gestão de Localidades','Cadastro, ativação e desativação de municípios de cobertura e bloqueios por localidade')
ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,is_active=true;

-- ---------------------------------------------------------------------------
-- 7. RLS, privilégios e comentários
-- ---------------------------------------------------------------------------

ALTER TABLE public.app_municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_municipalities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_producer_delivery_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_producer_delivery_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_producer_delivery_municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_producer_delivery_municipalities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_access_partial_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_access_partial_blocks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_access_partial_block_municipalities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_access_partial_block_municipalities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.app_access_partial_block_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_access_partial_block_properties FORCE ROW LEVEL SECURITY;

-- O catálogo de municípios é dado público de vitrine: leitura aberta.
CREATE POLICY municipalities_read_all ON public.app_municipalities
  FOR SELECT TO anon,authenticated USING(true);

-- O produtor lê o próprio escopo de entrega; a administração lê todos.
CREATE POLICY delivery_scope_owner_read ON public.app_producer_delivery_scopes
  FOR SELECT TO authenticated USING (
    producer_id IN (SELECT p.id FROM public.app_producer_profiles p WHERE p.person_id = (SELECT public.current_person_id()))
  );
CREATE POLICY delivery_scope_admin_read ON public.app_producer_delivery_scopes
  FOR SELECT TO authenticated USING ((SELECT public.is_any_platform_admin()));
CREATE POLICY delivery_municipalities_owner_read ON public.app_producer_delivery_municipalities
  FOR SELECT TO authenticated USING (
    producer_id IN (SELECT p.id FROM public.app_producer_profiles p WHERE p.person_id = (SELECT public.current_person_id()))
  );
CREATE POLICY delivery_municipalities_admin_read ON public.app_producer_delivery_municipalities
  FOR SELECT TO authenticated USING ((SELECT public.is_any_platform_admin()));

-- Bloqueios parciais: leitura do titular e da administração; nunca escrita pelo cliente.
CREATE POLICY partial_blocks_self_read ON public.app_access_partial_blocks
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY partial_blocks_admin_read ON public.app_access_partial_blocks
  FOR SELECT TO authenticated USING ((SELECT public.is_any_platform_admin()));
CREATE POLICY partial_block_municipalities_self_read ON public.app_access_partial_block_municipalities
  FOR SELECT TO authenticated USING (
    block_id IN (SELECT b.id FROM public.app_access_partial_blocks b WHERE b.user_id = (SELECT auth.uid()))
  );
CREATE POLICY partial_block_municipalities_admin_read ON public.app_access_partial_block_municipalities
  FOR SELECT TO authenticated USING ((SELECT public.is_any_platform_admin()));
CREATE POLICY partial_block_properties_self_read ON public.app_access_partial_block_properties
  FOR SELECT TO authenticated USING (
    block_id IN (SELECT b.id FROM public.app_access_partial_blocks b WHERE b.user_id = (SELECT auth.uid()))
  );
CREATE POLICY partial_block_properties_admin_read ON public.app_access_partial_block_properties
  FOR SELECT TO authenticated USING ((SELECT public.is_any_platform_admin()));

REVOKE ALL ON public.app_municipalities,public.app_producer_delivery_scopes,
 public.app_producer_delivery_municipalities,public.app_access_partial_blocks,
 public.app_access_partial_block_municipalities,public.app_access_partial_block_properties
 FROM anon,authenticated;

GRANT SELECT ON public.app_municipalities TO anon,authenticated;
GRANT SELECT ON public.app_producer_delivery_scopes,public.app_producer_delivery_municipalities,
 public.app_access_partial_blocks,public.app_access_partial_block_municipalities,
 public.app_access_partial_block_properties TO authenticated;

REVOKE ALL ON FUNCTION public.fn_locality_normalize(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_resolve_municipality(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_locality_coverage(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_locality_coverage_by_id(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_producer_delivers_to(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_partial_block_kind(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_is_publish_blocked(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_is_purchase_blocked(uuid,uuid) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.fn_locality_normalize(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_resolve_municipality(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_locality_coverage(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_locality_coverage_by_id(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_producer_delivers_to(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_partial_block_kind(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_publish_blocked(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_is_purchase_blocked(uuid,uuid) TO service_role;

COMMENT ON TABLE public.app_municipalities IS
  'Catálogo canônico de municípios de cobertura — cadastro, ativação e desativação pelo Super administrador.';
COMMENT ON TABLE public.app_producer_delivery_scopes IS
  'Escopo de entrega declarado pelo produtor: município do imóvel, todos os municípios ou personalizado.';
COMMENT ON TABLE public.app_producer_delivery_municipalities IS
  'Municípios escolhidos quando o escopo de entrega do produtor é personalizado.';
COMMENT ON TABLE public.app_access_partial_block_municipalities IS
  'Municípios atingidos por um bloqueio parcial personalizado.';
COMMENT ON TABLE public.app_access_partial_block_properties IS
  'Imóveis atingidos por um bloqueio parcial de publicação personalizado.';
