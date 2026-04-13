import { requireTenantCtx, can } from '@/lib/tenant/context';
import { queryMany, queryOne } from '@/lib/db/client';
import { Suspense } from 'react';
import ContactsClient from '@/components/tenant/contacts-client';
import { Skeleton } from '@/components/ui/skeleton';

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-28" />
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="admin-card">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ offset?: string; q?: string; status?: string }> }) {
  const ctx = await requireTenantCtx();
  const tid = ctx.tenantId;
  const sp = await searchParams;
  const offset = parseInt(sp.offset || '0');
  const q = sp.q || '';
  const status = sp.status || 'all';
  const limit = 50;

  const permissions = {
    canCreate: can(ctx, 'contacts.create'),
    canEdit: can(ctx, 'contacts.edit'),
    canDelete: can(ctx, 'contacts.delete'),
    canViewAll: can(ctx, 'contacts.view_all'),
    canImport: can(ctx, 'contacts.import'),
    canExport: can(ctx, 'contacts.export'),
    canAssign: can(ctx, 'contacts.assign'),
  };

  const viewAll = permissions.canViewAll;
  const params: any[] = [];
  let pi = 1;

  const whereParts = [`c.tenant_id = $${pi}`]; params.push(tid); pi++;
  if (!viewAll) { whereParts.push(`(c.assigned_to = $${pi} OR c.created_by = $${pi})`); params.push(ctx.userId); pi++; }
  whereParts.push(`c.deleted_at IS NULL`);
  if (q) { whereParts.push(`(c.first_name ILIKE $${pi} OR c.last_name ILIKE $${pi} OR c.email ILIKE $${pi})`); params.push(`%${q}%`); pi++; }
  if (status !== 'all') { whereParts.push(`c.lead_status = $${pi}`); params.push(status); pi++; }
  const where = whereParts.join(' AND ');

  const [contactsResult, companies, teamMembers, totalCountResult] = await Promise.all([
    queryMany<any>(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
              c.lead_status, c.lead_source, c.score, c.tags,
              c.city, c.country, c.created_at, c.last_activity_at,
              c.assigned_to, c.do_not_contact, c.lifecycle_stage,
              co.name AS company_name,
              u.full_name AS assigned_name
       FROM public.contacts c
       LEFT JOIN public.companies co ON co.id = c.company_id
       LEFT JOIN public.users u ON u.id = c.assigned_to
       WHERE ${where}
       ORDER BY c.created_at DESC
       LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    ),
    queryMany<any>(
      'SELECT id, name FROM public.companies WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name',
      [tid]
    ),
    queryMany<any>(
      `SELECT tm.user_id, u.full_name, u.avatar_url
       FROM public.tenant_members tm
       JOIN public.users u ON u.id = tm.user_id
       WHERE tm.tenant_id = $1 AND tm.status = 'active'`,
      [tid]
    ),
    queryOne<{ count: string }>(
      `SELECT count(*)::text as count FROM public.contacts c
       WHERE ${where}`,
      params
    ),
  ]);

  const totalCount = parseInt(totalCountResult?.count ?? '0');

  return (
    <div className="space-y-6">
      <Suspense fallback={<LoadingSkeleton />}>
        <ContactsClient
          initialContacts={contactsResult}
          companies={companies}
          teamMembers={teamMembers}
          permissions={permissions}
          totalCount={totalCount}
          tenantId={tid}
          userId={ctx.userId}
          initialOffset={offset}
          initialQ={q}
          initialStatus={status}
        />
      </Suspense>
    </div>
  );
}
