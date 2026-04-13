import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * GET /api/tenant/analytics/churn
 * Get churn predictions
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const risk_level = searchParams.get('risk_level');

    let whereClause = 'WHERE cp.tenant_id = $1';
    let params: any[] = [ctx.tenantId];

    if (risk_level) {
      params.push(risk_level);
      whereClause += ` AND cp.churn_risk = $${params.length}`;
    }

    const predictions = await queryMany(
      `SELECT cp.*, c.first_name, c.last_name, c.email
       FROM public.churn_predictions cp
       JOIN public.contacts c ON c.id = cp.contact_id
       ${whereClause}
       ORDER BY cp.churn_probability DESC
       LIMIT 100`,
      params
    );

    return NextResponse.json({
      data: predictions,
    });
  } catch (error: any) {
    console.error('[Churn Analytics] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/analytics/churn/calculate
 * Calculate churn risk for a contact
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { contact_id } = body;

    if (!contact_id) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });
    }

    const { rows: [result] } = await query(
      `SELECT public.calculate_churn_risk($1) as probability`,
      [contact_id]
    );

    const prediction = await queryOne(
      `SELECT id, contact_id, churn_probability, risk_factors, created_at FROM public.churn_predictions WHERE contact_id = $1`,
      [contact_id]
    );

    return NextResponse.json({
      ok: true,
      probability: result?.probability || 0,
      prediction,
    });
  } catch (error: any) {
    console.error('[Churn Calculate] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/tenant/analytics/churn/[id]/action
 * Mark churn prediction as actioned
 */
export async function PATCH(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    await query(
      `UPDATE public.churn_predictions 
       SET is_actioned = true, actioned_at = now(), actioned_by = $1
       WHERE id = $2 AND tenant_id = $3`,
      [ctx.userId, (await params).id, ctx.tenantId]
    );

    return NextResponse.json({
      ok: true,
      message: 'Marked as actioned',
    });
  } catch (error: any) {
    console.error('[Churn Action] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
