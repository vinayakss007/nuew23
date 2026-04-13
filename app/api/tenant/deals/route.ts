import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { queryMany, queryOne, buildInsert, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { searchParams } = new URL(request.url);
    const stage = searchParams.get('stage');
    const limit = Math.min(500, parseInt(searchParams.get('limit') ?? '200'));
    const offset = parseInt(searchParams.get('offset') ?? '0');
    const params: any[] = [ctx.tenantId];
    let where = 'd.tenant_id = $1 AND d.deleted_at IS NULL';
    if (!can(ctx, 'deals.view_all')) {
      params.push(ctx.userId);
      where += ` AND (d.assigned_to = $${params.length} OR d.created_by = $${params.length})`;
    }
    if (stage) { params.push(stage); where += ` AND d.stage = $${params.length}`; }
    const pipelineId = searchParams.get('pipeline_id');
    if (pipelineId) { params.push(pipelineId); where += ` AND d.pipeline_id = $${params.length}`; }
    const qDeal = searchParams.get('q')?.trim();
    if (qDeal) { params.push(`%${qDeal}%`); where += ` AND d.title ILIKE $${params.length}`; }
    const countRes = await query(`SELECT count(*)::int FROM public.deals d WHERE ${where}`, params);
    params.push(limit, offset);
    const data = await queryMany(
      `SELECT d.*, c.first_name, c.last_name, co.name AS company_name, u.full_name AS assigned_name
       FROM public.deals d
       LEFT JOIN public.contacts c ON c.id = d.contact_id
       LEFT JOIN public.companies co ON co.id = d.company_id
       LEFT JOIN public.users u ON u.id = d.assigned_to
       WHERE ${where} ORDER BY d.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`,
      params
    );
    return NextResponse.json({ data, total: parseInt(countRes.rows[0]?.count ?? '0', 10) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'deals.create');
    if (deny) return deny;
    const body = await request.json();

    // Input validation
    if (!body.title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });
    if (body.title.trim().length > 200) return NextResponse.json({ error: 'title is too long (max 200 chars)' }, { status: 400 });

    // Validate value is a positive number
    if (body.value !== undefined && body.value !== null) {
      const value = typeof body.value === 'number' ? body.value : parseFloat(body.value);
      if (isNaN(value) || value < 0) return NextResponse.json({ error: 'value must be a positive number' }, { status: 400 });
    }

    // Validate probability range
    if (body.probability !== undefined && body.probability !== null) {
      const prob = typeof body.probability === 'number' ? body.probability : parseInt(body.probability);
      if (isNaN(prob) || prob < 0 || prob > 100) return NextResponse.json({ error: 'probability must be between 0 and 100' }, { status: 400 });
    }

    // Validate notes length
    if (body.notes && body.notes.length > 5000) {
      return NextResponse.json({ error: 'notes too long (max 5,000 chars)' }, { status: 400 });
    }

    // Validate close_date format
    if (body.close_date) {
      const date = new Date(body.close_date);
      if (isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid close_date format' }, { status: 400 });
    }

    // MISSING-002: Enforce plan deal limit
    const dealLimit = await queryOne<any>(
      `SELECT t.current_deals, p.max_deals
       FROM public.tenants t JOIN public.plans p ON p.id = t.plan_id
       WHERE t.id = $1`,
      [ctx.tenantId]
    );
    if (dealLimit?.max_deals > 0 && (dealLimit.current_deals ?? 0) >= dealLimit.max_deals) {
      return NextResponse.json({
        error: `Deal limit reached (${dealLimit.max_deals}). Upgrade your plan to create more deals.`,
      }, { status: 403 });
    }

    const { sql, values } = buildInsert('deals', {
      title: body.title.trim(),
      value: typeof body.value === 'number' ? body.value : (parseFloat(body.value) || 0),
      stage: body.stage ?? 'lead',
      probability: typeof body.probability === 'number' ? body.probability : (parseInt(body.probability) || 10),
      close_date: body.close_date || null,
      contact_id: body.contact_id || null,
      company_id: body.company_id || null,
      assigned_to: body.assigned_to || ctx.userId,
      notes: body.notes || null,
      custom_fields: body.custom_fields ?? {},
      tenant_id: ctx.tenantId,
      created_by: ctx.userId,
    });
    const deal = await queryOne(sql, values);
    return NextResponse.json({ data: deal }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
