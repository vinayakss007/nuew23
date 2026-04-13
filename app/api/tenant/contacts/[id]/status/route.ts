import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';

const STATUSES = ['new','contacted','qualified','unqualified','converted','lost'];

export async function PATCH(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;
    const { lead_status, reason } = await request.json();
    if (!STATUSES.includes(lead_status)) return NextResponse.json({ error: `lead_status must be: ${STATUSES.join(', ')}` }, { status: 400 });
    const prev = await queryOne<any>('SELECT lead_status FROM public.contacts WHERE id=$1 AND tenant_id=$2', [(await params).id, ctx.tenantId]);
    if (!prev) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const { rows:[contact] } = await query(
      'UPDATE public.contacts SET lead_status=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [lead_status, (await params).id, ctx.tenantId]
    );
    const desc = `Status: ${prev.lead_status} → ${lead_status}${reason?` — ${reason}`:''}`;
    await query(
      `INSERT INTO public.activities (tenant_id,user_id,contact_id,type,description,metadata)
       VALUES ($1,$2,$3,'note',$4,$5)`,
      [ctx.tenantId, ctx.userId, (await params).id, desc, JSON.stringify({ status_change:true, from:prev.lead_status, to:lead_status, reason })]
    );
    return NextResponse.json({ data: contact });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
