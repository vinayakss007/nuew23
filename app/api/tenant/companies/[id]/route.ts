import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryOne, buildUpdate, query } from '@/lib/db/client';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const row = await queryOne(
      `SELECT c.*, (SELECT count(*)::int FROM public.contacts WHERE company_id=c.id AND deleted_at IS NULL) AS contact_count
       FROM public.companies c WHERE c.id=$1 AND c.tenant_id=$2 AND c.deleted_at IS NULL`,
      [(await params).id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'companies.edit');
    if (deny) return deny;
    const body = await req.json();
    if (body.name !== undefined && !body.name?.trim())
      return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    if (body.name) body.name = body.name.trim().slice(0, 200);
    const { sql, values } = buildUpdate('companies', body, { id: (await params).id, tenant_id: ctx.tenantId });
    const row = await queryOne(sql, values);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'update', resourceType:'company', resourceId: (await params).id });
    return NextResponse.json({ data: row });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'companies.delete');
    if (deny) return deny;
    const { rows:[row] } = await query(
      `UPDATE public.companies SET deleted_at=now(), deleted_by=$1
       WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL RETURNING id`,
      [ctx.userId, (await params).id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'delete', resourceType:'company', resourceId: (await params).id });
    return NextResponse.json({ ok: true, message: 'Moved to trash. Restore within 30 days.' });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
