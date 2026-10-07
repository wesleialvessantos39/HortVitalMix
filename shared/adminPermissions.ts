import type { AdminSectorCode } from "./contracts/adminGovernance.ts";

export const ADMIN_SECTOR_LABELS: Record<AdminSectorCode, string> = {
  document_verification: "Verificação de documentos",
  catalog_moderation: "Moderação do catálogo",
  finance_ops: "Operações financeiras",
  location_management: "Gestão de localidades",
  account_governance: "Gestão de contas e acessos",
  platform_configuration: "Configuração da plataforma e BI",
  refund_management: "Gestão de reembolsos",
  complaint_management: "Denúncias e avaliações",
  payment_configuration: "Pagamentos e assinaturas",
};

type Access = {
  role?: string | null;
  isSuperAdmin?: boolean;
  sectors: readonly string[];
  deniedSectors?: readonly string[];
};

export function hasAdminPermission(
  access: Access | null | undefined,
  sector: AdminSectorCode,
) {
  if (!access || access.deniedSectors?.includes(sector)) return false;
  return (
    access.role === "platform_super_admin" ||
    access.isSuperAdmin === true ||
    access.sectors.includes(sector)
  );
}

export const adminSectorLabel = (code: string) =>
  ADMIN_SECTOR_LABELS[code as AdminSectorCode] ?? "Setor administrativo";
