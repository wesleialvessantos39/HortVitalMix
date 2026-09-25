import { z } from "zod";
import {
  BrazilianStatesEnum,
  CommandIdSchema,
} from "./profilePrivacy";

const nullableCoordinate = (min: number, max: number) =>
  z.number().min(min).max(max).nullable().optional();

const baseAddressShape = {
  label: z.string().trim().min(1).max(64).default("Casa"),
  cep: z
    .string()
    .transform((value) => value.replace(/\D/g, ""))
    .refine((value) => /^[0-9]{8}$/.test(value), "CEP com 8 dígitos"),
  street: z.string().trim().min(2).max(255),
  number: z.string().trim().min(1).max(32).default("S/N"),
  complement: z.string().trim().max(128).nullable().optional(),
  neighborhood: z.string().trim().min(2).max(128),
  city: z.string().trim().min(2).max(100),
  state: BrazilianStatesEnum,
  latitude: nullableCoordinate(-90, 90),
  longitude: nullableCoordinate(-180, 180),
  deliveryNotes: z.string().trim().max(255).nullable().optional(),
} as const;

function pairedCoordinates(
  value: { latitude?: number | null; longitude?: number | null },
  ctx: any,
) {
  const hasLatitude = value.latitude !== undefined && value.latitude !== null;
  const hasLongitude = value.longitude !== undefined && value.longitude !== null;
  if (hasLatitude !== hasLongitude) {
    ctx.addIssue({
      code: "custom",
      path: hasLatitude ? ["longitude"] : ["latitude"],
      message: "Latitude e longitude devem ser informadas juntas",
    });
  }
}

export const CreateAddressAdvancedSchema = z
  .object({
    ...baseAddressShape,
    isDefault: z.boolean().default(false),
    commandId: CommandIdSchema,
  })
  .strict()
  .superRefine(pairedCoordinates);

export const UpdateAddressAdvancedSchema = z
  .object({
    label: baseAddressShape.label.optional(),
    cep: baseAddressShape.cep.optional(),
    street: baseAddressShape.street.optional(),
    number: baseAddressShape.number.optional(),
    complement: baseAddressShape.complement,
    neighborhood: baseAddressShape.neighborhood.optional(),
    city: baseAddressShape.city.optional(),
    state: baseAddressShape.state.optional(),
    latitude: baseAddressShape.latitude,
    longitude: baseAddressShape.longitude,
    deliveryNotes: baseAddressShape.deliveryNotes,
    expectedRevision: z.number().int().positive(),
    commandId: CommandIdSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    pairedCoordinates(value, ctx);
    const mutableKeys = [
      "label",
      "cep",
      "street",
      "number",
      "complement",
      "neighborhood",
      "city",
      "state",
      "latitude",
      "longitude",
      "deliveryNotes",
    ] as const;
    if (!mutableKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
      ctx.addIssue({
        code: "custom",
        message: "Informe ao menos um campo para atualizar",
      });
    }
  });

export const SetDefaultAddressAdvancedSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    commandId: CommandIdSchema,
  })
  .strict();

export const DeleteAddressAdvancedSchema = z
  .object({
    expectedRevision: z.number().int().positive(),
    commandId: CommandIdSchema,
  })
  .strict();

export const QUICK_ADDRESS_LABELS = [
  "Casa",
  "Trabalho",
  "Sítio Pessoal",
  "Comercial",
] as const;

export type CreateAddressAdvancedInput = z.infer<
  typeof CreateAddressAdvancedSchema
>;
export type UpdateAddressAdvancedInput = z.infer<
  typeof UpdateAddressAdvancedSchema
>;

export type GeocodingAccuracy =
  | "rooftop"
  | "street"
  | "neighborhood"
  | "manual"
  | "none";

export type AddressAdvancedView = {
  id: string;
  label: string;
  cep: string;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  geocodingAccuracy: GeocodingAccuracy;
  deliveryNotes: string | null;
  isDefault: boolean;
  isActive: boolean;
  lastUsedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
