-- Grants por coluna da fundação continuavam ativos após REVOKE de tabela.
-- Perfil e dados do produtor seguem alteráveis apenas pelo backend autorizado.
-- Conserva todas as policies, SELECT, vínculos e dados existentes.
REVOKE UPDATE(full_name,phone_e164) ON public.app_people FROM PUBLIC,anon,authenticated;
REVOKE UPDATE(property_name,rural_activity_type) ON public.app_producer_profiles FROM PUBLIC,anon,authenticated;
