import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from '@/lib/auth/session';
import { queryOne } from '@/lib/db/client';
import SuperAdminShell from '@/components/superadmin/shell';
import SuperAdminHeader from '@/components/superadmin/header';

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('nucrm_session')?.value;
  if (!token) redirect('/auth/login');
  const payload = await verifyToken(token);
  if (!payload) redirect('/auth/login');

  const user = await queryOne<any>(
    'SELECT id,email,full_name,is_super_admin FROM public.users WHERE id=$1',
    [payload.userId]
  );
  if (!user?.is_super_admin) redirect('/tenant/dashboard');

  // Quick platform stats for header
  const stats = await queryOne<any>(
    `SELECT
       count(*)::int as total_tenants,
       count(*) FILTER (WHERE status='active')::int as active_tenants,
       (SELECT count(*) FILTER (WHERE resolved=false AND level IN ('error','fatal')) FROM public.error_logs) as open_errors
     FROM public.tenants`
  ).catch(() => ({ total_tenants:0, active_tenants:0, open_errors:0 }));

  return (
    <SuperAdminShell user={user} stats={stats}>{children}</SuperAdminShell>
  );
}
