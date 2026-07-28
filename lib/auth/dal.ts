import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { hashInviteToken } from './utils';
import type { AppRole, AuthUser, InvitePreview, RoleAssignment } from './types';

export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;

    const userId = typeof claims?.sub === 'string' ? claims.sub : null;

    if (!userId) {
      return null;
    }

    const [
      { data: roles, error: rolesError },
      { data: profile, error: profileError },
    ] = await Promise.all([
      supabase
        .from('role_assignments')
        .select('role, scope_type, scope_id')
        .eq('user_id', userId),
      supabase
        .from('profiles')
        .select('full_name')
        .eq('id', userId)
        .maybeSingle(),
    ]);

    if (rolesError) {
      throw rolesError;
    }

    if (profileError) {
      throw profileError;
    }

    return {
      id: userId,
      email: typeof claims?.email === 'string' ? claims.email : null,
      fullName: profile?.full_name ?? null,
      roles: (roles ?? []) as RoleAssignment[],
    };
  } catch (error) {
    console.error('Failed to resolve current user:', error);
    return null;
  }
});

export function userHasRole(
  user: Pick<AuthUser, 'roles'> | null,
  role: AppRole
): boolean {
  return Boolean(user?.roles.some((assignment) => assignment.role === role));
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  return user;
}

export async function requireRole(allowed: AppRole[]) {
  const user = await requireUser();

  if (!user.roles.some((assignment) => allowed.includes(assignment.role))) {
    redirect('/');
  }

  return user;
}

export const isBootstrapRegistrationOpen = cache(async () => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('bootstrap_registration_open');

    if (error) {
      throw error;
    }

    return Boolean(data);
  } catch (error) {
    console.error('Failed to check bootstrap registration status:', error);
    return false;
  }
});

export async function getInvitePreviewByToken(
  token: string
): Promise<InvitePreview> {
  const trimmedToken = token.trim();

  if (!trimmedToken) {
    return { status: 'invalid' };
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('account_invites')
    .select('email, role, expires_at, accepted_at, revoked_at')
    .eq('token_hash', hashInviteToken(trimmedToken))
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return { status: 'invalid' };
  }

  if (data.revoked_at) {
    return { status: 'revoked', email: data.email, role: data.role };
  }

  if (data.accepted_at) {
    return { status: 'accepted', email: data.email, role: data.role };
  }

  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return {
      status: 'expired',
      email: data.email,
      role: data.role,
      expiresAt: data.expires_at,
    };
  }

  return {
    status: 'valid',
    email: data.email,
    role: data.role,
    expiresAt: data.expires_at,
  };
}
