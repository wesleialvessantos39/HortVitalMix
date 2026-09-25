import type { AdminVerifySessionResponse } from "../../shared/contracts/adminGovernance";
// One-use UI handoff from a successful password login. Every protected API
// continues to authorize on the server. Never persist credentials or this value.
let pending: { access: AdminVerifySessionResponse; expires: number } | null = null;
export function primeAdminAccess(access: AdminVerifySessionResponse) {
  pending = { access, expires: Date.now() + 5000 };
}
export function takeAdminAccess() {
  const value = pending;
  pending = null;
  return value && value.expires > Date.now() ? value.access : null;
}
