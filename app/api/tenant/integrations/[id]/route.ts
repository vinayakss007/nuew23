import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query } from '@/lib/db/client';

export async function PATCH(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { is_active } = await request.json();
    const { rows:[row] } = await query(
      'UPDATE public.integrations SET is_active=$1 WHERE id=$2 AND tenant_id=$3 RETURNING id,is_active',
      [is_active, (await params).id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { rowCount } = await query(
      'DELETE FROM public.integrations WHERE id=$1 AND tenant_id=$2',
      [(await params).id, ctx.tenantId]
    );
    if (!rowCount) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
