import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * GET /api/tenant/reports/[id]
 * Get saved report details
 */
export async function GET(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const report = await queryOne(
      `SELECT r.*, u.full_name as created_by_name
       FROM public.saved_reports r
       LEFT JOIN public.users u ON u.id = r.created_by
       WHERE r.id = $1 AND (r.tenant_id = $2 OR r.is_public = true)`,
      [(await params).id, ctx.tenantId]
    );

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    // Get recent executions
    const executions = await queryMany(
      `SELECT id, tenant_id, name, type, filters, status, created_by, created_at, completed_at FROM public.report_executions 
       WHERE report_id = $1 
       ORDER BY executed_at DESC 
       LIMIT 10`,
      [(await params).id]
    );

    return NextResponse.json({
      data: {
        ...report,
        recentExecutions: executions,
      },
    });
  } catch (error: any) {
    console.error('[Report] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/tenant/reports/[id]
 * Update saved report
 */
export async function PATCH(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.export')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      description,
      config,
      filters,
      is_public,
      is_scheduled,
      schedule_config,
    } = body;

    // Update report
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramIndex++}`);
      updateValues.push(name);
    }
    if (description !== undefined) {
      updateFields.push(`description = $${paramIndex++}`);
      updateValues.push(description);
    }
    if (config !== undefined) {
      updateFields.push(`config = $${paramIndex++}`);
      updateValues.push(JSON.stringify(config));
    }
    if (filters !== undefined) {
      updateFields.push(`filters = $${paramIndex++}`);
      updateValues.push(JSON.stringify(filters));
    }
    if (is_public !== undefined) {
      updateFields.push(`is_public = $${paramIndex++}`);
      updateValues.push(is_public);
    }
    if (is_scheduled !== undefined) {
      updateFields.push(`is_scheduled = $${paramIndex++}`);
      updateValues.push(is_scheduled);
    }
    if (schedule_config !== undefined) {
      updateFields.push(`schedule_config = $${paramIndex++}`);
      updateValues.push(JSON.stringify(schedule_config));
    }

    if (updateFields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updateValues.push((await params).id, ctx.tenantId);
    
    await query(
      `UPDATE public.saved_reports 
       SET ${updateFields.join(', ')}, updated_at = now()
       WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex}`,
      updateValues
    );

    return NextResponse.json({
      ok: true,
      message: 'Report updated',
    });
  } catch (error: any) {
    console.error('[Report] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/tenant/reports/[id]
 * Delete saved report
 */
export async function DELETE(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.export')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    await query(
      'DELETE FROM public.saved_reports WHERE id = $1 AND tenant_id = $2',
      [(await params).id, ctx.tenantId]
    );

    return NextResponse.json({
      ok: true,
      message: 'Report deleted',
    });
  } catch (error: any) {
    console.error('[Report] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/reports/[id]/run
 * Execute saved report
 */
export async function POST(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { filters = {} } = body;

    // Execute report using database function
    const { rows: [result] } = await query(
      `SELECT public.execute_saved_report($1, $2, 'manual', $3) as result`,
      [(await params).id, ctx.userId, JSON.stringify(filters)]
    );

    return NextResponse.json({
      ok: true,
      data: result?.result,
    });
  } catch (error: any) {
    console.error('[Report Run] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// NOTE: Export functionality should be moved to /api/tenant/reports/[id]/export/route.ts
// The following GET function is commented out to fix duplicate export error
/*
export async function GET(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'reports.export')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') || 'csv';
    const filters = searchParams.get('filters');

    // Execute report
    const { rows: [result] } = await query(
      `SELECT public.execute_saved_report($1, $2, 'api', $3) as result`,
      [(await params).id, ctx.userId, filters || '{}']
    );

    if (!result?.result) {
      return NextResponse.json({ error: 'Report execution failed' }, { status: 500 });
    }

    const reportData = result.result;

    // Convert to CSV
    if (format === 'csv') {
      const results = reportData.results || [];
      if (!Array.isArray(results) || results.length === 0) {
        return new NextResponse('No data to export', { status: 200 });
      }

      const headers = Object.keys(results[0]);
      const csv = [
        headers.join(','),
        ...results.map(row =>
          headers.map(header =>
            JSON.stringify(row[header] || '')
          ).join(',')
        )
      ].join('\n');

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${reportData.report_name}_${new Date().toISOString().split('T')[0]}.csv"`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      data: reportData,
    });
  } catch (error: any) {
    console.error('[Report Export] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
*/
