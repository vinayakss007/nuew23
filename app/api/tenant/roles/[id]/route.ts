import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';

export async function PATCH(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { name, description, permissions } = await request.json();
    const { rows:[row] } = await query(
      `UPDATE public.roles SET name=$1, description=$2, permissions=$3
       WHERE id=$4 AND tenant_id=$5 RETURNING *`,
      [name, description||null, JSON.stringify(permissions||{}), (await params).id, ctx.tenantId]
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
    // Cannot delete default system roles
    const role = await queryOne<any>('SELECT slug FROM public.roles WHERE id=$1 AND tenant_id=$2', [(await params).id, ctx.tenantId]);
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (['admin','manager','sales','viewer'].includes(role.slug)) return NextResponse.json({ error: 'Cannot delete system roles' }, { status: 400 });
    await query('DELETE FROM public.roles WHERE id=$1 AND tenant_id=$2', [(await params).id, ctx.tenantId]);
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
