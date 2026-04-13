import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';
import { BUILTIN_MODULES } from '@/lib/modules/registry';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Stats per module
    const stats = await queryMany(
      `SELECT module_id,
              count(*)::int as total_installs,
              count(*) FILTER (WHERE status='active')::int as active_installs
       FROM public.tenant_modules GROUP BY module_id`
    );
    const statsMap = Object.fromEntries(stats.map(s => [s.module_id, s]));

    const data = BUILTIN_MODULES.map(m => ({
      ...m,
      total_installs: statsMap[m.id]?.total_installs ?? 0,
      active_installs: statsMap[m.id]?.active_installs ?? 0,
    }));

    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { module_id, is_available } = await req.json();
    await query(
      `UPDATE public.modules SET is_available=$1, updated_at=now() WHERE id=$2`,
      [is_available, module_id]
    );
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
