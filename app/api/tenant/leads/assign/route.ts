import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { query, queryMany } from '@/lib/db/client';
import { createNotification } from '@/lib/notifications';
import { logAudit } from '@/lib/audit';

// POST: assign one or many contacts to a rep
// { contact_ids: string[], assign_to: string, reason?: string }
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.assign');
    if (deny) return deny;

    const { contact_ids, assign_to, reason } = await request.json();
    if (!contact_ids?.length) return NextResponse.json({ error:'contact_ids required' }, { status:400 });
    if (!assign_to) return NextResponse.json({ error:'assign_to required' }, { status:400 });

    // Validate assignee is a member
    const member = await query(
      `SELECT tm.user_id, u.full_name FROM public.tenant_members tm
       JOIN public.users u ON u.id=tm.user_id
       WHERE tm.tenant_id=$1 AND tm.user_id=$2 AND tm.status='active'`,
      [ctx.tenantId, assign_to]
    );
    if (!member.rows[0]) return NextResponse.json({ error:'Assignee is not an active team member' }, { status:400 });

    // Bulk update
    const { rowCount } = await query(
      `UPDATE public.contacts SET assigned_to=$1, last_assigned_at=now()
       WHERE id=ANY($2::uuid[]) AND tenant_id=$3 AND deleted_at IS NULL`,
      [assign_to, contact_ids, ctx.tenantId]
    );

    // Log assignment history
    for (const cid of contact_ids) {
      await query(
        `INSERT INTO public.lead_assignments (tenant_id,contact_id,assigned_to,assigned_by,reason)
         VALUES ($1,$2,$3,$4,$5)`,
        [ctx.tenantId, cid, assign_to, ctx.userId, reason||null]
      ).catch(()=>{});
    }

    // Notify assignee
    if (assign_to !== ctx.userId) {
      await createNotification({
        userId: assign_to, tenantId: ctx.tenantId, type:'contact_assigned' as any,
        title: `${rowCount} lead${rowCount!==1?'s':''} assigned to you`,
        body: reason||undefined, link:'/tenant/leads', entity_type: 'lead' as any,
      });
    }

    await logAudit({ tenantId:ctx.tenantId, userId:ctx.userId, action:'bulk_assign', resourceType:'contact', newData:{ count:rowCount, assigned_to:assign_to } });
    return NextResponse.json({ ok:true, assigned: rowCount });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}

// DELETE: revoke (unassign) leads — set assigned_to = NULL or reassign to admin
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.assign');
    if (deny) return deny;

    const { contact_ids, reason } = await request.json();
    if (!contact_ids?.length) return NextResponse.json({ error:'contact_ids required' }, { status:400 });

    // Mark previous assignments as ended
    await query(
      `UPDATE public.lead_assignments SET unassigned_at=now()
       WHERE contact_id=ANY($1::uuid[]) AND unassigned_at IS NULL`,
      [contact_ids]
    );

    // Unassign — set to null (unowned)
    const { rowCount } = await query(
      `UPDATE public.contacts SET assigned_to=NULL, last_assigned_at=now()
       WHERE id=ANY($1::uuid[]) AND tenant_id=$2 AND deleted_at IS NULL`,
      [contact_ids, ctx.tenantId]
    );

    await logAudit({ tenantId:ctx.tenantId, userId:ctx.userId, action:'bulk_unassign', resourceType:'contact', newData:{ count:rowCount, reason } });
    return NextResponse.json({ ok:true, unassigned: rowCount });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}
