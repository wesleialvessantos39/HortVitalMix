import { dbPool } from "../db/pool.ts";
import { ACCOUNT_PERSON_SCOPE } from "./accountPersonScope.ts";
import type { AppearanceView } from "../../shared/contracts/appearance.ts";

export class AppearancePreferenceError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

export const AppearancePreferenceService = {
  async get(userId: string): Promise<AppearanceView> {
    if (!dbPool) throw new AppearancePreferenceError("DATABASE_UNAVAILABLE", 503);
    const result = await dbPool.query<{ theme: AppearanceView["theme"] }>(
      `SELECT preference.appearance_theme AS theme
       FROM (SELECT id FROM public.app_people WHERE ${ACCOUNT_PERSON_SCOPE}) owner
       LEFT JOIN public.app_user_preferences preference ON preference.person_id=owner.id`,
      [userId],
    );
    if (!result.rows[0]) throw new AppearancePreferenceError("PERSON_NOT_FOUND", 404);
    return { userId, theme: result.rows[0].theme };
  },
  async set(userId: string, theme: NonNullable<AppearanceView["theme"]>): Promise<AppearanceView> {
    if (!dbPool) throw new AppearancePreferenceError("DATABASE_UNAVAILABLE", 503);
    const result = await dbPool.query<{ theme: AppearanceView["theme"] }>(
      `INSERT INTO public.app_user_preferences(person_id, appearance_theme)
       SELECT id, $2 FROM public.app_people WHERE ${ACCOUNT_PERSON_SCOPE}
       ON CONFLICT (person_id) DO UPDATE SET appearance_theme=EXCLUDED.appearance_theme
       RETURNING appearance_theme AS theme`,
      [userId, theme],
    );
    if (!result.rows[0]) throw new AppearancePreferenceError("PERSON_NOT_FOUND", 404);
    return { userId, theme: result.rows[0].theme };
  },
};
