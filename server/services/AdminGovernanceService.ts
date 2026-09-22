import { createHash, randomBytes, randomUUID } from "node:crypto";
import { dbPool } from "../db/pool.ts";
import { createSupabasePublicClient, supabaseAdmin } from "../supabase/client.ts";
import type {
  AcceptInviteInput,
  AcceptInviteResult,
  AdminLoginResult,
  AdminRole,
  AdminSectorCode,
  AdminVerifySessionResponse,
  BootstrapRequestInput,
  BootstrapResult,
  BootstrapStatusResponse,
  CreateInviteInput,
  InviteResponse,
  MfaVerifyResult,
  ValidateInviteResponse,
} from "../../shared/contracts/adminGovernance.ts";

const MFA_TTL_MINUTES = 10;
const INVITE_TTL_HOURS = 24;
const RATE_WINDOW_MINUTES = 15;
const RATE_MAX_FAILURES = 5;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const maskEmail = (email: string) => {
  const [name, domain = ""] = email.split("@");
  return `${name.slice(0,2)}***@${domain}`;
};

export class AdminGovernanceService {
  static async getBootstrapStatus(): Promise<BootstrapStatusResponse> {
    const authorizedEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    if (!authorizedEmail) return { status: "disabled", reason: "BOOTSTRAP_ADMIN_EMAIL não configurado." };
    if (!dbPool) return { status: "disabled", reason: "Banco de dados indisponível." };
    const result = await dbPool.query(
      `SELECT 1 FROM public.app_user_role_assignments r
       JOIN public.app_users u ON u.id=r.user_id
       WHERE r.role_code='platform_super_admin' AND r.revoked_at IS NULL
       AND (r.expires_at IS NULL OR r.expires_at>now()) AND u.status='active' LIMIT 1`
    );
    return result.rowCount ? { status: "closed", reason: "Já existe Super administrador ativo." } : { status: "open", reason: null };
  }
}
