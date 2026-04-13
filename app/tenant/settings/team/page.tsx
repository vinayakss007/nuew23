import { requireTenantCtx } from '@/lib/tenant/context';
import { queryMany } from '@/lib/db/client';
import { redirect } from 'next/navigation';
import TeamSettingsClient from '@/components/tenant/settings/team-client';

export default async function TeamPage() {
  const ctx = await requireTenantCtx();
  if (!ctx.isAdmin) redirect('/tenant/dashboard');

  const [members, invitations, roles] = await Promise.all([
    queryMany<any>(
      `SELECT tm.id, tm.user_id, tm.role_slug, tm.status, tm.joined_at,
              u.full_name, u.email, u.avatar_url, r.name AS role_name
       FROM public.tenant_members tm
       JOIN public.users u ON u.id=tm.user_id
       LEFT JOIN public.roles r ON r.id=tm.role_id
       WHERE tm.tenant_id=$1 AND tm.status='active'
       ORDER BY tm.joined_at ASC NULLS LAST`,
      [ctx.tenantId]
    ),
    queryMany<any>(
      `SELECT id, email, role_slug, expires_at, created_at FROM public.invitations
       WHERE tenant_id=$1 AND accepted_at IS NULL AND expires_at>now()
       ORDER BY created_at DESC`,
      [ctx.tenantId]
    ),
    queryMany<any>(
      'SELECT id, name, slug, description FROM public.roles WHERE tenant_id=$1 ORDER BY name',
      [ctx.tenantId]
    ),
  ]);

  return (
    <TeamSettingsClient
      members={members}
      invitations={invitations}
      roles={roles}
      tenantId={ctx.tenantId}
      currentUserId={ctx.userId}
    />
  );
}
