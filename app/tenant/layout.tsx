import { requireTenantCtx } from '@/lib/tenant/context';
import { queryOne } from '@/lib/db/client';
import PlanLimitBanner from '@/components/tenant/plan-limit-banner';
import EmailVerifyBanner from '@/components/tenant/email-verify-banner';
import TenantShell from '@/components/tenant/layout/shell';

export default async function TenantLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireTenantCtx();

  const user = await queryOne<any>(
    'SELECT id,email,full_name,avatar_url,email_verified FROM public.users WHERE id=$1',
    [ctx.userId]
  );

  const tenant = { ...ctx.tenant, plan: ctx.plan };
  const profile = { ...user, is_super_admin: ctx.isSuperAdmin };

  return (
    <TenantShell
      tenant={tenant} profile={profile} roleSlug={ctx.roleSlug}
      permissions={ctx.permissions} isAdmin={ctx.isAdmin} isSuperAdmin={ctx.isSuperAdmin}
      emailVerified={user?.email_verified ?? false} email={user?.email ?? ''}
    >
      {children}
    </TenantShell>
  );
}
