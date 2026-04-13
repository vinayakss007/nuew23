import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * GET /api/tenant/contacts/[id]/timeline
 * Get contact timeline (activity feed)
 */
export async function GET(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all') && !can(ctx, 'contacts.create')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const eventType = searchParams.get('event_type');

    // Build query
    let whereClause = 'WHERE a.contact_id = $1 AND a.tenant_id = $2';
    let whereParams: any[] = [(await params).id, ctx.tenantId];
    
    if (eventType) {
      whereClause += ' AND a.event_type = $' + (whereParams.length + 1);
      whereParams.push(eventType);
    }

    const activities = await queryMany<{
      id: string;
      event_type: string;
      description: string;
      metadata: any;
      created_at: string;
      user_name: string | null;
      user_email: string | null;
      user_avatar: string | null;
    }>(
      `SELECT 
        a.id,
        a.event_type,
        a.description,
        a.metadata,
        a.created_at,
        u.full_name as user_name,
        u.email as user_email,
        u.avatar_url as user_avatar
       FROM public.activities a
       LEFT JOIN public.users u ON u.id = a.user_id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`,
      [...whereParams, limit, offset]
    );

    // Get total count
    const countResult = await queryOne<{ count: string }>(
      `SELECT count(*)::text as count 
       FROM public.activities a
       ${whereClause}`,
      whereParams
    );

    return NextResponse.json({
      data: activities,
      total: parseInt(countResult?.count ?? '0', 10),
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[Timeline] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/contacts/[id]/timeline
 * Add activity to contact timeline
 */
export async function POST(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { event_type, description, metadata } = body;

    if (!event_type) {
      return NextResponse.json({ error: 'event_type is required' }, { status: 400 });
    }

    // Verify contact exists and belongs to tenant
    const contact = await queryOne<{ id: string }>(
      'SELECT id FROM public.contacts WHERE id = $1 AND tenant_id = $2',
      [(await params).id, ctx.tenantId]
    );

    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    // Create activity
    const activityRows = await queryMany<any>(
      `INSERT INTO public.activities (
        tenant_id,
        user_id,
        contact_id,
        event_type,
        description,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [ctx.tenantId, ctx.userId, (await params).id, event_type, description, metadata || {}]
    );
    const activity = activityRows[0];

    return NextResponse.json({
      ok: true,
      data: activity,
    }, { status: 201 });
  } catch (error: any) {
    console.error('[Timeline] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
