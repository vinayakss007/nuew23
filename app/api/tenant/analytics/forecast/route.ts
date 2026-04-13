import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * GET /api/tenant/analytics/forecast
 * Get deal forecasts and revenue projections
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const [forecasts, summary] = await Promise.all([
      queryMany(
        `SELECT * FROM public.deals_by_win_probability WHERE tenant_id = $1 LIMIT 100`,
        [ctx.tenantId]
      ),
      queryOne(
        `SELECT * FROM public.revenue_forecast_summary WHERE tenant_id = $1`,
        [ctx.tenantId]
      ),
    ]);

    return NextResponse.json({
      data: forecasts,
      summary: summary || {},
    });
  } catch (error: any) {
    console.error('[Forecast Analytics] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/analytics/forecast/calculate
 * Calculate win probability for a deal
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'deals.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { deal_id } = body;

    if (!deal_id) {
      return NextResponse.json({ error: 'deal_id is required' }, { status: 400 });
    }

    const { rows: [result] } = await query(
      `SELECT public.calculate_deal_win_probability($1) as probability`,
      [deal_id]
    );

    const forecast = await queryOne(
      `SELECT id, deal_id, forecast_value, probability, created_at FROM public.deal_forecasts WHERE deal_id = $1`,
      [deal_id]
    );

    return NextResponse.json({
      ok: true,
      probability: result?.probability || 0,
      forecast,
    });
  } catch (error: any) {
    console.error('[Forecast Calculate] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
