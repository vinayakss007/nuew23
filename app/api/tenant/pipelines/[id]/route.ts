import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const body = await req.json();
    const updates: string[] = [];
    const vals: any[] = [];
    if (body.name !== undefined) { updates.push(`name=$${vals.length+1}`); vals.push(body.name); }
    if (body.stages !== undefined) { updates.push(`stages=$${vals.length+1}::jsonb`); vals.push(JSON.stringify(body.stages)); }
    if (!updates.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    vals.push((await params).id, ctx.tenantId);
    const { rows:[row] } = await query(
      `UPDATE public.pipelines SET ${updates.join(',')} WHERE id=$${vals.length-1} AND tenant_id=$${vals.length} RETURNING *`,
      vals
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const pipeline = await queryOne<any>(
      'SELECT is_default FROM public.pipelines WHERE id=$1 AND tenant_id=$2',
      [(await params).id, ctx.tenantId]
    );
    if (!pipeline) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (pipeline.is_default) return NextResponse.json({ error: 'Cannot delete the default pipeline' }, { status: 400 });

    await query('DELETE FROM public.pipelines WHERE id=$1 AND tenant_id=$2', [(await params).id, ctx.tenantId]);
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
