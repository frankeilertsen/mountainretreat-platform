/** Single source of truth for permissions (spec §3). Every server action/route checks this. */
export type Role = 'super_admin' | 'admin' | 'member' | 'helper';
export type UserLike = { id: string; system_role: Role | string; status: string; invite_tier?: string | null; loyalty_status?: string | null };

export const isAdmin = (u: UserLike) => u.system_role === 'super_admin' || u.system_role === 'admin';
export const isSuperAdmin = (u: UserLike) => u.system_role === 'super_admin';
export const isHelper = (u: UserLike) => u.system_role === 'helper';
export const isMember = (u: UserLike) => u.system_role === 'member';

export type Permission =
  | 'invite' | 'apply_loyalty' | 'request_booking' | 'admin' | 'manage_admins' | 'cleaning_portal';

export function can(u: UserLike, p: Permission): boolean {
  if (u.status !== 'active') return false;
  switch (p) {
    case 'admin': return isAdmin(u);
    case 'manage_admins': return isSuperAdmin(u);
    case 'cleaning_portal': return isHelper(u) || isAdmin(u);
    case 'request_booking': return isAdmin(u) || isMember(u);
    case 'invite':
      // Admins always; members only once their membership is approved for inviting
      return isAdmin(u) || (isMember(u) && (u.invite_tier === 'admin_invited' || u.loyalty_status === 'approved'));
    case 'apply_loyalty':
      return isMember(u) && u.invite_tier === 'member_invited' && u.loyalty_status === 'can_apply';
  }
}

export function homeFor(u: UserLike): string {
  if (isAdmin(u)) return '/admin';
  if (isHelper(u)) return '/renhold';
  return '/medlem';
}
