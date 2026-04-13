import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryOne, query, queryMany } from '@/lib/db/client';

export async function GET(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const row = await queryOne(
      `SELECT a.*, u.full_name as created_by_name FROM public.automations a
       LEFT JOIN public.users u ON u.id=a.created_by
       WHERE a.id=$1 AND a.tenant_id=$2`,
      [id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const runs = await queryMany(
      `SELECT id,status,trigger_type,actions_run,duration_ms,error,created_at
       FROM public.automation_runs WHERE automation_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [id]
    );
    return NextResponse.json({ data: { ...row, recent_runs: runs } });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'automations.manage');
    if (deny) return deny;
    const body = await req.json();
    const allowed = ['name','description','is_active','trigger_type','trigger_config','actions','conditions'];
    const fields = Object.keys(body).filter(k => allowed.includes(k) && body[k] !== undefined);
    if (!fields.length) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
    let i = 1;
    const sets = fields.map(k => {
      const jsonFields = ['trigger_config','actions','conditions'];
      return jsonFields.includes(k) ? `"${k}"=$${i++}::jsonb` : `"${k}"=$${i++}`;
    }).join(',');
    const vals = fields.map(k => {
      const jsonFields = ['trigger_config','actions','conditions'];
      return jsonFields.includes(k) ? JSON.stringify(body[k]) : body[k];
    });
    const { id } = await params;
    const { rows: [row] } = await query(
      `UPDATE public.automations SET ${sets},updated_at=now() WHERE id=$${i} AND tenant_id=$${i+1} RETURNING *`,
      [...vals, id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'automations.manage');
    if (deny) return deny;
    const { id } = await params;
    const { rowCount } = await query(
      'DELETE FROM public.automations WHERE id=$1 AND tenant_id=$2',
      [id, ctx.tenantId]
    );
    if (!rowCount) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
