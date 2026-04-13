/**
 * GET    /api/tenant/email-templates/[id]  — get one template
 * PATCH  /api/tenant/email-templates/[id]  — update a template
 * DELETE /api/tenant/email-templates/[id]  — soft-delete a template
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';

export async function GET(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const row = await queryOne(
      `SELECT id, name, subject, body, category, created_at, updated_at
       FROM public.email_templates WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const { name, subject, body, category } = await request.json();

    const fields: string[] = [];
    const vals: any[] = [];
    if (name    !== undefined) { fields.push(`name = $${vals.push(name.trim())}`); }
    if (subject !== undefined) { fields.push(`subject = $${vals.push(subject.trim())}`); }
    if (body    !== undefined) { fields.push(`body = $${vals.push(body.trim())}`); }
    if (category!== undefined) { fields.push(`category = $${vals.push(category)}`); }
    if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    fields.push(`updated_at = now()`);
    vals.push(id, ctx.tenantId);

    const { rows: [row] } = await query(
      `UPDATE public.email_templates SET ${fields.join(', ')}
       WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length} AND deleted_at IS NULL
       RETURNING id, name, subject, body, category, updated_at`,
      vals
    );
    if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const { rows: [row] } = await query(
      `UPDATE public.email_templates SET deleted_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL RETURNING id`,
      [id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
