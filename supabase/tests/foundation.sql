BEGIN;
DO $$DECLARE n integer;BEGIN
 SELECT count(*) INTO n FROM public.v_rls_audit WHERE rls_enabled AND rls_forced;IF n<>8 THEN RAISE EXCEPTION 'RLS_TABLE_COUNT';END IF;
 IF (SELECT count(*) FROM public.app_global_config)<>1 THEN RAISE EXCEPTION 'CONFIG_SINGLETON';END IF;
 IF (SELECT count(*) FROM public.app_roles)<>4 THEN RAISE EXCEPTION 'CANONICAL_ROLES';END IF;
 IF has_column_privilege('authenticated','public.app_users','status','UPDATE') OR has_column_privilege('authenticated','public.app_producer_profiles','trust_level','UPDATE') OR has_column_privilege('authenticated','public.app_producer_profiles','verification_status','UPDATE') THEN RAISE EXCEPTION 'SENSITIVE_COLUMN_WRITABLE';END IF;
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='documents' AND public) THEN RAISE EXCEPTION 'PUBLIC_DOCUMENTS';END IF;
END;$$;
SELECT set_config('hvm.test_a',gen_random_uuid()::text,true),set_config('hvm.test_b',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email) VALUES(current_setting('hvm.test_a')::uuid,'hvm-a-'||current_setting('hvm.test_a')||'@example.com'),(current_setting('hvm.test_b')::uuid,'hvm-b-'||current_setting('hvm.test_b')||'@example.com');
INSERT INTO public.app_people(user_id,full_name,cpf_normalized,email_normalized,phone_e164) VALUES(current_setting('hvm.test_a')::uuid,'Fixture A','52998224725','hvm-a-'||current_setting('hvm.test_a')||'@example.com','+5569999999999'),(current_setting('hvm.test_b')::uuid,'Fixture B','11144477735','hvm-b-'||current_setting('hvm.test_b')||'@example.com','+5569999999998');
INSERT INTO public.app_producer_profiles(person_id,brand_name) SELECT id,'Fixture' FROM public.app_people WHERE user_id=current_setting('hvm.test_a')::uuid;
INSERT INTO public.app_user_role_assignments(user_id,role_code) VALUES(current_setting('hvm.test_a')::uuid,'producer');
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('hvm.test_a'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$BEGIN
 IF (SELECT count(*) FROM public.app_users)<>1 OR (SELECT count(*) FROM public.app_people)<>1 THEN RAISE EXCEPTION 'CROSS_USER_READ';END IF;
 IF NOT public.has_role('producer') OR public.has_role('platform_super_admin') THEN RAISE EXCEPTION 'ROLE_RESOLUTION';END IF;
 BEGIN UPDATE public.app_users SET status='blocked' WHERE id=auth.uid();RAISE EXCEPTION 'USER_STATUS_WRITE_ALLOWED';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN UPDATE public.app_producer_profiles SET trust_level=5;RAISE EXCEPTION 'TRUST_WRITE_ALLOWED';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO public.app_user_role_assignments(user_id,role_code) VALUES(auth.uid(),'platform_super_admin');RAISE EXCEPTION 'ROLE_ESCALATION_ALLOWED';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE public.app_people SET full_name='Fixture editada' WHERE user_id=auth.uid();
END;$$;
RESET ROLE;
DO $DECLARE audit_test_id uuid:=gen_random_uuid();old_revision int;duplicate_command uuid:=gen_random_uuid();BEGIN
 INSERT INTO public.app_audit_events(id,request_id,action,target_entity,client_ip_hash) VALUES(audit_test_id,gen_random_uuid(),'test.assertion','fixture',repeat('a',64));
 BEGIN UPDATE public.app_audit_events SET action='test.changed' WHERE app_audit_events.id=audit_test_id;RAISE EXCEPTION 'AUDIT_UPDATE_ALLOWED';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN DELETE FROM public.app_audit_events WHERE app_audit_events.id=audit_test_id;RAISE EXCEPTION 'AUDIT_DELETE_ALLOWED';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
   INSERT INTO public.app_audit_events(request_id,action,target_entity,client_ip_hash,command_id)
   VALUES(gen_random_uuid(),'test.command.first','fixture',repeat('b',64),duplicate_command);
   BEGIN
     INSERT INTO public.app_audit_events(request_id,action,target_entity,client_ip_hash,command_id)
     VALUES(gen_random_uuid(),'test.command.second','fixture',repeat('c',64),duplicate_command);
     RAISE EXCEPTION 'DUPLICATE_COMMAND_ID_ALLOWED';
   EXCEPTION WHEN unique_violation THEN NULL;
   END;
 END;
 SELECT revision INTO old_revision FROM public.app_global_config;
 UPDATE public.app_global_config SET slogan=slogan;
 IF (SELECT revision FROM public.app_global_config)<>old_revision THEN RAISE EXCEPTION 'NOOP_REVISION';END IF;
 UPDATE public.app_global_config SET slogan='Slogan temporário de teste';
 IF (SELECT revision FROM public.app_global_config)<>old_revision+1 THEN RAISE EXCEPTION 'REVISION_NOT_INCREMENTED';END IF;
 DELETE FROM auth.users WHERE auth.users.id=current_setting('hvm.test_a')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.app_users WHERE app_users.id=current_setting('hvm.test_a')::uuid AND status='suspended') THEN RAISE EXCEPTION 'DELETE_MIRROR_FAILED';END IF;
END;$$;
SELECT 'foundation_sql_assertions_passed' AS result;
ROLLBACK;
