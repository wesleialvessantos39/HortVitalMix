-- Hardening do fluxo de auditoria humana.
-- O enqueue é uma trigger interna; não deve ser invocado diretamente por clientes.
-- A FK de supersessão ganha índice para evitar scans em manutenção/remoção.

REVOKE EXECUTE ON FUNCTION public.enqueue_verification_on_submit()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_verification_on_submit()
  TO service_role;

CREATE INDEX IF NOT EXISTS ix_verification_requests_superseded_by_request
  ON public.app_verification_requests (superseded_by_request_id)
  WHERE superseded_by_request_id IS NOT NULL;
