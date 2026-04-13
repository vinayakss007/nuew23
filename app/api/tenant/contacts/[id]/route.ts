import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryOne, buildUpdate, query } from '@/lib/db/client';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    // ✅ FIX: Added missing permission check
    const deny = requirePerm(ctx, 'contacts.view');
    if (deny) return deny;
    
    const row = await queryOne(
      `SELECT c.*, co.name AS company_name, u.full_name AS assigned_name
       FROM public.contacts c
       LEFT JOIN public.companies co ON co.id=c.company_id
       LEFT JOIN public.users u ON u.id=c.assigned_to
       WHERE c.id=$1 AND c.tenant_id=$2 AND c.deleted_at IS NULL`,
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
    const deny = requirePerm(ctx, 'contacts.edit');
    if (deny) return deny;
    const body = await req.json();
    if (body.first_name !== undefined && !body.first_name?.trim())
      return NextResponse.json({ error: 'first_name cannot be empty' }, { status: 400 });
    if (body.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    if (body.notes && body.notes.length > 10000)
      return NextResponse.json({ error: 'Notes too long (max 10,000 chars)' }, { status: 400 });
    if (body.email?.trim()) {
      const dup = await queryOne<any>(
        `SELECT id FROM public.contacts WHERE tenant_id=$1 AND email=lower($2) AND id!=$3 AND deleted_at IS NULL`,
        [ctx.tenantId, body.email.trim(), (await params).id]
      );
      if (dup) return NextResponse.json({ error: 'Another contact with this email already exists', is_duplicate: true, duplicate_id: dup.id }, { status: 409 });
    }
    const { sql, values } = buildUpdate('contacts', body, { id: (await params).id, tenant_id: ctx.tenantId });
    const row = await queryOne(sql, values);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'update', resourceType:'contact', resourceId: (await params).id });
    return NextResponse.json({ data: row });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.delete');
    if (deny) return deny;
    // SOFT DELETE — moves to trash, recoverable for 30 days
    const { rows:[row] } = await query(
      `UPDATE public.contacts
       SET deleted_at=now(), deleted_by=$1, is_archived=true
       WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL
       RETURNING id`,
      [ctx.userId, (await params).id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'delete', resourceType:'contact', resourceId: (await params).id });
    return NextResponse.json({ ok: true, message: 'Moved to trash. Restore within 30 days.' });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
