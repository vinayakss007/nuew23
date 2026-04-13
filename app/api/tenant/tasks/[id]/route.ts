import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryOne, buildUpdate, query } from '@/lib/db/client';
import { logAudit } from '@/lib/audit';

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const body = await req.json();
    if (body.title !== undefined && !body.title?.trim())
      return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    const { sql, values } = buildUpdate('tasks', body, { id: (await params).id, tenant_id: ctx.tenantId });
    const row = await queryOne(sql, values);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (body.completed === true)
      await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'complete', resourceType:'task', resourceId: (await params).id });
    return NextResponse.json({ data: row });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'tasks.delete');
    if (deny) return deny;
    const { rows:[row] } = await query(
      `UPDATE public.tasks SET deleted_at=now(), deleted_by=$1
       WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL RETURNING id`,
      [ctx.userId, (await params).id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, message: 'Moved to trash. Restore within 30 days.' });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
