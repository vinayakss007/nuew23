import { requireAuth } from '@/lib/auth/middleware';
import { can } from '@/lib/auth/middleware';
import { queryOne, queryMany, query } from '@/lib/db/client';
import { logAudit } from '@/lib/audit';
import { NextRequest, NextResponse } from 'next/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/tenant/leads/[id] - Get a single lead
export async function GET(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    
    const lead = await queryOne<any>(
      `SELECT 
        l.*,
        u.full_name as assigned_name,
        u.avatar_url as assigned_avatar,
        c.full_name as created_by_name
      FROM public.leads l
      LEFT JOIN public.users u ON u.id = l.assigned_to
      LEFT JOIN public.users c ON c.id = l.created_by
      WHERE l.id = $1 AND l.tenant_id = $2 AND l.deleted_at IS NULL`,
      [id, ctx.tenantId]
    );
    
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }
    
    // Get recent activities
    const activities = await queryMany<any>(
      `SELECT id, tenant_id, lead_id, activity_type, description, performed_by, performed_at FROM public.lead_activities
       WHERE lead_id = $1 AND tenant_id = $2
       ORDER BY performed_at DESC
       LIMIT 50`,
      [id, ctx.tenantId]
    );
    
    return NextResponse.json({
      ...lead,
      activities,
    });
  } catch (error: any) {
    console.error('Error fetching lead:', error);
    return NextResponse.json(
      { error: 'Failed to fetch lead' },
      { status: 500 }
    );
  }
}

// PATCH /api/tenant/leads/[id] - Update a lead
export async function PATCH(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const body = await request.json();
    
    // Check if lead exists
    const existing = await queryOne<any>(
      `SELECT id FROM public.leads WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, ctx.tenantId]
    );
    
    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }
    
    // Build dynamic update query
    const allowedFields = [
      'first_name', 'last_name', 'email', 'phone', 'mobile',
      'title', 'company_name', 'company_size', 'company_industry',
      'lead_source', 'lead_status', 'lifecycle_stage',
      'budget', 'budget_currency', 'authority_level', 'need_description', 'timeline', 'timeline_target_date',
      'country', 'state', 'city', 'address_line1', 'postal_code',
      'linkedin_url', 'twitter_handle', 'website',
      'assigned_to', 'owner_id',
      'tags', 'notes', 'internal_notes', 'custom_fields', 'score',
    ];
    
    const updates: string[] = [];
    const updateParams: any[] = [];
    let paramIndex = 1;
    
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = $${paramIndex}`);
        updateParams.push(body[field]);
        paramIndex++;
      }
    }
    
    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }
    
    updateParams.push(id, ctx.tenantId);
    
    const result = await queryOne<any>(
      `UPDATE public.leads 
       SET ${updates.join(', ')}, updated_at = now()
       WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1} AND deleted_at IS NULL
       RETURNING *`,
      updateParams
    );
    
    // Log activity for status changes
    if (body.lead_status) {
      await query(
        `INSERT INTO public.lead_activities (tenant_id, lead_id, performed_by, activity_type, description, activity_data)
         VALUES ($1, $2, $3, 'status_change', 'Lead status changed to ' || $4, jsonb_build_object('new_status', $4))`,
        [ctx.tenantId, id, ctx.userId, body.lead_status]
      );
    }
    
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error updating lead:', error);
    return NextResponse.json(
      { error: 'Failed to update lead' },
      { status: 500 }
    );
  }
}

// DELETE /api/tenant/leads/[id] - Soft delete a lead
export async function DELETE(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    
    // Check permissions
    if (!can(ctx, 'leads.delete')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // Soft delete — returns the deleted id so we can detect "not found"
    const { rows: [deleted] } = await query(
      `UPDATE public.leads
       SET deleted_at = now(), deleted_by = $1
       WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL
       RETURNING id`,
      [ctx.userId, id, ctx.tenantId]
    );

    if (!deleted) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'delete', resourceType: 'lead', resourceId: id,
    });

    return NextResponse.json({ success: true, message: 'Moved to trash. Restore within 30 days.' });
  } catch (error: any) {
    console.error('Error deleting lead:', error);
    return NextResponse.json(
      { error: 'Failed to delete lead' },
      { status: 500 }
    );
  }
}
