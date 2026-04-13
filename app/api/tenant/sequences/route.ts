import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * GET /api/tenant/sequences
 * List all sequences
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'all';

    let whereClause = 'WHERE tenant_id = $1';
    let params: any[] = [ctx.tenantId];

    if (status !== 'all') {
      if (status === 'active') {
        whereClause += ` AND active = true`;
      } else if (status === 'inactive') {
        whereClause += ` AND active = false`;
      } else {
        // status text column: 'draft', 'paused', 'archived'
        whereClause += ` AND status = $${params.length + 1}`;
        params.push(status);
      }
    }

    const sequences = await queryMany(
      `SELECT id, tenant_id, name, description, status, active, created_at, updated_at FROM public.sequences ${whereClause} ORDER BY created_at DESC`,
      params
    );

    return NextResponse.json({
      data: sequences,
    });
  } catch (error: any) {
    console.error('[Sequences] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/sequences
 * Create new sequence
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, steps = [] } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Calculate total duration
    const totalDurationDays = steps.reduce((sum: number, step: any) => 
      sum + (step.delay_days || 0) + (step.delay_hours || 0) / 24, 0
    );

    // Create sequence
    const sequenceRows = await queryMany<any>(
      `INSERT INTO public.sequences (tenant_id, name, description, total_steps, total_duration_days, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [ctx.tenantId, name.trim(), description || null, steps.length, Math.ceil(totalDurationDays), ctx.userId]
    );
    const sequence = sequenceRows[0];

    // Create steps
    if (steps.length > 0) {
      const stepValues = steps.map((step: any, index: number) => [
        sequence.id,
        index + 1,
        step.type || 'email',
        step.subject || null,
        step.body || null,
        step.delay_days || 0,
        step.delay_hours || 0,
        step.task_title || null,
        step.task_description || null,
        step.call_script || null,
      ]);

      await queryMany(
        `INSERT INTO public.sequence_steps 
         (sequence_id, step_number, type, subject, body, delay_days, delay_hours, task_title, task_description, call_script)
         VALUES ${stepValues.map((_: any, i: number) => 
           `($${i * 10 + 1}, $${i * 10 + 2}, $${i * 10 + 3}, $${i * 10 + 4}, $${i * 10 + 5}, $${i * 10 + 6}, $${i * 10 + 7}, $${i * 10 + 8}, $${i * 10 + 9}, $${i * 10 + 10})`
         ).join(', ')}
         RETURNING *`,
        stepValues.flat()
      );
    }

    return NextResponse.json({
      ok: true,
      data: sequence,
    }, { status: 201 });
  } catch (error: any) {
    console.error('[Sequences] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
