import { requireTenantCtx, can } from '@/lib/tenant/context';
import { queryOne, queryMany } from '@/lib/db/client';
import { notFound } from 'next/navigation';
import DealDetailClient from '@/components/tenant/deal-detail-client';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DealDetailPage({ params }: PageProps) {
  const ctx = await requireTenantCtx();
  const { id } = await params;

  // Get deal details
  const deal = await queryOne<any>(
    `SELECT
      d.*,
      c.first_name, c.last_name, c.email AS contact_email, c.id AS contact_id,
      co.name AS company_name, co.id AS company_id, co.website AS company_website,
      u.full_name AS assigned_name, u.avatar_url AS assigned_avatar,
      creator.full_name AS created_by_name
    FROM public.deals d
    LEFT JOIN public.contacts c ON c.id = d.contact_id
    LEFT JOIN public.companies co ON co.id = d.company_id
    LEFT JOIN public.users u ON u.id = d.assigned_to
    LEFT JOIN public.users creator ON creator.id = d.created_by
    WHERE d.id = $1 AND d.tenant_id = $2 AND d.deleted_at IS NULL`,
    [id, ctx.tenantId]
  );

  if (!deal) {
    notFound();
  }

  // Get related tasks
  const tasks = await queryMany<any>(
    `SELECT id, title, description, priority, status, due_date, completed, created_at
     FROM public.tasks
     WHERE deal_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [id, ctx.tenantId]
  );

  // Get activities
  const activities = await queryMany<any>(
    `SELECT
      a.id, a.entity_type, a.action, a.description, a.metadata, a.created_at,
      u.full_name AS performed_by_name, u.avatar_url AS performed_by_avatar
    FROM public.activities a
    LEFT JOIN public.users u ON u.id = a.user_id
    WHERE a.entity_type = 'deal' AND a.entity_id = $1 AND a.tenant_id = $2
    ORDER BY a.created_at DESC
    LIMIT 100`,
    [id, ctx.tenantId]
  );

  const permissions = {
    canEdit: can(ctx, 'deals.edit'),
    canDelete: can(ctx, 'deals.delete'),
    canViewValue: can(ctx, 'deals.view_value'),
  };

  return (
    <DealDetailClient
      deal={deal}
      tasks={tasks}
      activities={activities}
      permissions={permissions}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );
}
