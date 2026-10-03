import { z } from "zod";
import {
  findRoMunicipality,
  normalizeMunicipalityName,
} from "../localities/roMunicipalities.ts";

/**
 * Contratos de localidade, cobertura e escopo de entrega.
 *
 * Regra vigente: só existe operação nos municípios cadastrados pelo Super
 * administrador e ATIVOS. Desativar um município interrompe novos cadastros,
 * a publicação do produtor e a visibilidade dos anúncios nele, sem apagar
 * histórico nem a escolha declarada pelo produtor.
 */

export const LocalityStateSchema = z
  .string()
  .trim()
  .length(2, "Use a sigla da UF com 2 letras")
  .transform((value) => value.toUpperCase());

export const MunicipalityNameSchema = z
  .string()
  .trim()
  .min(3, "Informe o nome do município")
  .max(100);

export const IbgeCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{7}$/, "Informe o código IBGE de 7 dígitos");

export const LocalityCoverageSchema = z.enum(["active", "inactive", "unknown"]);
export type LocalityCoverage = z.infer<typeof LocalityCoverageSchema>;

export const MunicipalitySchema = z
  .object({
    id: z.uuid(),
    ibgeCode: z.string().regex(/^\d{7}$/),
    name: z.string(),
    state: z.string().length(2),
    isActive: z.boolean(),
    revision: z.number().int().positive(),
  })
  .strict();
export type Municipality = z.infer<typeof MunicipalitySchema>;

export const MunicipalityListSchema = z
  .object({
    municipalities: z.array(MunicipalitySchema),
    activeMunicipalityIds: z.array(z.uuid()),
  })
  .strict();
export type MunicipalityList = z.infer<typeof MunicipalityListSchema>;

export const LocalityCoverageQuerySchema = z
  .object({
    state: LocalityStateSchema.default("RO"),
    municipality: MunicipalityNameSchema,
  })
  .strict();
export type LocalityCoverageQuery = z.infer<typeof LocalityCoverageQuerySchema>;

export const LocalityCoverageResponseSchema = z
  .object({
    coverage: LocalityCoverageSchema,
    municipality: z
      .object({
        id: z.uuid(),
        name: z.string(),
        state: z.string().length(2),
      })
      .strict()
      .nullable(),
    message: z.string().nullable(),
  })
  .strict();
export type LocalityCoverageResponse = z.infer<
  typeof LocalityCoverageResponseSchema
>;

export const CreateMunicipalitySchema = z
  .object({
    ibgeCode: IbgeCodeSchema,
    name: MunicipalityNameSchema,
    state: LocalityStateSchema.default("RO"),
    commandId: z.uuid(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.state !== "RO" ||
      !findRoMunicipality({
        name: value.name,
        ibgeCode: value.ibgeCode,
      })
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["ibgeCode"],
        message: "Município e código IBGE devem corresponder a Rondônia.",
      });
    }
  });
export type CreateMunicipalityInput = z.infer<typeof CreateMunicipalitySchema>;

export function localityNameKey(value: string) {
  return normalizeMunicipalityName(value);
}

export const UpdateMunicipalitySchema = z
  .object({
    isActive: z.boolean().optional(),
    name: MunicipalityNameSchema.optional(),
    expectedRevision: z.number().int().positive(),
    commandId: z.uuid(),
  })
  .strict()
  .refine(
    (value) => value.isActive !== undefined || value.name !== undefined,
    { message: "Informe ao menos uma alteração" },
  );
export type UpdateMunicipalityInput = z.infer<typeof UpdateMunicipalitySchema>;

export const DeleteMunicipalitySchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    commandId: z.uuid(),
  })
  .strict();
export type DeleteMunicipalityInput = z.infer<typeof DeleteMunicipalitySchema>;

