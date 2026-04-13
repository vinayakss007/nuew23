import { requireTenantCtx, can } from '@/lib/tenant/context';
import { queryOne } from '@/lib/db/client';
import { notFound } from 'next/navigation';
import TaskDetailClient from '@/components/tenant/task-detail-client';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function TaskDetailPage({ params }: PageProps) {
  const ctx = await requireTenantCtx();
  const { id } = await params;

  const task = await queryOne<any>(
    `SELECT t.*,
            c.first_name, c.last_name, c.email AS contact_email, c.id AS contact_id,
            d.title AS deal_title, d.id AS deal_id, d.value AS deal_value,
            co.name AS company_name, co.id AS company_id,
            u.full_name AS assigned_name, u.avatar_url AS assigned_avatar
     FROM public.tasks t
     LEFT JOIN public.contacts c ON c.id = t.contact_id
     LEFT JOIN public.deals d ON d.id = t.deal_id
     LEFT JOIN public.companies co ON co.id = t.company_id
     LEFT JOIN public.users u ON u.id = t.assigned_to
     WHERE t.id = $1 AND t.tenant_id = $2 AND t.deleted_at IS NULL`,
    [id, ctx.tenantId]
  );

  if (!task) notFound();

  const permissions = {
    canEdit: can(ctx, 'tasks.edit'),
    canDelete: can(ctx, 'tasks.delete'),
    canAssign: can(ctx, 'tasks.assign'),
  };

  return (
    <TaskDetailClient
      task={task}
      permissions={permissions}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );
}
