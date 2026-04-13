import { requireTenantCtx } from '@/lib/tenant/context';
import { queryMany } from '@/lib/db/client';
import { redirect } from 'next/navigation';
import AuditLogClient from '@/components/tenant/settings/audit-client';

export default async function AuditLogPage() {
  const ctx = await requireTenantCtx();
  if (!ctx.isAdmin) redirect('/tenant/dashboard');

  const logs = await queryMany<any>(
    `SELECT al.id, al.action, al.resource_type, al.resource_id,
            al.created_at, al.ip_address, al.old_data, al.new_data,
            u.full_name, u.email
     FROM public.audit_logs al
     LEFT JOIN public.users u ON u.id = al.user_id
     WHERE al.tenant_id = $1
     ORDER BY al.created_at DESC LIMIT 500`,
    [ctx.tenantId]
  );

  return <AuditLogClient logs={logs} />;
}
