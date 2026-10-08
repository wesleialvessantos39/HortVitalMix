-- Protect existing immutable notifications whose departmental broadcasts omitted
-- required_sector. No rows or historical migrations are changed.
SET lock_timeout='5s';

CREATE FUNCTION hvm_notifications_private.origin_sector(p_sector text,p_role text,p_path text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(p_sector,CASE WHEN p_role IN ('platform_admin','platform_super_admin') THEN CASE
  WHEN route='/admin/reembolsos' OR route LIKE '/admin/reembolsos/%' OR route='/admin/politica-reembolso' OR route LIKE '/admin/politica-reembolso/%' THEN 'refund_management'
  WHEN route='/admin/denuncias' OR route LIKE '/admin/denuncias/%' OR route='/admin/avaliacoes' OR route LIKE '/admin/avaliacoes/%' THEN 'complaint_management'
  WHEN route='/admin/pagamentos' OR route LIKE '/admin/pagamentos/%' OR route='/admin/assinaturas' OR route LIKE '/admin/assinaturas/%' THEN 'payment_configuration'
  WHEN route='/admin/documentos/fila' OR route LIKE '/admin/documentos/fila/%' OR route='/admin/imoveis' OR route LIKE '/admin/imoveis/%' THEN 'document_verification'
  WHEN route='/admin/localidades' OR route LIKE '/admin/localidades/%' OR route='/admin/bloqueios' OR route LIKE '/admin/bloqueios/%' THEN 'location_management'
  WHEN route='/admin/configuracao' OR route LIKE '/admin/configuracao/%' OR route='/admin/bi' OR route LIKE '/admin/bi/%' THEN 'platform_configuration'
  WHEN route='/admin/categorias' OR route LIKE '/admin/categorias/%' THEN 'catalog_moderation'
  WHEN route='/admin/usuarios' OR route LIKE '/admin/usuarios/%' OR route='/admin/governanca' OR route LIKE '/admin/governanca/%' THEN 'account_governance'
 END END)
 FROM (SELECT split_part(split_part(p_path,'?',1),'#',1) AS route) normalized;
$$;
REVOKE ALL ON FUNCTION hvm_notifications_private.origin_sector(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_notifications_private.origin_sector(text,text,text) TO authenticated,service_role;

-- A private, identity-bound wrapper is necessary because authenticated clients
-- cannot call the privileged governance permission lookup directly.
CREATE FUNCTION hvm_notifications_private.origin_readable(p_role text,p_sector text,p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT uid IS NOT NULL
 AND p_role=ANY(hvm_notifications_private.allowed_roles(uid))
 AND (effective_sector IS NULL OR hvm_governance_private.has_permission(uid,effective_sector))
 FROM (SELECT (SELECT auth.uid()) AS uid,
 hvm_notifications_private.origin_sector(p_sector,p_role,p_path) AS effective_sector) context;
$$;
REVOKE ALL ON FUNCTION hvm_notifications_private.origin_readable(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION hvm_notifications_private.origin_readable(text,text,text) TO authenticated,service_role;

CREATE POLICY notification_origin_restriction ON public.app_notifications
AS RESTRICTIVE FOR SELECT TO authenticated
USING (hvm_notifications_private.origin_readable(recipient_role,required_sector,action_path));

COMMENT ON FUNCTION hvm_notifications_private.origin_sector(text,text,text) IS 'Canonical origin-sector mapping for immutable notifications; explicit sector takes precedence and unknown/personal destinations remain unscoped.';
COMMENT ON FUNCTION hvm_notifications_private.origin_readable(text,text,text) IS 'Identity-bound RLS check using live roles, status and delegated permissions, including explicit super-administrator denials.';
