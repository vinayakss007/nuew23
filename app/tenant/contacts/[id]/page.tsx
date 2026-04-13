import { requireTenantCtx, can } from '@/lib/tenant/context';
import { queryOne, queryMany } from '@/lib/db/client';
import { notFound } from 'next/navigation';
import ContactDetailClient from '@/components/tenant/contact-detail-client';

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenantCtx();
  const { id: contactId } = await params;

  const [contact, activities, deals, tasks, notes, companies, teamMembers] = await Promise.all([
    queryOne<any>(
      `SELECT c.*,
              co.name AS company_name,
              u.full_name AS assigned_name,
              u2.full_name AS created_by_name
       FROM public.contacts c
       LEFT JOIN public.companies co ON co.id = c.company_id
       LEFT JOIN public.users u ON u.id = c.assigned_to
       LEFT JOIN public.users u2 ON u2.id = c.created_by
       WHERE c.id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL`,
      [contactId, ctx.tenantId]
    ),
    queryMany<any>(
      `SELECT a.*, u.full_name, u.avatar_url
       FROM public.activities a
       LEFT JOIN public.users u ON u.id = a.user_id
       WHERE a.contact_id = $1
       ORDER BY a.created_at DESC LIMIT 100`,
      [contactId]
    ),
    queryMany<any>(
      `SELECT id, title, stage, value, close_date, assigned_to
       FROM public.deals
       WHERE contact_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [contactId]
    ),
    queryMany<any>(
      `SELECT t.*, u.full_name AS assignee_name
       FROM public.tasks t
       LEFT JOIN public.users u ON u.id = t.assigned_to
       WHERE t.contact_id = $1 AND t.deleted_at IS NULL
       ORDER BY t.completed ASC, t.due_date ASC NULLS LAST`,
      [contactId]
    ),
    queryMany<any>(
      `SELECT n.*, u.full_name AS author_name
       FROM public.activities n
       LEFT JOIN public.users u ON u.id = n.user_id
       WHERE n.contact_id = $1 AND n.type = 'note'
       ORDER BY n.created_at DESC LIMIT 50`,
      [contactId]
    ),
    queryMany<any>(
      'SELECT id, name FROM public.companies WHERE tenant_id = $1 AND deleted_at IS NULL ORDER BY name',
      [ctx.tenantId]
    ),
    queryMany<any>(
      `SELECT tm.user_id, u.full_name
       FROM public.tenant_members tm
       JOIN public.users u ON u.id = tm.user_id
       WHERE tm.tenant_id = $1 AND tm.status = 'active'`,
      [ctx.tenantId]
    ),
  ]);

  if (!contact) notFound();

  const permissions = {
    canEdit:   can(ctx, 'contacts.edit'),
    canDelete: can(ctx, 'contacts.delete'),
    canAssign: can(ctx, 'contacts.assign'),
  };

  return (
    <ContactDetailClient
      contact={contact}
      initialActivities={activities}
      deals={deals}
      tasks={tasks}
      companies={companies}
      teamMembers={teamMembers}
      permissions={permissions}
      userId={ctx.userId}
    />
  );
}
