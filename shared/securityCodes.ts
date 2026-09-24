// Supabase Auth emits eight digits in this project. Locally generated contact
// challenges remain six digits and use their own verifier and challenge store.
export const PROVIDER_OTP_LENGTH = 8;
export const PROVIDER_OTP_PATTERN = /^\d{8}$/;
export function validProviderOtp(value: string) {
  return PROVIDER_OTP_PATTERN.test(value);
}

export function hasConfirmedEmail(user: { email_confirmed_at?: string | null } | null | undefined) {
  return typeof user?.email_confirmed_at === "string" &&
    Number.isFinite(Date.parse(user.email_confirmed_at));
}
