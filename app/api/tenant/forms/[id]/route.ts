import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query, queryMany } from '@/lib/db/client';

export async function GET(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const form = await queryOne(
      'SELECT id, tenant_id, name, description, fields, settings, active, slug, created_at, updated_at FROM public.forms WHERE id=$1 AND tenant_id=$2',
      [(await params).id, ctx.tenantId]
    );
    if (!form) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const submissions = await queryMany(
      `SELECT fs.*, c.first_name, c.last_name, c.email as contact_email
       FROM public.form_submissions fs
       LEFT JOIN public.contacts c ON c.id=fs.contact_id
       WHERE fs.form_id=$1 ORDER BY fs.created_at DESC LIMIT 50`,
      [(await params).id]
    );
    return NextResponse.json({ data: { ...form, submissions } });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const body = await req.json();
    const allowed = ['name','description','fields','settings','is_active'];
    const fields = Object.keys(body).filter(k => allowed.includes(k));
    if (!fields.length) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
    let i = 1;
    const sets = fields.map(k => ['fields','settings'].includes(k) ? `"${k}"=$${i++}::jsonb` : `"${k}"=$${i++}`).join(',');
    const vals = fields.map(k => ['fields','settings'].includes(k) ? JSON.stringify(body[k]) : body[k]);
    const { rows: [row] } = await query(
      `UPDATE public.forms SET ${sets},updated_at=now() WHERE id=$${i} AND tenant_id=$${i+1} RETURNING *`,
      [...vals, (await params).id, ctx.tenantId]
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
    await query('DELETE FROM public.forms WHERE id=$1 AND tenant_id=$2', [(await params).id, ctx.tenantId]);
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
