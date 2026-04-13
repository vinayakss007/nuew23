import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * POST /api/tenant/contacts/[id]/lifecycle
 * Update contact lifecycle stage
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
    const { lifecycle_stage, reason } = body;

    const validStages = [
      'subscriber',
      'lead',
      'marketing_qualified',
      'sales_qualified',
      'opportunity',
      'customer',
      'evangelist',
      'churned',
    ];

    if (!lifecycle_stage || !validStages.includes(lifecycle_stage)) {
      return NextResponse.json({ 
        error: `Invalid stage. Must be one of: ${validStages.join(', ')}` 
      }, { status: 400 });
    }

    // Verify contact exists
    const contact = await query(
      'SELECT id, lifecycle_stage FROM public.contacts WHERE id = $1 AND tenant_id = $2',
      [(await params).id, ctx.tenantId]
    );

    if (contact.rows.length === 0) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }

    const oldStage = contact.rows[0]?.lifecycle_stage;

    // Update lifecycle stage using helper function
    await query(
      `SELECT public.update_contact_lifecycle($1, $2, $3, $4)`,
      [(await params).id, lifecycle_stage, ctx.userId, reason || null]
    );

    return NextResponse.json({
      ok: true,
      data: {
        contact_id: (await params).id,
        from_stage: oldStage,
        to_stage: lifecycle_stage,
      },
      message: `Lifecycle updated from "${oldStage}" to "${lifecycle_stage}"`,
    });
  } catch (error: any) {
    console.error('[Lifecycle] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/tenant/contacts/[id]/lifecycle
 * Get contact lifecycle history
 */
export async function GET(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const history = await query(
      `SELECT 
        clh.*,
        u.full_name as changed_by_name,
        u.email as changed_by_email
       FROM public.contact_lifecycle_history clh
       LEFT JOIN public.users u ON u.id = clh.changed_by
       WHERE clh.contact_id = $1 AND clh.tenant_id = $2
       ORDER BY clh.changed_at DESC
       LIMIT 50`,
      [(await params).id, ctx.tenantId]
    );

    return NextResponse.json({
      data: history.rows,
    });
  } catch (error: any) {
    console.error('[Lifecycle] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
