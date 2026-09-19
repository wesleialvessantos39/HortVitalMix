-- Hardening operacional do projeto Supabase, sem alterar schema_version da Trilha 01.
-- A função rls_auto_enable() é infraestrutura pré-existente fora das migrations canônicas.
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;
