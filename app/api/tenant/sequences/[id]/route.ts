import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query, queryMany, queryOne } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * GET /api/tenant/sequences/[id]
 * Get sequence details with steps
 */
export async function GET(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.view')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const sequence = await queryOne(
      `SELECT id, tenant_id, name, description, active, created_at, updated_at FROM public.sequences WHERE id = $1 AND tenant_id = $2`,
      [(await params).id, ctx.tenantId]
    );

    if (!sequence) {
      return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
    }

    const steps = await queryMany(
      `SELECT id, sequence_id, step_number, type, subject, body, delay_hours, created_at FROM public.sequence_steps WHERE sequence_id = $1 ORDER BY step_number`,
      [(await params).id]
    );

    return NextResponse.json({
      data: {
        ...sequence,
        steps,
      },
    });
  } catch (error: any) {
    console.error('[Sequence] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/tenant/sequences/[id]
 * Update sequence
 */
export async function PATCH(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { name, description, status, steps } = body;

    // Update sequence
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
    if (status !== undefined) {
      updateFields.push(`status = $${paramIndex++}`);
      updateValues.push(status);
    }

    if (updateFields.length > 0) {
      updateValues.push((await params).id, ctx.tenantId);
      await query(
        `UPDATE public.sequences SET ${updateFields.join(', ')}, updated_at = now()
         WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex}`,
        updateValues
      );
    }

    // Update steps if provided
    if (steps !== undefined) {
      const sequenceId = (await params).id;
      // Delete existing steps
      await query('DELETE FROM public.sequence_steps WHERE sequence_id = $1', [sequenceId]);

      // Insert new steps
      if (steps.length > 0) {
        const stepValues = steps.map((step: any, index: number) => [
          sequenceId,
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
    }

    return NextResponse.json({
      ok: true,
      message: 'Sequence updated',
    });
  } catch (error: any) {
    console.error('[Sequence] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/tenant/sequences/[id]
 * Delete sequence
 */
export async function DELETE(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    await query('DELETE FROM public.sequences WHERE id = $1 AND tenant_id = $2', [(await params).id, ctx.tenantId]);

    return NextResponse.json({
      ok: true,
      message: 'Sequence deleted',
    });
  } catch (error: any) {
    console.error('[Sequence] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/sequences/[id]/enroll
 * Enroll contacts in sequence
 */
export async function POST(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'automations.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { contact_ids } = body;

    if (!Array.isArray(contact_ids) || contact_ids.length === 0) {
      return NextResponse.json({ error: 'contact_ids array is required' }, { status: 400 });
    }

    // Verify sequence exists and is active
    const sequence = await queryOne(
      'SELECT id, status FROM public.sequences WHERE id = $1 AND tenant_id = $2',
      [(await params).id, ctx.tenantId]
    );

    if (!sequence) {
      return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
    }

    if (sequence.status !== 'active') {
      return NextResponse.json({ error: 'Sequence must be active to enroll contacts' }, { status: 400 });
    }

    // Enroll each contact
    const enrollments = [];
    for (const contactId of contact_ids) {
      try {
        const { rows: [enrollment] } = await query(
          `SELECT public.enroll_contact_in_sequence($1, $2, $3, $4) as enrollment_id`,
          [ctx.tenantId, (await params).id, contactId, ctx.userId]
        );
        enrollments.push({ contact_id: contactId, enrollment_id: enrollment?.enrollment_id });
      } catch (error: any) {
        // Skip if already enrolled
        console.error(`Failed to enroll contact ${contactId}:`, error.message);
      }
    }

    return NextResponse.json({
      ok: true,
      enrolled: enrollments.filter(e => e.enrollment_id),
      skipped: enrollments.filter(e => !e.enrollment_id).length,
    });
  } catch (error: any) {
    console.error('[Enroll] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
