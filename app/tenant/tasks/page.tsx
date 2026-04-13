import { requireTenantCtx, can } from '@/lib/tenant/context';
import { queryMany } from '@/lib/db/client';
import TasksDataTable from '@/components/tenant/tasks-data-table';

export default async function TasksPage() {
  const ctx = await requireTenantCtx();
  const permissions = {
    canCreate:  can(ctx, 'tasks.create'),
    canEdit:    can(ctx, 'tasks.edit'),
    canDelete:  can(ctx, 'tasks.delete'),
    canViewAll: can(ctx, 'tasks.view_all'),
    canAssign:  can(ctx, 'tasks.assign'),
  };
  const viewAll = permissions.canViewAll;
  const [tasks, contacts, deals, teamMembers] = await Promise.all([
    queryMany<any>(
      `SELECT t.*, c.first_name, c.last_name, d.title AS deal_title, u.full_name AS assignee_name
       FROM public.tasks t
       LEFT JOIN public.contacts c ON c.id=t.contact_id
       LEFT JOIN public.deals d ON d.id=t.deal_id
       LEFT JOIN public.users u ON u.id=t.assigned_to
       WHERE t.tenant_id=$1 ${!viewAll ? 'AND (t.assigned_to=$2 OR t.created_by=$2)' : ''}
       ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC
       LIMIT 50`,
      viewAll ? [ctx.tenantId] : [ctx.tenantId, ctx.userId]
    ),
    queryMany<any>('SELECT id, first_name, last_name FROM public.contacts WHERE tenant_id=$1 ORDER BY first_name', [ctx.tenantId]),
    queryMany<any>('SELECT id, title FROM public.deals WHERE tenant_id=$1 ORDER BY title', [ctx.tenantId]),
    queryMany<any>(
      `SELECT tm.user_id, u.full_name FROM public.tenant_members tm
       JOIN public.users u ON u.id=tm.user_id WHERE tm.tenant_id=$1 AND tm.status='active'`,
      [ctx.tenantId]
    ),
  ]);
  return (
    <TasksDataTable
      initialTasks={tasks} contacts={contacts} deals={deals}
      teamMembers={teamMembers} permissions={permissions}
    />
  );
}
