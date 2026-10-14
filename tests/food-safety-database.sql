-- Run against the migrated database. All fixture changes are rolled back.
BEGIN;
UPDATE public.app_food_configuration SET enabled=true WHERE id;
DO $$
DECLARE sid uuid;cid uuid;pid uuid;versions uuid[];rid uuid;vid uuid;newvid uuid;
 loc_state text;loc_city text;rule_body jsonb;f_revision integer;old_count integer;
BEGIN
 SELECT s.id,l.state,l.municipality INTO sid,loc_state,loc_city FROM public.app_producer_stores s
 JOIN public.app_properties l ON l.id=s.property_id LIMIT 1;
 SELECT id INTO cid FROM public.app_categories WHERE is_active LIMIT 1;
 IF sid IS NULL OR cid IS NULL THEN RAISE EXCEPTION 'FOOD_TEST_FIXTURE_UNAVAILABLE'; END IF;
 IF has_table_privilege('anon','public.app_food_acceptances','SELECT') OR has_table_privilege('authenticated','public.app_food_acceptances','INSERT')
 OR has_table_privilege('authenticated','public.app_food_rules','UPDATE') OR has_table_privilege('service_role','public.app_food_rule_versions','UPDATE')
 OR has_function_privilege('anon','hvm_food_private.expected_versions(uuid)','EXECUTE') THEN RAISE EXCEPTION 'FOOD_PRIVATE_GRANTS_FAILED'; END IF;
 IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.app_food_rules'::regclass,'public.app_food_rule_versions'::regclass,
 'public.app_food_materials'::regclass,'public.app_food_acceptances'::regclass,'public.app_food_assets'::regclass,'public.app_food_configuration'::regclass)
 AND NOT relrowsecurity) THEN RAISE EXCEPTION 'FOOD_RLS_FAILED'; END IF;
 INSERT INTO public.app_products(store_id,category_id,title,description,packaging_type,net_weight_grams,unit_type,shelf_life_days,conservation_notes,food_family,food_process)
 VALUES(sid,cid,'Verificação temporária de segurança','Fixture transacional para verificar controles alimentares','pote_higienizado',100,'pote',1,'Fixture, não disponibilizar','leafy','washed_cut') RETURNING id INTO pid;
 versions:=hvm_food_private.expected_versions(pid);
 IF cardinality(versions)<>3 OR hvm_food_private.product_is_compliant(pid) THEN RAISE EXCEPTION 'FOOD_MISSING_ACCEPTANCE_FAILED'; END IF;
 INSERT INTO public.app_food_acceptances(product_id,product_title,food_revision,rule_version_ids,requirements_token,checked_keys,rule_snapshot,terms_snapshot,command_id,location_state,location_municipality)
 VALUES(pid,'Fixture',1,ARRAY[versions[1]],repeat('a',64),'{}','[]','{}',gen_random_uuid(),loc_state,loc_city);
 IF hvm_food_private.product_is_compliant(pid) THEN RAISE EXCEPTION 'FOOD_PARTIAL_ACCEPTANCE_FAILED'; END IF;
 INSERT INTO public.app_food_acceptances(product_id,product_title,food_revision,rule_version_ids,requirements_token,checked_keys,rule_snapshot,terms_snapshot,command_id,location_state,location_municipality)
 VALUES(pid,'Fixture',1,versions,repeat('f',64),'{}','[]','{}',gen_random_uuid(),loc_state,'Cidade diferente');
 IF hvm_food_private.product_is_compliant(pid) THEN RAISE EXCEPTION 'FOOD_LOCATION_SNAPSHOT_FAILED'; END IF;
 INSERT INTO public.app_food_acceptances(product_id,product_title,food_revision,rule_version_ids,requirements_token,checked_keys,rule_snapshot,terms_snapshot,command_id,location_state,location_municipality)
 VALUES(pid,'Fixture',1,versions,repeat('b',64),'{}','[]','{}',gen_random_uuid(),loc_state,loc_city);
 IF NOT hvm_food_private.product_is_compliant(pid) THEN RAISE EXCEPTION 'FOOD_COMPLETE_ACCEPTANCE_FAILED'; END IF;
 UPDATE public.app_products SET revision=revision+1 WHERE id=pid;
 IF NOT hvm_food_private.product_is_compliant(pid) THEN RAISE EXCEPTION 'FOOD_NON_FOOD_CHANGE_FAILED'; END IF;
 UPDATE public.app_products SET description=description||' com novo processo' WHERE id=pid;
 IF hvm_food_private.product_is_compliant(pid) THEN RAISE EXCEPTION 'FOOD_EDIT_INVALIDATION_FAILED'; END IF;
 SELECT food_revision INTO f_revision FROM public.app_products WHERE id=pid;
 INSERT INTO public.app_food_acceptances(product_id,product_title,food_revision,rule_version_ids,requirements_token,checked_keys,rule_snapshot,terms_snapshot,command_id,location_state,location_municipality)
 VALUES(pid,'Fixture',f_revision,versions,repeat('c',64),'{}','[]','{}',gen_random_uuid(),loc_state,loc_city);
 UPDATE public.app_products SET food_hold=true WHERE id=pid;
 IF hvm_food_private.product_is_compliant(pid) THEN RAISE EXCEPTION 'FOOD_HOLD_FAILED'; END IF;
 UPDATE public.app_products SET food_hold=false WHERE id=pid;
 IF NOT hvm_food_private.product_is_compliant(pid) THEN RAISE EXCEPTION 'FOOD_RELEASE_FAILED'; END IF;
 SELECT v.rule_id,v.body INTO rid,rule_body FROM public.app_food_rule_versions v WHERE v.id=versions[1];
 INSERT INTO public.app_food_rule_versions(rule_id,version,body) SELECT rid,max(version)+1,rule_body FROM public.app_food_rule_versions WHERE rule_id=rid RETURNING id INTO newvid;
 UPDATE public.app_food_rules SET current_version_id=newvid WHERE id=rid;
 IF hvm_food_private.product_is_compliant(pid) THEN RAISE EXCEPTION 'FOOD_NEW_RULE_VERSION_FAILED'; END IF;
 BEGIN
   UPDATE public.app_products SET is_published=true WHERE id=pid;
   RAISE EXCEPTION 'FOOD_PUBLICATION_GUARD_FAILED';
 EXCEPTION WHEN check_violation THEN
   IF SQLERRM<>'PRODUCT_FOOD_CHECKLIST_REQUIRED' THEN RAISE; END IF;
 END;
 UPDATE public.app_products SET food_family='fruits',food_process='pressed_pulped' WHERE id=pid;
 SELECT current_version_id INTO vid FROM public.app_food_rules WHERE slug='sucos-polpas';
 IF NOT vid=ANY(hvm_food_private.expected_versions(pid)) THEN RAISE EXCEPTION 'FOOD_BEVERAGE_PROCESS_FAILED'; END IF;
 UPDATE public.app_products SET food_process='fresh' WHERE id=pid;
 IF vid=ANY(hvm_food_private.expected_versions(pid)) THEN RAISE EXCEPTION 'FOOD_BEVERAGE_SCOPE_FAILED'; END IF;
 UPDATE public.app_products SET food_family='juices_pulps',food_process='frozen' WHERE id=pid;
 IF NOT vid=ANY(hvm_food_private.expected_versions(pid)) THEN RAISE EXCEPTION 'FOOD_BEVERAGE_FAMILY_FAILED'; END IF;
 UPDATE public.app_products SET food_family='leafy',food_process='washed_cut' WHERE id=pid;
 SELECT draft_body INTO rule_body FROM public.app_food_rules WHERE is_core;
 rule_body:=jsonb_set(jsonb_set(jsonb_set(rule_body,'{scope}','"municipality"'),'{state}',to_jsonb(loc_state)),'{municipality}',to_jsonb(upper(loc_city)));
 INSERT INTO public.app_food_rules(slug,draft_body,status) VALUES('test-'||gen_random_uuid(),rule_body,'draft') RETURNING id INTO rid;
 old_count:=cardinality(hvm_food_private.expected_versions(pid));
 INSERT INTO public.app_food_rule_versions(rule_id,version,body) VALUES(rid,1,rule_body) RETURNING id INTO vid;
 UPDATE public.app_food_rules SET current_version_id=vid,status='published' WHERE id=rid;
 IF cardinality(hvm_food_private.expected_versions(pid))<>old_count+1 THEN RAISE EXCEPTION 'FOOD_MUNICIPAL_MATCH_FAILED'; END IF;
 UPDATE public.app_food_rules SET status='draft',draft_body=jsonb_set(rule_body,'{municipality}','"Município diferente"') WHERE id=rid;
 IF NOT vid=ANY(hvm_food_private.expected_versions(pid)) THEN RAISE EXCEPTION 'FOOD_DRAFT_PRESERVATION_FAILED'; END IF;
 UPDATE public.app_food_rules SET status='archived' WHERE id=rid;
 IF vid=ANY(hvm_food_private.expected_versions(pid)) THEN RAISE EXCEPTION 'FOOD_ARCHIVE_FAILED'; END IF;
 BEGIN
  UPDATE public.app_food_rules SET status='archived' WHERE is_core;
  RAISE EXCEPTION 'FOOD_CORE_RULE_GUARD_FAILED';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM<>'FOOD_BASE_RULE_REQUIRED' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK;
SELECT 'verified' AS food_safety_database_tests;
