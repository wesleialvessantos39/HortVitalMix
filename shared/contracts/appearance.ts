import { z } from "zod";

export const AppearanceThemeSchema = z.enum(["light", "dark"]);
export const UpdateAppearanceSchema = z.object({
  theme: AppearanceThemeSchema,
  expectedUserId: z.string().uuid(),
}).strict();
export type AppearanceView = {
  userId: string;
  theme: z.infer<typeof AppearanceThemeSchema> | null;
};
