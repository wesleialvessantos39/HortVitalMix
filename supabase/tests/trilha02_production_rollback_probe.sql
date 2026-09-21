-- HortiVitalMix — Trilha 02 — prova mutacional segura em production.
-- O script testa bump de revision, unicidade de commandId e imutabilidade
-- da auditoria e termina obrigatoriamente com ROLLBACK.
BEGIN;

DO $$
DECLARE
  r0 integer;
  r1 integer;
  cid uuid := gen_random_uuid();
  rid uuid;
  duplicate_blocked boolean := false;
  immutable_blocked boolean := false;
BEGIN
  SELECT revision INTO r0
  FROM public.app_global_config
  WHERE singleton_guard=true
  FOR UPDATE;

  UPDATE public.app_global_config
     SET slogan='Tudo fresco. Tudo da sua região. [T02 PROBE]'
   WHERE singleton_guard=true;

  SELECT revision INTO r1
  FROM public.app_global_config
  WHERE singleton_guard=true;

  IF r1 <> r0 + 1 THEN
    RAISE EXCEPTION 'T02_PROBE_REVISION_BUMP_FAILED: before %, after %', r0, r1;
  END IF;

  INSERT INTO public.app_audit_events
    (request_id,actor_role,action,target_entity,client_ip_hash,command_id)
  VALUES
    (gen_random_uuid(),'platform_super_admin','config.updated',
     'app_global_config',repeat('a',64),cid)
  RETURNING id INTO rid;

  BEGIN
    INSERT INTO public.app_audit_events
      (request_id,actor_role,action,target_entity,client_ip_hash,command_id)
    VALUES
      (gen_random_uuid(),'platform_super_admin','config.updated',
       'app_global_config',repeat('b',64),cid);
  EXCEPTION WHEN unique_violation THEN
    duplicate_blocked := true;
  END;

  IF NOT duplicate_blocked THEN
    RAISE EXCEPTION 'T02_PROBE_COMMAND_ID_UNIQUENESS_FAILED';
  END IF;

  BEGIN
    UPDATE public.app_audit_events
       SET action='config.tampered'
     WHERE id=rid;
  EXCEPTION WHEN others THEN
    immutable_blocked := true;
  END;

  IF NOT immutable_blocked THEN
    RAISE EXCEPTION 'T02_PROBE_AUDIT_IMMUTABILITY_FAILED';
  END IF;
END $$;

ROLLBACK;

SELECT revision, slogan,
       (SELECT count(*) FROM public.app_audit_events) AS audit_count,
       true AS rollback_probe_passed
FROM public.app_global_config
WHERE singleton_guard=true;
