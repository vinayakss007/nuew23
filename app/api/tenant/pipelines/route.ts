/**
 * Pipelines API — custom deal pipelines with user-defined stages
 * GET    /api/tenant/pipelines         — list all pipelines for tenant
 * POST   /api/tenant/pipelines         — create new pipeline
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const data = await queryMany(
      `SELECT p.*, count(d.id)::int as deal_count
       FROM public.pipelines p
       LEFT JOIN public.deals d ON d.tenant_id=p.tenant_id AND d.deleted_at IS NULL
       WHERE p.tenant_id=$1 GROUP BY p.id ORDER BY p.is_default DESC, p.created_at ASC`,
      [ctx.tenantId]
    );
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const { name, stages } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const defaultStages = [
      { id: 'lead',         label: 'Lead',        order: 0, probability: 10,  color: '#94a3b8' },
      { id: 'qualified',    label: 'Qualified',   order: 1, probability: 30,  color: '#3b82f6' },
      { id: 'proposal',     label: 'Proposal',    order: 2, probability: 60,  color: '#8b5cf6' },
      { id: 'negotiation',  label: 'Negotiation', order: 3, probability: 80,  color: '#f59e0b' },
      { id: 'won',          label: 'Won',         order: 4, probability: 100, color: '#10b981' },
      { id: 'lost',         label: 'Lost',        order: 5, probability: 0,   color: '#ef4444' },
    ];

    const { rows:[pipeline] } = await query(
      `INSERT INTO public.pipelines (tenant_id, name, stages, is_default)
       VALUES ($1, $2, $3, false) RETURNING *`,
      [ctx.tenantId, name.trim(), JSON.stringify(stages ?? defaultStages)]
    );
    return NextResponse.json({ data: pipeline }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
