import { z } from "zod";
import { CommandIdSchema } from "./profilePrivacy.ts";

export const PropertyStatusSchema = z.enum([
  "draft",
  "completed",
  "submitted",
  "verified",
  "rejected",
  "suspended",
]);

export const BoundaryTypeSchema = z.enum([
  "perimeter",
  "cultivated_plot",
  "legal_reserve",
  "app_preservation",
]);

export const WaterSourceSchema = z.enum([
  "poco_artesiano",
  "nascente_propria",
  "rio_corrego",
  "rede_tratada",
]);

export const IrrigationSystemSchema = z.enum([
  "gotejamento",
  "microaspersao",
  "aspersao_convencional",
  "nenhum",
]);

export const RuralActivityCategorySchema = z.enum([
  "hortalicas_folhosas",
  "legumes_picados",
  "frutas_tropicais",
  "ervas_temperos",
  "misto",
]);

export const ProductionSystemSchema = z.enum([
  "organico_certificado",
  "agroecologico_declarado",
  "hidroponia",
  "convencional_transicao",
]);

const longitude = z.number().min(-67).max(-59);
const latitude = z.number().min(-14).max(-7);
const PositionSchema = z.tuple([longitude, latitude]);

export const GeoJsonPolygonSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(PositionSchema).min(4)).min(1),
  })
  .strict()
  .superRefine((polygon, ctx) => {
    polygon.coordinates.forEach((ring, ringIndex) => {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
        ctx.addIssue({
          code: "custom",
          path: ["coordinates", ringIndex],
          message: "O anel GeoJSON deve terminar no mesmo vértice em que começou",
        });
      }
    });
  });

export const PropertyBoundaryInputSchema = z
  .object({
    boundaryType: BoundaryTypeSchema,
    polygonGeojson: GeoJsonPolygonSchema,
    calculatedAreaHa: z.number().nonnegative().max(999_999.9999).multipleOf(0.0001).nullable().optional(),
  })
  .strict();

export const Step1IdentificationSchema = z
  .object({
    propertyName: z.string().trim().min(2).max(128),
    registrationNumber: z.string().trim().max(64).nullable().optional(),
    lineVicinal: z.string().trim().min(2).max(64),
    ruralZoneSector: z.string().trim().min(2).max(64),
    municipality: z.string().trim().min(2).max(100).default("Ariquemes"),
    state: z.literal("RO").default("RO"),
    latitudeSede: latitude,
    longitudeSede: longitude,
    accessDirections: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const Step2DimensionsSchema = z
  .object({
    totalAreaHectares: z.number().positive().max(999_999.9999).multipleOf(0.0001),
    cultivatedAreaHectares: z.number().nonnegative().max(999_999.9999).multipleOf(0.0001),
    boundaries: z.array(PropertyBoundaryInputSchema).max(32).default([]),
  })
  .strict()
  .refine(
    (value) => value.cultivatedAreaHectares <= value.totalAreaHectares,
    {
      path: ["cultivatedAreaHectares"],
      message: "A área cultivada não pode ser maior que a área total",
    },
  );

export const Step3WaterSchema = z
  .object({
    waterSource: WaterSourceSchema,
    irrigationSystem: IrrigationSystemSchema,
  })
  .strict();

export const Step4ActivitySchema = z
  .object({
    activityCategory: RuralActivityCategorySchema,
    productionSystem: ProductionSystemSchema,
    hasWashingFacility: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      value.activityCategory !== "legumes_picados" ||
      value.hasWashingFacility === true,
    {
      path: ["hasWashingFacility"],
      message:
        "Legumes picados exigem instalação física adequada para lavagem e higienização",
    },
  );

export const Step5ReviewSchema = z
  .object({
    agroecologicalCommitment: z.literal(true),
  })
  .strict();

const commonSaveFields = {
  completeOnly: z.boolean().optional(),
  commandId: CommandIdSchema,
} as const;

export const SaveWizardStepSchema = z.discriminatedUnion("step", [
  z
    .object({
      propertyId: z.uuid().optional(),
      expectedRevision: z.number().int().positive().optional(),
      step: z.literal(1),
      stepData: Step1IdentificationSchema,
      ...commonSaveFields,
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.propertyId && !value.expectedRevision) {
        ctx.addIssue({
          code: "custom",
          path: ["expectedRevision"],
          message: "A revisão atual é obrigatória ao editar um rascunho",
        });
      }
      if (!value.propertyId && value.expectedRevision) {
        ctx.addIssue({
          code: "custom",
          path: ["expectedRevision"],
          message: "Um novo imóvel ainda não possui revisão anterior",
        });
      }
    }),
  z
    .object({
      propertyId: z.uuid(),
      expectedRevision: z.number().int().positive(),
      step: z.literal(2),
      stepData: Step2DimensionsSchema,
      ...commonSaveFields,
    })
    .strict(),
  z
    .object({
      propertyId: z.uuid(),
      expectedRevision: z.number().int().positive(),
      step: z.literal(3),
      stepData: Step3WaterSchema,
      ...commonSaveFields,
    })
    .strict(),
  z
    .object({
      propertyId: z.uuid(),
      expectedRevision: z.number().int().positive(),
      step: z.literal(4),
      stepData: Step4ActivitySchema,
      ...commonSaveFields,
    })
    .strict(),
  z
    .object({
      propertyId: z.uuid(),
      expectedRevision: z.number().int().positive(),
      step: z.literal(5),
      stepData: Step5ReviewSchema,
      ...commonSaveFields,
    })
    .strict(),
]);

export const SubmitPropertySchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    agroecologicalCommitment: z.literal(true),
    commandId: CommandIdSchema,
  })
  .strict();

