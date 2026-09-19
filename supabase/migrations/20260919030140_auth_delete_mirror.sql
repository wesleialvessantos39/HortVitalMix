-- HortiVitalMix v10 / Trilha 01. Errata autorizada em 2026-09-19.
CREATE FUNCTION public.trg_fn_auth_user_deleted() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$BEGIN UPDATE public.app_users SET status='suspended',block_reason='auth_user_deleted',blocked_at=clock_timestamp(),authorization_revision=authorization_revision+1 WHERE id=OLD.id;RETURN OLD;END;$$;
REVOKE ALL ON FUNCTION public.trg_fn_auth_user_deleted() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_hortivital_auth_user_deleted AFTER DELETE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.trg_fn_auth_user_deleted();
COMMENT ON FUNCTION public.trg_fn_auth_user_deleted() IS 'Suspende espelho e invalida autorização após excluir identidade Auth; preserva histórico.';
