-- HortiVitalMix — errata funcional autorizada em 2026-09-19.
-- Cadastro brasileiro: tratamento gramatical explícito e nome do imóvel.

ALTER TABLE public.app_people
  ADD COLUMN grammatical_treatment VARCHAR(16);

ALTER TABLE public.app_people
  ADD CONSTRAINT chk_app_people_grammatical_treatment
  CHECK (
    grammatical_treatment IS NULL
    OR grammatical_treatment IN ('masculine','feminine')
  );

COMMENT ON COLUMN public.app_people.grammatical_treatment IS
  'Preferência explícita de tratamento gramatical da interface; não é inferida pelo nome e não participa de autorização.';

ALTER TABLE public.app_producer_profiles
  RENAME COLUMN brand_name TO property_name;

COMMENT ON COLUMN public.app_producer_profiles.property_name IS
  'Nome do imóvel informado no cadastro inicial do produtor ou produtora.';