export type SaveWizardStepInput = z.infer<typeof SaveWizardStepSchema>;
export type SubmitPropertyInput = z.infer<typeof SubmitPropertySchema>;
export type PropertyStatus = z.infer<typeof PropertyStatusSchema>;

export type PropertyBoundaryView = {
  id: string;
  boundaryType: z.infer<typeof BoundaryTypeSchema>;
  polygonGeojson: z.infer<typeof GeoJsonPolygonSchema>;
  calculatedAreaHa: number | null;
  createdAt: string;
};

export type RuralActivityView = {
  id: string;
  activityCategory: z.infer<typeof RuralActivityCategorySchema>;
  productionSystem: z.infer<typeof ProductionSystemSchema>;
  hasWashingFacility: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RuralPropertyView = {
  id: string;
  draftData?: Record<string,unknown> | null;
  completedAt?: string | null;
  propertyName: string;
  registrationNumber: string | null;
  totalAreaHectares: number | null;
  cultivatedAreaHectares: number | null;
  ruralZoneSector: string;
  lineVicinal: string;
  municipality: string;
  state: "RO";
  latitudeSede: number;
  longitudeSede: number;
  accessDirections: string | null;
  waterSource: z.infer<typeof WaterSourceSchema> | null;
  irrigationSystem: z.infer<typeof IrrigationSystemSchema> | null;
  status: PropertyStatus;
  wizardCurrentStep: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  boundaries: PropertyBoundaryView[];
  activity: RuralActivityView | null;
};

export type RuralPropertySummary = Pick<
  RuralPropertyView,
  | "completedAt"
  | "id"
  | "propertyName"
  | "lineVicinal"
  | "municipality"
  | "state"
  | "status"
  | "wizardCurrentStep"
  | "revision"
  | "updatedAt"
> & {
  queueStatus?: string | null;
  reviewDecision?: string | null;
  reviewOpinion?: string | null;
};

// Partial input remains draft-only. Completion still uses the strict step schemas.
export const RuralDraftDataSchema=z.object({
 step:z.number().int().min(1).max(5), propertyName:z.string().max(128), registrationNumber:z.string().max(64),
 lineVicinal:z.string().max(64),ruralZoneSector:z.string().max(64),municipality:z.string().max(100),state:z.literal("RO"),
 latitudeSede:z.number().min(-14).max(-7).nullable(),longitudeSede:z.number().min(-67).max(-59).nullable(),
 accessDirections:z.string().max(500),totalAreaHectares:z.string().max(30),cultivatedAreaHectares:z.string().max(30),
 polygonGeojson:z.string().max(60000),waterSource:z.string().max(64),irrigationSystem:z.string().max(64),
 activityCategory:z.string().max(64),productionSystem:z.string().max(64),hasWashingFacility:z.boolean(),agroecologicalCommitment:z.boolean(),
}).strict();
export const SaveRuralDraftSchema=z.object({propertyId:z.uuid().optional(),expectedRevision:z.number().int().positive().optional(),commandId:CommandIdSchema,draft:RuralDraftDataSchema}).strict().refine(v=>!v.propertyId || !!v.expectedRevision);
export type SaveRuralDraftInput=z.infer<typeof SaveRuralDraftSchema>;
