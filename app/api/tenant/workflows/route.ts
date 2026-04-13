import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * GET /api/tenant/workflows
 * List all workflows
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
      whereClause += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    const workflows = await queryMany(
      `SELECT w.*, 
              (SELECT count(*) FROM public.workflow_execution_logs WHERE workflow_id = w.id AND started_at > now() - interval '30 days') as executions_30d
       FROM public.workflows w
       ${whereClause}
       ORDER BY w.created_at DESC`,
      params
    );

    return NextResponse.json({
      data: workflows,
    });
  } catch (error: any) {
    console.error('[Workflows] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/workflows
 * Create new workflow
 */
export async function POST(request: NextRequest) {
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
      trigger_type,
      trigger_config = {},
      nodes = [],
      actions = [],
    } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    if (!trigger_type) {
      return NextResponse.json({ error: 'trigger_type is required' }, { status: 400 });
    }

    // Create workflow
    const workflowRows = await queryMany<any>(
      `INSERT INTO public.workflows
       (tenant_id, name, description, trigger_type, trigger_config, nodes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [ctx.tenantId, name.trim(), description || null, trigger_type, trigger_config, nodes, ctx.userId]
    );
    const workflow = workflowRows[0];

    // Create actions if provided
    if (actions.length > 0) {
      const actionValues = actions.map((action: any, index: number) => [
        workflow.id,
        index + 1,
        action.action_type,
        JSON.stringify(action.action_config),
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

    return NextResponse.json({
      ok: true,
      data: workflow,
    }, { status: 201 });
  } catch (error: any) {
    console.error('[Workflows] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
