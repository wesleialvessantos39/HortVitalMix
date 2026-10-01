-- Higiene de advisors do Supabase (Parte 1, item 1.3) — 2026-10-01.
-- Estritamente aditivo: nenhuma tabela/coluna/regra de negócio é removida ou reescrita.
-- (a) índices de cobertura para as 9 FKs sem índice apontadas pelo advisor 0001;
-- (b) reescrita equivalente das 3 políticas de leitura administrativa que
--     reavaliavam auth.uid() por linha (advisor 0003 auth_rls_initplan).

create index if not exists ix_account_deletions_deleted_by
  on public.app_account_deletions (deleted_by);
create index if not exists ix_account_deletions_user
  on public.app_account_deletions (user_id);
create index if not exists ix_app_admin_principals_created_by
  on public.app_admin_principals (created_by);
create index if not exists ix_document_reviews_user
  on public.app_document_reviews (user_id);
create index if not exists ix_app_documents_uploaded_by
  on public.app_documents (uploaded_by);
create index if not exists ix_app_documents_property_producer
  on public.app_documents (property_id, producer_id);
create index if not exists ix_registration_reviews_reviewed_by
  on public.app_registration_reviews (reviewed_by);
create index if not exists ix_verification_decisions_auditor
  on public.app_verification_decisions (auditor_id);
create index if not exists ix_verification_requests_claimed_by
  on public.app_verification_requests (claimed_by);

alter policy app_documents_admin_read on public.app_documents
  using (
    is_platform_super_admin()
    or (
      has_role('platform_admin'::text)
      and exists (
        select 1
        from public.app_admin_sector_members m
        where m.user_id = (select auth.uid())
          and (m.sector_code)::text = 'document_verification'::text
          and m.revoked_at is null
          and (m.expires_at is null or m.expires_at > now())
      )
    )
  );

alter policy verification_requests_admin_read on public.app_verification_requests
  using (
    is_platform_super_admin()
    or (
      has_role('platform_admin'::text)
      and exists (
        select 1
        from public.app_admin_sector_members m
        where m.user_id = (select auth.uid())
          and (m.sector_code)::text = 'document_verification'::text
          and m.revoked_at is null
          and (m.expires_at is null or m.expires_at > now())
      )
    )
  );

alter policy verification_decisions_admin_read on public.app_verification_decisions
  using (
    is_platform_super_admin()
    or (
      has_role('platform_admin'::text)
      and exists (
        select 1
        from public.app_admin_sector_members m
        where m.user_id = (select auth.uid())
          and (m.sector_code)::text = 'document_verification'::text
          and m.revoked_at is null
          and (m.expires_at is null or m.expires_at > now())
      )
    )
  );
