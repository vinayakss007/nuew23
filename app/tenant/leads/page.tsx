import { requireTenantCtx, can } from '@/lib/tenant/context';
import { queryMany, queryOne } from '@/lib/db/client';
import { Suspense } from 'react';
import LeadsClient from '@/components/tenant/leads-client-new';
import { Skeleton } from '@/components/ui/skeleton';

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-24" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default async function LeadsPage() {
  const ctx = await requireTenantCtx();
  const tid = ctx.tenantId;

  const permissions = {
    canCreate: can(ctx, 'leads.create'),
    canEdit: can(ctx, 'leads.edit'),
    canDelete: can(ctx, 'leads.delete'),
    canViewAll: can(ctx, 'leads.view_all'),
    canImport: can(ctx, 'leads.import'),
    canExport: can(ctx, 'leads.export'),
    canAssign: can(ctx, 'leads.assign'),
  };

  // Get pipeline statistics
  const stats = await queryMany<any>(
    `SELECT 
      lead_status,
      COUNT(*) as count,
      SUM(score) as total_score,
      AVG(score) as avg_score
    FROM public.leads
    WHERE tenant_id = $1 AND deleted_at IS NULL
    GROUP BY lead_status`,
    [tid]
  );

  // Get team members for assignment
  const teamMembers = await queryMany<any>(
    `SELECT tm.user_id, u.full_name, u.avatar_url, u.email
     FROM public.tenant_members tm
     JOIN public.users u ON u.id = tm.user_id
     WHERE tm.tenant_id = $1 AND tm.status = 'active'
     ORDER BY u.full_name`,
    [tid]
  );

  // Get companies for association
  const companies = await queryMany<any>(
    `SELECT id, name, industry, website
     FROM public.companies
     WHERE tenant_id = $1 AND deleted_at IS NULL
     ORDER BY name
     LIMIT 100`,
    [tid]
  );

  // Get lead sources distribution
  const sources = await queryMany<any>(
    `SELECT lead_source, COUNT(*) as count
     FROM public.leads
     WHERE tenant_id = $1 AND deleted_at IS NULL
     GROUP BY lead_source
     ORDER BY count DESC`,
    [tid]
  );

  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <LeadsClient
        permissions={permissions}
        teamMembers={teamMembers}
        companies={companies}
        stats={stats}
        sources={sources}
        tenantId={tid}
        userId={ctx.userId}
      />
    </Suspense>
  );
}
