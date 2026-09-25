-- HortiVitalMix — Trilha 06 — hardening RLS pós-advisor
-- Remove policies FOR ALL que também duplicavam SELECT, mantendo seis policies
-- estritas de dados pessoais e deixando mutações sensíveis no backend canônico.

DROP POLICY IF EXISTS addresses_self_write ON public.app_user_addresses;
DROP POLICY IF EXISTS preferences_self_write ON public.app_user_preferences;
DROP POLICY IF EXISTS consents_self_insert ON public.app_consent_records;

CREATE POLICY addresses_self_insert ON public.app_user_addresses
FOR INSERT TO authenticated
WITH CHECK (person_id=public.current_person_id());

CREATE POLICY addresses_self_update ON public.app_user_addresses
FOR UPDATE TO authenticated
USING (person_id=public.current_person_id())
WITH CHECK (person_id=public.current_person_id());

CREATE POLICY addresses_self_delete ON public.app_user_addresses
FOR DELETE TO authenticated
USING (person_id=public.current_person_id());

REVOKE INSERT,UPDATE ON public.app_user_preferences FROM authenticated;
REVOKE INSERT ON public.app_consent_records FROM authenticated;

COMMENT ON POLICY addresses_self_insert ON public.app_user_addresses IS
'Trilha 06: titular só insere endereço vinculado à própria pessoa.';
COMMENT ON POLICY addresses_self_update ON public.app_user_addresses IS
'Trilha 06: titular só altera endereço vinculado à própria pessoa.';
COMMENT ON POLICY addresses_self_delete ON public.app_user_addresses IS
'Trilha 06: titular só remove endereço vinculado à própria pessoa.';
