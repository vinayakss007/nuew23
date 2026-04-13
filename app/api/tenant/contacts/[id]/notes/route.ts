import { processMentions } from '@/lib/notifications';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';

export async function GET(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const data = await queryMany(
      `SELECT a.*, u.full_name, u.avatar_url FROM public.activities a
       LEFT JOIN public.users u ON u.id=a.user_id
       WHERE a.contact_id=$1 AND a.tenant_id=$2 ORDER BY a.created_at DESC LIMIT 50`,
      [(await params).id, ctx.tenantId]
    );
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { type='note', description, metadata } = await request.json();
    if (!description?.trim()) return NextResponse.json({ error: 'description required' }, { status: 400 });
    const VALID = ['note','call','email','meeting','task','deal_update'];
    if (!VALID.includes(type)) return NextResponse.json({ error: `type must be one of: ${VALID.join(', ')}` }, { status: 400 });
    const { rows:[row] } = await query(
      `INSERT INTO public.activities (tenant_id,user_id,contact_id,type,description,metadata)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [ctx.tenantId, ctx.userId, (await params).id, type, description.trim(), metadata?JSON.stringify(metadata):null]
    );
    await query('UPDATE public.contacts SET updated_at=now() WHERE id=$1', [(await params).id]);
    await processMentions(description.trim(), ctx.tenantId, ctx.userId, `/tenant/contacts/${(await params).id}`);
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // FIX HIGH-11: Add permission check for deleting notes
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;
    const { noteId } = await request.json();
    // FIX CRITICAL-03: Added tenant_id filter to prevent cross-tenant deletion
    await query('DELETE FROM public.activities WHERE id=$1 AND user_id=$2 AND contact_id=$3 AND tenant_id=$4', 
      [noteId, ctx.userId, (await params).id, ctx.tenantId]);
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