export const LocalityMutationResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("created"),
    municipality: MunicipalitySchema,
  }),
  z.object({
    status: z.literal("updated"),
    municipality: MunicipalitySchema,
  }),
  z.object({ status: z.literal("conflict"), currentRevision: z.number().int() }),
  z.object({ status: z.literal("duplicate") }),
  z.object({
    status: z.literal("deleted"),
    municipalityId: z.uuid(),
    impact: z.object({
      municipalityId: z.uuid(),
      isActive: z.boolean(),
      people: z.number().int().nonnegative(),
      properties: z.number().int().nonnegative(),
      deliveryScopes: z.number().int().nonnegative(),
      partialBlocks: z.number().int().nonnegative(),
    }).strict().optional(),
  }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("invalid_state") }),
  z.object({ status: z.literal("unavailable") }),
]);
export type LocalityMutationResult = z.infer<
  typeof LocalityMutationResultSchema
>;

/** Visão administrativa do catálogo: inclui municípios desativados. */
export const AdminMunicipalitySchema = MunicipalitySchema.extend({
  deactivatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();
export type AdminMunicipality = z.infer<typeof AdminMunicipalitySchema>;

export const AdminMunicipalityListSchema = z
  .object({
    municipalities: z.array(AdminMunicipalitySchema),
    activeMunicipalityIds: z.array(z.uuid()),
  })
  .strict();
export type AdminMunicipalityList = z.infer<
  typeof AdminMunicipalityListSchema
>;

/** Impacto medido de desativar um município — alimenta o aviso de confirmação. */
export const MunicipalityImpactSchema = z
  .object({
    municipalityId: z.uuid(),
    isActive: z.boolean(),
    people: z.number().int().nonnegative(),
    properties: z.number().int().nonnegative(),
    deliveryScopes: z.number().int().nonnegative(),
    partialBlocks: z.number().int().nonnegative(),
  })
  .strict();
export type MunicipalityImpact = z.infer<typeof MunicipalityImpactSchema>;

export const RevokePartialBlockSchema = z
  .object({
    reason: z.string().trim().min(3).max(500).optional(),
    commandId: z.uuid(),
  })
  .strict();
export type RevokePartialBlockInput = z.infer<typeof RevokePartialBlockSchema>;

/** Identificação do titular de um bloqueio parcial (CPF ou e-mail). */
export const PartialBlockSubjectLookupSchema = z
  .object({
    found: z.boolean(),
    user: z
      .object({
        userId: z.uuid(),
        personId: z.uuid(),
        fullName: z.string(),
        cpf: z.string(),
        email: z.string(),
        status: z.string(),
        publicRoles: z.array(z.string()),
        municipalityId: z.uuid().nullable(),
        municipalityName: z.string().nullable(),
        municipalityState: z.string().nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type PartialBlockSubjectLookup = z.infer<
  typeof PartialBlockSubjectLookupSchema
>;

/** Escopo de entrega do produtor (item 3). */
export const DeliveryScopeModeSchema = z.enum([
  "property_municipality",
  "all",
  "custom",
]);
export type DeliveryScopeMode = z.infer<typeof DeliveryScopeModeSchema>;

export const ProducerDeliveryScopeSchema = z
  .object({
    mode: DeliveryScopeModeSchema,
    municipalityIds: z.array(z.uuid()),
    revision: z.number().int().positive(),
  })
  .strict();
export type ProducerDeliveryScope = z.infer<
  typeof ProducerDeliveryScopeSchema
>;

export const UpdateProducerDeliveryScopeSchema = z
  .object({
    mode: DeliveryScopeModeSchema,
    municipalityIds: z.array(z.uuid()).max(200).default([]),
    expectedRevision: z.number().int().positive(),
    commandId: z.uuid(),
  })
  .strict()
  .refine(
    (value) => value.mode !== "custom" || value.municipalityIds.length >= 1,
    {
      message: "Escolha pelo menos um município para a entrega personalizada",
      path: ["municipalityIds"],
    },
  );
export type UpdateProducerDeliveryScopeInput = z.infer<
  typeof UpdateProducerDeliveryScopeSchema
>;

/** Bloqueios parciais por localidade (item 5). */
export const PartialBlockSubjectSchema = z.enum([
  "producer_publishing",
  "consumer_purchasing",
]);
export type PartialBlockSubject = z.infer<typeof PartialBlockSubjectSchema>;

export const PartialBlockScopeSchema = z.enum(["all", "custom"]);
export type PartialBlockScope = z.infer<typeof PartialBlockScopeSchema>;

export const PartialBlockSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    subject: PartialBlockSubjectSchema,
    scope: PartialBlockScopeSchema,
    reason: z.string(),
    isActive: z.boolean(),
    municipalityIds: z.array(z.uuid()),
    propertyIds: z.array(z.uuid()),
    createdAt: z.string(),
    revokedAt: z.string().nullable(),
  })
  .strict();
export type PartialBlock = z.infer<typeof PartialBlockSchema>;

export const PartialBlockListSchema = z
  .object({ blocks: z.array(PartialBlockSchema) })
  .strict();

export const CreatePartialBlockSchema = z
  .object({
    userId: z.uuid(),
    subject: PartialBlockSubjectSchema,
    scope: PartialBlockScopeSchema,
    reason: z.string().trim().min(3).max(500),
    municipalityIds: z.array(z.uuid()).max(200).default([]),
    propertyIds: z.array(z.uuid()).max(500).default([]),
    commandId: z.uuid(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === "custom" && value.municipalityIds.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["municipalityIds"],
        message: "Escolha pelo menos um município para o bloqueio personalizado",
      });
    if (value.subject === "consumer_purchasing" && value.propertyIds.length)
      ctx.addIssue({
        code: "custom",
        path: ["propertyIds"],
        message: "Bloqueio de compra não usa imóveis",
      });
    if (
      value.subject === "producer_publishing" &&
      value.scope === "custom" &&
      value.propertyIds.length === 0
    )
      ctx.addIssue({
        code: "custom",
        path: ["propertyIds"],
        message: "Escolha os imóveis bloqueados ou bloqueie todos os imóveis",
      });
  });
export type CreatePartialBlockInput = z.infer<typeof CreatePartialBlockSchema>;

export const PartialBlockMutationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("created"), block: PartialBlockSchema }),
  z.object({ status: z.literal("revoked") }),
  z.object({ status: z.literal("already_active"), block: PartialBlockSchema }),
  z.object({ status: z.literal("not_found") }),
  z.object({ status: z.literal("unavailable") }),
]);
export type PartialBlockMutationResult = z.infer<
  typeof PartialBlockMutationResultSchema
>;

export const LocalityErrorCode = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "LOCALITY_NOT_FOUND",
  DUPLICATE: "LOCALITY_DUPLICATE",
  CONFLICT: "LOCALITY_REVISION_CONFLICT",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  REAUTH_REQUIRED: "ADMIN_REAUTHENTICATION_REQUIRED",
  UNAVAILABLE: "UNAVAILABLE",
  REGISTRATION_NOT_COVERED: "LOCALITY_NOT_COVERED",
  REGISTRATION_DISABLED: "LOCALITY_DISABLED",
} as const;

/** Mensagem literal exigida pelo proprietário para região desativada. */
export const LOCALITY_DISABLED_MESSAGE =
  "Sua região está bloqueada. Dúvidas, entre em contato conosco: hortivitalmix@gmail.com.";

export const LOCALITY_NOT_COVERED_MESSAGE =
  "Sua região está fora de cobertura. Dúvidas, entre em contato conosco: hortivitalmix@gmail.com.";

export function localityBlockedMessage(coverage: LocalityCoverage): string {
  if (coverage === "inactive") return LOCALITY_DISABLED_MESSAGE;
  return LOCALITY_NOT_COVERED_MESSAGE;
}
