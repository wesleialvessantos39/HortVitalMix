-- A pessoa/CPF pode ser referenciada por vários perfis. Uma credencial
-- administrativa, porém, pertence a exatamente um portal administrativo e
-- jamais recebe os papéis consumer/producer. Não altera contas existentes.
CREATE OR REPLACE FUNCTION hvm_governance_private.enforce_portal_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
DECLARE
  identity_id uuid;
  selected_role text;
BEGIN
  IF TG_TABLE_NAME = 'app_admin_principals' THEN
    identity_id := NEW.admin_user_id;
    selected_role := NEW.portal_role;
  ELSE
    IF NEW.revoked_at IS NOT NULL OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= now()) THEN
      RETURN NEW;
    END IF;
    identity_id := NEW.user_id;
    selected_role := NEW.role_code;
  END IF;

  -- Serialize grants and principal creation for this exact Auth identity.
  PERFORM pg_advisory_xact_lock(hashtextextended('portal-identity:' || identity_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.app_user_role_assignments r
    WHERE r.user_id = identity_id AND r.role_code <> selected_role
      AND r.revoked_at IS NULL AND (r.expires_at IS NULL OR r.expires_at > now())
      AND (selected_role IN ('platform_admin','platform_super_admin')
           OR r.role_code IN ('platform_admin','platform_super_admin'))
  ) OR EXISTS (
    SELECT 1 FROM public.app_admin_principals p
    WHERE p.admin_user_id = identity_id AND p.portal_role <> selected_role
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ADMINISTRATIVE_PORTAL_IDENTITY_CONFLICT';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION hvm_governance_private.enforce_portal_identity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_role_portal_identity
BEFORE INSERT OR UPDATE OF user_id, role_code, revoked_at, expires_at
ON public.app_user_role_assignments
FOR EACH ROW EXECUTE FUNCTION hvm_governance_private.enforce_portal_identity();

CREATE TRIGGER enforce_principal_portal_identity
BEFORE INSERT OR UPDATE OF admin_user_id, portal_role
ON public.app_admin_principals
FOR EACH ROW EXECUTE FUNCTION hvm_governance_private.enforce_portal_identity();

COMMENT ON COLUMN public.app_admin_principals.portal_role IS
'Credencial e login exclusivos deste portal. O mesmo e-mail pode ter outra credencial em outro portal; referência à pessoa/CPF não concede papéis nem compartilha senha ou sessão.';
COMMENT ON COLUMN public.app_admin_invites.target_person_id IS
'Referência cadastral opcional à pessoa. Nunca é usada como identidade Auth do convite. A ativação cria uma credencial administrativa independente.';
