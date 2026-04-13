import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    
    // FIX HIGH-08: Replace N+1 correlated subqueries with LEFT JOIN
    const data = await queryMany(
      `SELECT a.*, u.full_name as created_by_name,
              COALESCE(runs.success_count, 0) as success_count,
              COALESCE(runs.fail_count, 0) as fail_count
       FROM public.automations a
       LEFT JOIN public.users u ON u.id=a.created_by
       LEFT JOIN (
         SELECT automation_id,
                count(*) FILTER (WHERE status='success')::int AS success_count,
                count(*) FILTER (WHERE status='failed')::int AS fail_count
         FROM public.automation_runs
         GROUP BY automation_id
       ) runs ON runs.automation_id = a.id
       WHERE a.tenant_id=$1
       ORDER BY a.created_at DESC`,
      [ctx.tenantId]
    );
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'automations.manage');
    if (deny) return deny;
    const { name, description, trigger_type, trigger_config = {}, actions = [], conditions = [], is_active = true } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
    if (!trigger_type) return NextResponse.json({ error: 'trigger_type required' }, { status: 400 });
    if (!Array.isArray(actions) || !actions.length) return NextResponse.json({ error: 'at least one action required' }, { status: 400 });
    const { rows: [row] } = await query(
      `INSERT INTO public.automations (tenant_id,name,description,trigger_type,trigger_config,actions,conditions,is_active,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [ctx.tenantId, name.trim(), description?.trim()??null, trigger_type,
       JSON.stringify(trigger_config), JSON.stringify(actions), JSON.stringify(conditions), is_active, ctx.userId]
    );
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
