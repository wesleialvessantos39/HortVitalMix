-- HortiVitalMix — reconstrução controlada do onboarding/localidades.
-- Esta migration é ADITIVA porque 20261002170000_producer_onboarding_documents_stage
-- já está aplicada em produção. Não reescreve histórico nem remove dados.

-- A última garantia de integridade: qualquer imóvel fora de rascunho precisa ter
-- a localidade identificada, além dos demais campos obrigatórios já existentes.
ALTER TABLE public.app_properties
  DROP CONSTRAINT IF EXISTS ck_app_properties_submission_complete,
  ADD CONSTRAINT ck_app_properties_submission_complete CHECK (
    status = 'draft' OR (
      property_name IS NOT NULL
      AND rural_zone_sector IS NOT NULL
      AND line_vicinal IS NOT NULL
      AND municipality IS NOT NULL
      AND latitude_sede IS NOT NULL
      AND longitude_sede IS NOT NULL
      AND total_area_hectares IS NOT NULL
      AND cultivated_area_hectares IS NOT NULL
      AND water_source IS NOT NULL
      AND irrigation_system IS NOT NULL
      AND wizard_current_step = 6
    )
  );

-- Índices das FKs administrativas introduzidas pelo catálogo de localidades.
-- São pequenos, compatíveis com os dados atuais e eliminam varreduras em cascatas.
CREATE INDEX IF NOT EXISTS ix_app_municipalities_created_by
  ON public.app_municipalities(created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_app_municipalities_updated_by
  ON public.app_municipalities(updated_by)
  WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_app_municipalities_deactivated_by
  ON public.app_municipalities(deactivated_by)
  WHERE deactivated_by IS NOT NULL;

COMMENT ON CONSTRAINT ck_app_properties_submission_complete ON public.app_properties IS
  'Imóvel fora de rascunho exige localidade e as seis etapas estruturais completas.';
