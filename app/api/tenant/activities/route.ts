import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get('contact_id');
    const dealId = searchParams.get('deal_id');
    const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '20'));

    const conditions: string[] = ['a.tenant_id = $1'];
    const params: any[] = [ctx.tenantId];

    if (contactId) {
      params.push(contactId);
      conditions.push(`a.contact_id = $${params.length}`);
    }
    if (dealId) {
      params.push(dealId);
      conditions.push(`a.deal_id = $${params.length}`);
    }
    params.push(limit);

    const data = await queryMany(
      `SELECT a.*, u.full_name
       FROM public.activities a
       LEFT JOIN public.users u ON u.id = a.user_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY a.created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return NextResponse.json({ data });
  } catch (err: any) {
    console.error('[activities GET]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    if (!body.type || !body.description) {
      return NextResponse.json({ error: 'type and description are required' }, { status: 400 });
    }

    const VALID_TYPES = ['note', 'call', 'email', 'meeting', 'task', 'deal_update', 'contact_created'];
    if (!VALID_TYPES.includes(body.type)) {
      return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }

    const { rows: [row] } = await query(
      `INSERT INTO public.activities
         (tenant_id, user_id, contact_id, deal_id, type, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        ctx.tenantId, ctx.userId,
        body.contact_id || null, body.deal_id || null,
        body.type, body.description,
        body.metadata ? JSON.stringify(body.metadata) : null,
      ]
    );
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    console.error('[activities POST]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
