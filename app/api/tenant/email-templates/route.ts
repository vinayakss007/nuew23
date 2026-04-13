/**
 * GET  /api/tenant/email-templates        — list all templates
 * POST /api/tenant/email-templates        — create a template
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const data = await queryMany(
      `SELECT id, name, subject, body, category, created_at, updated_at
       FROM public.email_templates
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY category ASC, name ASC`,
      [ctx.tenantId]
    );
    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { name, subject, body, category = 'general' } = await request.json();
    if (!name?.trim())    return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (!subject?.trim()) return NextResponse.json({ error: 'subject is required' }, { status: 400 });
    if (!body?.trim())    return NextResponse.json({ error: 'body is required' }, { status: 400 });

    const { rows: [row] } = await query(
      `INSERT INTO public.email_templates (tenant_id, name, subject, body, category, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, subject, body, category, created_at, updated_at`,
      [ctx.tenantId, name.trim(), subject.trim(), body.trim(), category, ctx.userId]
    );
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
