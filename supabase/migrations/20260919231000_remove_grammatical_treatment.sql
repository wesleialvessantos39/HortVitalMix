-- HortiVitalMix — ajuste solicitado em 2026-09-19.
-- Remove qualquer distinção masculino/feminino dos cadastros e perfis.

ALTER TABLE public.app_people
  DROP CONSTRAINT IF EXISTS chk_app_people_grammatical_treatment;

ALTER TABLE public.app_people
  DROP COLUMN IF EXISTS grammatical_treatment;
