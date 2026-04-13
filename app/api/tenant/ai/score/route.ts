import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * POST /api/tenant/ai/score
 * Calculate/update contact score
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { contact_id } = body;

    if (!contact_id) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 });
    }

    // Calculate score using database function
    const { rows: [result] } = await query(
      `SELECT public.calculate_contact_score($1) as score`,
      [contact_id]
    );

    // Get updated score details
    const score = await queryOne(
      `SELECT id, contact_id, score, risk_factors, created_at FROM public.contact_scores WHERE contact_id = $1`,
      [contact_id]
    );

    return NextResponse.json({
      ok: true,
      score: result?.score || 0,
      details: score,
    });
  } catch (error: any) {
    console.error('[AI Score] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/tenant/ai/scores
 * Get contact scores (top scored contacts)
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const min_score = parseInt(searchParams.get('min_score') || '0');

    const contacts = await queryMany(
      `SELECT id, contact_id, score, risk_factors, created_at FROM public.top_scored_contacts 
       WHERE overall_score >= $1
       LIMIT $2`,
      [min_score, limit]
    );

    return NextResponse.json({
      data: contacts,
    });
  } catch (error: any) {
    console.error('[AI Scores] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/tenant/ai/scores/[contact_id]
 * Get score for specific contact
 */
export async function GET_SCORE(
  request: NextRequest,
  { params }: { params: { contact_id: string } }
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const score = await queryOne(
      `SELECT cs.*, c.first_name, c.last_name, c.email
       FROM public.contact_scores cs
       JOIN public.contacts c ON c.id = cs.contact_id
       WHERE cs.contact_id = $1 AND c.tenant_id = $2`,
      [params.contact_id, ctx.tenantId]
    );

    if (!score) {
      return NextResponse.json({ error: 'Score not found' }, { status: 404 });
    }

    return NextResponse.json({
      data: score,
    });
  } catch (error: any) {
    console.error('[AI Score] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
