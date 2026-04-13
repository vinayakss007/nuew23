import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query, queryMany, queryOne } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * GET /api/tenant/workflows/[id]
 * Get workflow details with actions
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

    const workflow = await queryOne(
      `SELECT id, tenant_id, name, description, trigger_type, config, enabled, created_at, updated_at FROM public.workflows WHERE id = $1 AND tenant_id = $2`,
      [(await params).id, ctx.tenantId]
    );

    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const actions = await queryMany(
      `SELECT id, workflow_id, action_type, config, action_order, created_at FROM public.workflow_actions WHERE workflow_id = $1 ORDER BY action_order`,
      [(await params).id]
    );

    const executions = await queryMany(
      `SELECT id, workflow_id, status, started_at, completed_at, error_message FROM public.recent_workflow_executions WHERE workflow_id = $1 LIMIT 10`,
      [(await params).id]
    );

    return NextResponse.json({
      data: {
        ...workflow,
        actions,
        recentExecutions: executions,
      },
    });
  } catch (error: any) {
    console.error('[Workflow] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH /api/tenant/workflows/[id]
 * Update workflow
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
    const {
      name,
      description,
      status,
      trigger_config,
      nodes,
      actions,
    } = body;

    // Update workflow
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
    if (trigger_config !== undefined) {
      updateFields.push(`trigger_config = $${paramIndex++}`);
      updateValues.push(JSON.stringify(trigger_config));
    }
    if (nodes !== undefined) {
      updateFields.push(`nodes = $${paramIndex++}`);
      updateValues.push(JSON.stringify(nodes));
    }

    if (updateFields.length > 0) {
      updateValues.push((await params).id, ctx.tenantId);
      await query(
        `UPDATE public.workflows SET ${updateFields.join(', ')}, updated_at = now()
         WHERE id = $${paramIndex++} AND tenant_id = $${paramIndex}`,
        updateValues
      );
    }

    // Update actions if provided
    if (actions !== undefined) {
      const workflowId = (await params).id;
      // Delete existing actions
      await query('DELETE FROM public.workflow_actions WHERE workflow_id = $1', [workflowId]);

      // Insert new actions
      if (actions.length > 0) {
        const actionValues = actions.map((action: any, index: number) => [
          workflowId,
          index + 1,
          action.action_type || 'send_email',
          JSON.stringify(action.action_config || {}),
          action.condition_type || 'always',
          JSON.stringify(action.condition_config || {}),
        ]);

        await queryMany(
          `INSERT INTO public.workflow_actions 
           (workflow_id, action_order, action_type, action_config, condition_type, condition_config)
           VALUES ${actionValues.map((_: any, i: number) => 
             `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`
           ).join(', ')}
           RETURNING *`,
          actionValues.flat()
        );
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Workflow updated',
    });
  } catch (error: any) {
    console.error('[Workflow] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/tenant/workflows/[id]
 * Delete workflow
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

    await query('DELETE FROM public.workflows WHERE id = $1 AND tenant_id = $2', [(await params).id, ctx.tenantId]);

    return NextResponse.json({
      ok: true,
      message: 'Workflow deleted',
    });
  } catch (error: any) {
    console.error('[Workflow] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/workflows/[id]/test
 * Test workflow execution
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
    const { trigger_entity_type, trigger_entity_id } = body;

    if (!trigger_entity_type || !trigger_entity_id) {
      return NextResponse.json({ 
        error: 'trigger_entity_type and trigger_entity_id are required' 
      }, { status: 400 });
    }

    // Execute workflow
    const { rows: [result] } = await query(
      `SELECT public.execute_workflow($1, $2, $3) as execution_id`,
      [(await params).id, trigger_entity_type, trigger_entity_id]
    );

    return NextResponse.json({
      ok: true,
      execution_id: result?.execution_id,
      message: 'Workflow test started',
    });
  } catch (error: any) {
    console.error('[Workflow Test] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
