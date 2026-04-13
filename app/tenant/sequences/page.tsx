import { requireTenantCtx } from '@/lib/tenant/context';
import { queryMany } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';
import SequencesClient from '@/components/tenant/sequences-client';

export default async function SequencesPage() {
  const ctx = await requireTenantCtx();
  
  const permissions = {
    canView: can(ctx, 'automations.view'),
    canManage: can(ctx, 'automations.manage'),
  };

  const [sequences, enrollments] = await Promise.all([
    queryMany<any>(
      `SELECT s.*, 
              (SELECT count(*) FROM public.sequence_enrollments WHERE sequence_id = s.id) as enrollment_count,
              (SELECT count(*) FROM public.sequence_enrollments WHERE sequence_id = s.id AND status = 'active') as active_count
       FROM public.sequences s
       WHERE s.tenant_id = $1
       ORDER BY s.created_at DESC`,
      [ctx.tenantId]
    ),
    queryMany<any>(
      `SELECT se.*, c.first_name, c.last_name, c.email
       FROM public.sequence_enrollments se
       JOIN public.contacts c ON c.id = se.contact_id
       WHERE se.tenant_id = $1
       ORDER BY se.enrolled_at DESC
       LIMIT 50`,
      [ctx.tenantId]
    ),
  ]);

  return (
    <SequencesClient
      sequences={sequences}
      recentEnrollments={enrollments}
      permissions={permissions}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );
}
