import {z} from "zod";
export const DocumentTypeSchema=z.enum(["car_sicar","ccir_incra","dap_caf","laudo_agua","certidao_posse","outro"]);
export const DocumentMimeSchema=z.enum(["application/pdf","image/png","image/jpeg"]);
export const RequestUploadUrlSchema=z.object({propertyId:z.uuid(),documentType:DocumentTypeSchema,fileName:z.string().trim().min(1).max(255),fileSizeBytes:z.number().int().min(1024).max(15728640),mimeType:DocumentMimeSchema}).strict();
export const ConfirmUploadSchema=z.object({documentId:z.uuid()}).strict();
export const DocumentQuerySchema=z.object({propertyId:z.uuid().optional(),status:z.enum(["quarantine","clean","rejected","archived"]).optional()}).strict();
export type RequestUploadUrl=z.infer<typeof RequestUploadUrlSchema>;