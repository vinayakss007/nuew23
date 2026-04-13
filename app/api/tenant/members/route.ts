import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query, withTransaction } from '@/lib/db/client';
import { createNotification } from '@/lib/notifications';
import { logAudit } from '@/lib/audit';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const [members, invitations] = await Promise.all([
      queryMany(
        `SELECT tm.id, tm.user_id, tm.role_slug, tm.status, tm.joined_at,
                u.full_name, u.email, u.avatar_url, u.email_verified,
                r.name as role_name, r.permissions,
                (SELECT count(*)::int FROM public.contacts WHERE assigned_to=tm.user_id AND tenant_id=tm.tenant_id AND deleted_at IS NULL) as contact_count,
                (SELECT count(*)::int FROM public.deals WHERE assigned_to=tm.user_id AND tenant_id=tm.tenant_id AND deleted_at IS NULL) as deal_count,
                (SELECT count(*)::int FROM public.tasks WHERE assigned_to=tm.user_id AND tenant_id=tm.tenant_id AND deleted_at IS NULL AND completed=false) as task_count
         FROM public.tenant_members tm
         JOIN public.users u ON u.id=tm.user_id
         LEFT JOIN public.roles r ON r.id=tm.role_id
         WHERE tm.tenant_id=$1 AND tm.status='active'
         ORDER BY tm.joined_at ASC NULLS LAST`,
        [ctx.tenantId]
      ),
      queryMany(
        `SELECT id,email,role_slug,expires_at,created_at FROM public.invitations
         WHERE tenant_id=$1 AND accepted_at IS NULL AND expires_at>now() ORDER BY created_at DESC`,
        [ctx.tenantId]
      ),
    ]);
    return NextResponse.json({ data: members, invitations, tenantId: ctx.tenantId });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error:'Admin required' }, { status:403 });

    const { memberId, roleSlug, action, reassignTo, reason } = await request.json();
    if (!memberId || !action) return NextResponse.json({ error:'memberId and action required' }, { status:400 });

    const target = await queryOne<any>(
      `SELECT tm.user_id, tm.role_slug, u.full_name, u.email
       FROM public.tenant_members tm JOIN public.users u ON u.id=tm.user_id
       WHERE tm.id=$1 AND tm.tenant_id=$2`,
      [memberId, ctx.tenantId]
    );
    if (!target) return NextResponse.json({ error:'Member not found' }, { status:404 });
    if (target.role_slug==='admin' && !ctx.isSuperAdmin) return NextResponse.json({ error:'Cannot modify another admin' }, { status:403 });
    if (target.user_id===ctx.userId && action==='remove') return NextResponse.json({ error:'Cannot remove yourself — transfer ownership first' }, { status:400 });

    if (action==='change_role') {
      if (!roleSlug) return NextResponse.json({ error:'roleSlug required' }, { status:400 });
      const role = await queryOne<any>('SELECT id FROM public.roles WHERE tenant_id=$1 AND slug=$2', [ctx.tenantId, roleSlug]);
      await query('UPDATE public.tenant_members SET role_slug=$1, role_id=$2 WHERE id=$3', [roleSlug, role?.id??null, memberId]);
      await logAudit({ tenantId:ctx.tenantId, userId:ctx.userId, action:'role_change', resourceType:'member', resourceId:target.user_id, newData:{role:roleSlug} });

    } else if (action==='remove') {
      // Get their data counts before removal
      const [cCount, dCount, tCount] = await Promise.all([
        queryOne<any>('SELECT count(*)::int as n FROM public.contacts WHERE assigned_to=$1 AND tenant_id=$2 AND deleted_at IS NULL', [target.user_id, ctx.tenantId]),
        queryOne<any>('SELECT count(*)::int as n FROM public.deals WHERE assigned_to=$1 AND tenant_id=$2 AND deleted_at IS NULL', [target.user_id, ctx.tenantId]),
        queryOne<any>('SELECT count(*)::int as n FROM public.tasks WHERE assigned_to=$1 AND tenant_id=$2 AND deleted_at IS NULL AND completed=false', [target.user_id, ctx.tenantId]),
      ]);

      await withTransaction(async (client) => {
        // Reassign all their data to admin/manager or specified user
        const reassignUserId = reassignTo || ctx.userId;

        await client.query(
          'UPDATE public.contacts SET assigned_to=$1, last_assigned_at=now() WHERE assigned_to=$2 AND tenant_id=$3 AND deleted_at IS NULL',
          [reassignUserId, target.user_id, ctx.tenantId]
        );
        await client.query(
          'UPDATE public.deals SET assigned_to=$1 WHERE assigned_to=$2 AND tenant_id=$3 AND deleted_at IS NULL',
          [reassignUserId, target.user_id, ctx.tenantId]
        );
        await client.query(
          'UPDATE public.tasks SET assigned_to=$1 WHERE assigned_to=$2 AND tenant_id=$3 AND deleted_at IS NULL',
          [reassignUserId, target.user_id, ctx.tenantId]
        );

        // IMPORTANT: Cannot remove admin role — must transfer to another member first
        // The user can still log in — they just won't have access to this workspace.
        await client.query("UPDATE public.tenant_members SET status='removed' WHERE id=$1", [memberId]);

        // Log departure
        await client.query(
          `INSERT INTO public.user_departures
             (tenant_id,user_id,user_email,user_name,departed_by,reason,
              contacts_reassigned_to,contacts_count,deals_count,tasks_count,data_retained)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)`,
          [ctx.tenantId, target.user_id, target.email, target.full_name,
           ctx.userId, reason||null, reassignUserId,
           cCount?.n||0, dCount?.n||0, tCount?.n||0]
        );

        // Update user count
        await client.query(
          `UPDATE public.tenants SET current_users=(SELECT count(*)::int FROM public.tenant_members WHERE tenant_id=$1 AND status='active') WHERE id=$1`,
          [ctx.tenantId]
        );
      });

      // Notify the admin who will receive the data
      if (reassignTo && reassignTo !== ctx.userId) {
        await createNotification({
          userId: reassignTo, tenantId: ctx.tenantId, type:'system',
          title:`${cCount?.n||0} contacts and ${dCount?.n||0} deals reassigned to you`,
          body:`From ${target.full_name||target.email} who left the workspace`,
          link:'/tenant/contacts',
        });
      }
      await logAudit({ tenantId:ctx.tenantId, userId:ctx.userId, action:'member_removed', resourceType:'member', resourceId:target.user_id, newData:{reassigned_to:reassignTo, contacts:cCount?.n, deals:dCount?.n} });

    } else if (action==='suspend') {
      await query("UPDATE public.tenant_members SET status='suspended' WHERE id=$1", [memberId]);
    } else if (action==='reactivate') {
      await query("UPDATE public.tenant_members SET status='active' WHERE id=$1", [memberId]);
    } else if (action==='assign_lead') {
      // Admin/Lead Manager assigning a contact to a rep
      const { contactId } = await request.json().catch(()=>({}));
      if (contactId) {
        await query('UPDATE public.contacts SET assigned_to=$1, last_assigned_at=now() WHERE id=$2 AND tenant_id=$3', [target.user_id, contactId, ctx.tenantId]);
        await query(`INSERT INTO public.lead_assignments (tenant_id,contact_id,assigned_to,assigned_by) VALUES ($1,$2,$3,$4)`, [ctx.tenantId, contactId, target.user_id, ctx.userId]);
      }
    } else {
      return NextResponse.json({ error:`Unknown action: ${action}` }, { status:400 });
    }

    return NextResponse.json({ ok:true });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}
