import { requireTenantCtx, can } from '@/lib/tenant/context';
import { queryMany } from '@/lib/db/client';
import CompaniesDataTable from '@/components/tenant/companies-data-table';

export default async function CompaniesPage() {
  const ctx = await requireTenantCtx();
  const permissions = {
    canCreate: can(ctx, 'companies.create'),
    canEdit:   can(ctx, 'companies.edit'),
    canDelete: can(ctx, 'companies.delete'),
  };
  const companies = await queryMany<any>(
    `SELECT c.*, (SELECT count(*)::int FROM public.contacts WHERE company_id = c.id) AS contact_count
     FROM public.companies c WHERE c.tenant_id = $1 ORDER BY c.name
     LIMIT 50`,
    [ctx.tenantId]
  );
  return (
    <CompaniesDataTable
      initialCompanies={companies}
      permissions={permissions}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );
}
