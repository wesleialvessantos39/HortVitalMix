-- HortiVitalMix v10 / Trilha 01. Errata autorizada em 2026-09-19.
GRANT SELECT ON public.app_releases,public.app_global_config,public.app_roles TO anon,authenticated;
GRANT SELECT ON public.app_users,public.app_people,public.app_user_role_assignments,public.app_producer_profiles,public.app_audit_events TO authenticated;
-- E03: permissões de coluna, sem UPDATE de tabela nem de campos de governança.
GRANT UPDATE(full_name,phone_e164) ON public.app_people TO authenticated;
GRANT UPDATE(brand_name,rural_activity_type) ON public.app_producer_profiles TO authenticated;
CREATE POLICY releases_public_read ON public.app_releases FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY config_public_read ON public.app_global_config FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY roles_public_read ON public.app_roles FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY audit_super_admin_read ON public.app_audit_events FOR SELECT TO authenticated USING(public.is_platform_super_admin());
CREATE POLICY users_self_read ON public.app_users FOR SELECT TO authenticated USING(id=(SELECT auth.uid()));
CREATE POLICY users_super_admin_read ON public.app_users FOR SELECT TO authenticated USING(public.is_platform_super_admin());
CREATE POLICY users_self_update ON public.app_users FOR UPDATE TO authenticated USING(id=(SELECT auth.uid())) WITH CHECK(id=(SELECT auth.uid()));
CREATE POLICY people_self_read ON public.app_people FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY people_super_admin_read ON public.app_people FOR SELECT TO authenticated USING(public.is_platform_super_admin());
CREATE POLICY people_self_update ON public.app_people FOR UPDATE TO authenticated USING(id=public.current_person_id()) WITH CHECK(id=public.current_person_id());
CREATE POLICY user_roles_self_read ON public.app_user_role_assignments FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY user_roles_super_admin_read ON public.app_user_role_assignments FOR SELECT TO authenticated USING(public.is_platform_super_admin());
CREATE POLICY producer_profiles_self_read ON public.app_producer_profiles FOR SELECT TO authenticated USING(person_id=public.current_person_id());
CREATE POLICY producer_profiles_self_update ON public.app_producer_profiles FOR UPDATE TO authenticated USING(person_id=public.current_person_id()) WITH CHECK(person_id=public.current_person_id());
CREATE POLICY producer_profiles_admin_read ON public.app_producer_profiles FOR SELECT TO authenticated USING(public.is_any_platform_admin());
CREATE VIEW public.v_rls_audit WITH(security_invoker=true) AS SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS rls_forced,count(p.polname) AS policy_count FROM pg_class c LEFT JOIN pg_policy p ON p.polrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relname LIKE 'app\_%' ESCAPE '\' GROUP BY c.relname,c.relrowsecurity,c.relforcerowsecurity;
REVOKE ALL ON public.v_rls_audit FROM PUBLIC,anon,authenticated;GRANT SELECT ON public.v_rls_audit TO service_role;
COMMENT ON VIEW public.v_rls_audit IS 'Inspeção de RLS para gate de homologação; acesso reservado.';
INSERT INTO storage.buckets(id,name,public) VALUES('documents','documents',false) ON CONFLICT(id) DO UPDATE SET public=false;
CREATE POLICY documents_owner_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id='documents' AND owner_id=(SELECT auth.uid())::text AND (storage.foldername(name))[1]=public.current_person_id()::text);
CREATE POLICY documents_owner_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='documents' AND owner_id=(SELECT auth.uid())::text AND (storage.foldername(name))[1]=public.current_person_id()::text);
-- Sem UPDATE/DELETE de documentos nesta trilha. O serviço emite URLs assinadas de 900s.
