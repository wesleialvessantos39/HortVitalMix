import type { NextFunction, Request, Response } from 'express';
import { supabaseAdmin } from '../supabase/client';

export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.actor = null;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || !supabaseAdmin) return next();

  const { data, error } = await supabaseAdmin.auth.getUser(authHeader.slice(7));
  if (error || !data.user) return next();

  const [{ data: account }, { data: roles }] = await Promise.all([
    supabaseAdmin.from('app_users').select('status').eq('id', data.user.id).maybeSingle(),
    supabaseAdmin.from('app_user_role_assignments').select('role_code, expires_at, revoked_at').eq('user_id', data.user.id),
  ]);

  if (!account || account.status !== 'active') return next();
  const now = Date.now();
  req.actor = {
    userId: data.user.id,
    email: data.user.email ?? null,
    roles: (roles ?? []).filter((role) => !role.revoked_at && (!role.expires_at || new Date(role.expires_at).getTime() > now)).map((role) => role.role_code),
  };
  next();
}
