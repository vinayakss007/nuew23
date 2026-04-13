import { requireTenantCtx, can } from '@/lib/tenant/context';
import { queryMany } from '@/lib/db/client';
import DealsDataTable from '@/components/tenant/deals-data-table';

export default async function DealsPage() {
  const ctx = await requireTenantCtx();
  const permissions = {
    canCreate:   can(ctx, 'deals.create'),
    canEdit:     can(ctx, 'deals.edit'),
    canDelete:   can(ctx, 'deals.delete'),
    canViewAll:  can(ctx, 'deals.view_all'),
    canViewValue: can(ctx, 'deals.view_value'),
  };
  const viewAll = permissions.canViewAll;
  const [deals, contacts, companies, teamMembers] = await Promise.all([
    queryMany<any>(
      `SELECT d.*, c.first_name, c.last_name, co.name AS company_name
       FROM public.deals d
       LEFT JOIN public.contacts c ON c.id = d.contact_id
       LEFT JOIN public.companies co ON co.id = d.company_id
       WHERE d.tenant_id = $1 AND d.deleted_at IS NULL ${!viewAll ? 'AND (d.assigned_to=$2 OR d.created_by=$2)' : ''}
       ORDER BY d.created_at DESC
       LIMIT 50`,
      viewAll ? [ctx.tenantId] : [ctx.tenantId, ctx.userId]
    ),
    queryMany<any>('SELECT id, first_name, last_name FROM public.contacts WHERE tenant_id=$1 ORDER BY first_name', [ctx.tenantId]),
    queryMany<any>('SELECT id, name FROM public.companies WHERE tenant_id=$1 ORDER BY name', [ctx.tenantId]),
    queryMany<any>(
      `SELECT tm.user_id, u.full_name FROM public.tenant_members tm
       JOIN public.users u ON u.id=tm.user_id WHERE tm.tenant_id=$1 AND tm.status='active'`,
      [ctx.tenantId]
    ),
  ]);
  return (
    <DealsDataTable
      initialDeals={deals} contacts={contacts} companies={companies}
      teamMembers={teamMembers} permissions={permissions}
    />
  );
}
