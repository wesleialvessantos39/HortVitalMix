SET lock_timeout = '5s';
CREATE TABLE public.app_offline_request_receipts (
 request_id uuid NOT NULL,
 user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 portal_role varchar(32) NOT NULL CHECK (portal_role IN ('consumer','producer','platform_admin','platform_super_admin')),
 request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 response_status integer NOT NULL CHECK (response_status BETWEEN 200 AND 299),
 response_body jsonb NOT NULL,
 processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY (user_id,portal_role,request_id),
 FOREIGN KEY (user_id,portal_role) REFERENCES public.app_account_profiles(user_id,role_code) ON DELETE CASCADE
);
CREATE INDEX ix_offline_receipts_processed ON public.app_offline_request_receipts(processed_at);
ALTER TABLE public.app_offline_request_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_offline_request_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_offline_request_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.app_offline_request_receipts TO service_role;
COMMENT ON TABLE public.app_offline_request_receipts IS 'Backend-only scoped receipts. SQL domain mutations and receipt commit atomically; no request payload or credentials. Consumer and producer receipts remain independent even with the same user_id.';
