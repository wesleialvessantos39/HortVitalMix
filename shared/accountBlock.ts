export type AccountBlock = { status: string; block_starts_at?: string | Date | null; block_ends_at?: string | Date | null };
export function effectiveAccountStatus(row: AccountBlock, now = Date.now()) {
 if(row.status !== "blocked") return row.status;
 if(row.block_starts_at && new Date(row.block_starts_at).getTime()>now) return "active";
 if(row.block_ends_at && new Date(row.block_ends_at).getTime()<=now) return "active";
 return "blocked";
}
export function accountBlockCode(row: AccountBlock) {
 if(row.status === "deleted") return "ACCOUNT_DELETED";
 if(row.status === "pending") return "ACCOUNT_REVIEW_PENDING";
 return effectiveAccountStatus(row)==="blocked" ? (row.block_ends_at ? "ACCOUNT_BLOCKED_TEMPORARY" : "ACCOUNT_BLOCKED_INDEFINITE") : "ACCOUNT_UNAVAILABLE";
}
export const blockMessages: Record<string,string> = {
 ACCOUNT_DELETED: "Sua conta foi excluída por determinação da administração",
 ACCOUNT_REVIEW_PENDING: "Seu cadastro aguarda validação da administração.",
 ACCOUNT_BLOCKED_TEMPORARY: "Seu acesso está temporariamente bloqueado.",
 ACCOUNT_BLOCKED_INDEFINITE: "Seu acesso está bloqueado por prazo indeterminado.",
};
