-- Volume 01 / Trilha 03 — hardening complementar de privilégios.
-- Função interna de trigger não deve ser exposta como RPC para anon/authenticated.
REVOKE ALL ON FUNCTION public.trg_fn_auth_user_email_changed()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.trg_fn_auth_user_email_changed() IS
  'Trilha 03: função interna do trigger de sincronização de e-mail; execução direta revogada para papéis de API.';
