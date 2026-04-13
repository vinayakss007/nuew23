import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query, queryMany, queryOne } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * POST /api/tenant/contacts/merge
 * Merge duplicate contacts
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const {
      primary_contact_id,
      duplicate_contact_id,
      merge_strategy = {},
      reason,
    } = body;

    // Validate required fields
    if (!primary_contact_id || !duplicate_contact_id) {
      return NextResponse.json({ 
        error: 'primary_contact_id and duplicate_contact_id are required' 
      }, { status: 400 });
    }

    if (primary_contact_id === duplicate_contact_id) {
      return NextResponse.json({ 
        error: 'Cannot merge contact with itself' 
      }, { status: 400 });
    }

    // Verify contacts exist and get their data
    const [primary, duplicate] = await Promise.all([
      queryOne<any>(
        'SELECT id, first_name, last_name, email, phone FROM public.contacts WHERE id = $1 AND tenant_id = $2',
        [primary_contact_id, ctx.tenantId]
      ),
      queryOne<any>(
        'SELECT id, first_name, last_name, email, phone FROM public.contacts WHERE id = $1 AND tenant_id = $2',
        [duplicate_contact_id, ctx.tenantId]
      ),
    ]);

    if (!primary || !duplicate) {
      return NextResponse.json({ error: 'One or both contacts not found' }, { status: 404 });
    }

    // Perform merge using database function
    await query(
      `SELECT public.merge_contacts($1, $2, $3, $4, $5, $6)`,
      [
        ctx.tenantId,
        primary_contact_id,
        duplicate_contact_id,
        ctx.userId,
        JSON.stringify(merge_strategy),
        reason || null,
      ]
    );

    // Get updated primary contact
    const updatedPrimary = await queryOne<any>(
      'SELECT id, tenant_id, first_name, last_name, email, phone, company_name, title, tags, lead_status, score, lifecycle_stage, lead_source, custom_fields, created_at, updated_at FROM public.contacts WHERE id = $1',
      [primary_contact_id]
    );

    return NextResponse.json({
      ok: true,
      message: 'Contacts merged successfully',
      data: {
        primary_contact: updatedPrimary,
        merged_contact_id: duplicate_contact_id,
        merge_strategy,
      },
    });
  } catch (error: any) {
    console.error('[Merge] POST error:', error);
    
    // Handle specific database errors
    if (error.message?.includes('not found')) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/tenant/contacts/merge/history
 * Get merge history
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const rows = await queryMany<any>(
      `SELECT id, contact_id, duplicate_id, merged_by, created_at FROM public.merge_history_summary
       WHERE tenant_id = $1
       ORDER BY merged_at DESC
       LIMIT $2 OFFSET $3`,
      [ctx.tenantId, limit, offset]
    );

    // Get total count
    const countResult = await queryOne<{ count: string }>(
      `SELECT count(*)::text as count 
       FROM public.contact_merge_history 
       WHERE tenant_id = $1`,
      [ctx.tenantId]
    );

    return NextResponse.json({
      data: rows,
      total: parseInt(countResult?.count ?? '0', 10),
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('[Merge History] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
