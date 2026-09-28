-- Execute somente como proprietário do banco. Fixtures aleatórias, sem Auth/email;
-- nenhuma conta real é consultada ou alterada. Tudo é revertido ao final.
BEGIN;
DO $$
DECLARE old_id uuid:=gen_random_uuid(); new_id uuid:=gen_random_uuid(); name_id uuid:=gen_random_uuid();
 cpf text:=lpad((floor(random()*99999999999))::bigint::text,11,'0');
 name_cpf text:=lpad((floor(random()*99999999999))::bigint::text,11,'0');
 fixture_name text:='Teste transacional '||gen_random_uuid()::text;
BEGIN
 INSERT INTO public.app_users(id,status) VALUES(old_id,'active'),(new_id,'active'),(name_id,'active');
 INSERT INTO public.app_people(user_id,full_name,cpf_normalized,email_normalized,phone_e164)
 VALUES(old_id,fixture_name,cpf,old_id||'@example.invalid','+5500000000000');
 INSERT INTO public.app_account_deletions(user_id,cpf_normalized,name_key,deleted_by)
 VALUES(old_id,cpf,public.governance_name_key(fixture_name),old_id);
 UPDATE public.app_users SET status='deleted' WHERE id=old_id;
 UPDATE public.app_people SET archived_at=now() WHERE user_id=old_id;
 PERFORM public.complete_public_registration(new_id,fixture_name,cpf,new_id||'@example.invalid','+5500000000000','consumer',NULL,NULL);
 IF (SELECT status FROM public.app_users WHERE id=new_id)<>'pending' THEN RAISE EXCEPTION 'CPF_REVIEW_FAILED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.app_registration_reviews WHERE user_id=new_id AND reasons @> ARRAY['cpf','name']) THEN RAISE EXCEPTION 'REVIEW_MISSING'; END IF;
 PERFORM public.complete_public_registration(name_id,upper(fixture_name),name_cpf,name_id||'@example.invalid','+5500000000000','producer','Teste rural','misto');
 IF NOT EXISTS(SELECT 1 FROM public.app_registration_reviews WHERE user_id=name_id AND reasons=ARRAY['name']) THEN RAISE EXCEPTION 'NAME_REVIEW_FAILED'; END IF;
 IF public.has_role_for(new_id,'consumer') THEN RAISE EXCEPTION 'PENDING_ROLE_ACCESS_LEAK'; END IF;
 BEGIN
  PERFORM public.add_public_role_to_existing_identity(new_id,cpf,new_id||'@example.invalid','producer','Teste','misto');
  RAISE EXCEPTION 'PENDING_ROLE_BYPASS';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 PERFORM public.request_account_reactivation(old_id,'consumer',NULL,NULL);
 PERFORM public.request_account_reactivation(old_id,'consumer',NULL,NULL);
 IF (SELECT count(*) FROM public.app_registration_reviews WHERE user_id=old_id AND status='pending')<>1 THEN RAISE EXCEPTION 'REACTIVATION_NOT_IDEMPOTENT'; END IF;
 BEGIN
  UPDATE public.app_people SET archived_at=NULL WHERE user_id=old_id;
  RAISE EXCEPTION 'DUPLICATE_CURRENT_CPF_ACCEPTED';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF public.effective_account_status('blocked',now()-interval '2 days',now()-interval '1 day')<>'active' THEN RAISE EXCEPTION 'AUTO_RELEASE_FAILED'; END IF;
 IF public.governance_name_key('  José   Ávila ')<>'jose avila' THEN RAISE EXCEPTION 'NAME_NORMALIZATION_FAILED'; END IF;
END $$;
SELECT 'CPF/name review, pending access denial, reactivation idempotency, active CPF uniqueness, name normalization and block expiry: passed' AS verification;
ROLLBACK;
