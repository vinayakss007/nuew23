import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';
import { getAllWorkflows } from '@/lib/automation/workflows';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Get all prebuilt workflows
    const allWorkflows = getAllWorkflows();

    // Get tenant's enabled workflows
    const tenantWorkflows = await queryMany(`
      SELECT workflow_id, enabled, config
      FROM public.automation_workflows
      WHERE tenant_id = $1
    `, [ctx.tenantId]);

    // Merge with prebuilt definitions
    const workflows = allWorkflows.map(workflow => {
      const tenant = tenantWorkflows.find(t => t.workflow_id === workflow.id);
      return {
        ...workflow,
        enabled: tenant?.enabled || false,
        config: tenant?.config || {},
        last_run_at: null,
        run_count: 0
      };
    });

    return NextResponse.json({ data: workflows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { workflow_id, enabled, config } = await request.json();

    // Get workflow definition
    const workflow = getAllWorkflows().find(w => w.id === workflow_id);
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    // Upsert tenant workflow
    await query(`
      INSERT INTO public.automation_workflows (tenant_id, workflow_id, name, description, enabled, config)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (tenant_id, workflow_id) DO UPDATE
      SET enabled = $5, config = $6, updated_at = NOW()
    `, [ctx.tenantId, workflow_id, workflow.name, workflow.description, enabled, JSON.stringify(config || {})]);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
