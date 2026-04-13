import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, queryMany } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [stats, tenantGrowth, planDist, recentErrors, latestHealth] = await Promise.all([
      queryOne<any>('SELECT public.platform_stats() as data'),
      queryMany(`SELECT date_trunc('day',created_at)::date::text as day, count(*)::int as count
                 FROM public.tenants WHERE created_at > now()-interval '30 days' GROUP BY 1 ORDER BY 1`),
      queryMany(`SELECT t.plan_id, p.name, p.price_monthly, count(*)::int as tenant_count
                 FROM public.tenants t JOIN public.plans p ON p.id=t.plan_id
                 WHERE t.status IN ('active','trialing') GROUP BY t.plan_id,p.name,p.price_monthly ORDER BY p.price_monthly DESC`),
      queryMany(`SELECT id,level,code,message,tenant_id,created_at FROM public.error_logs
                 WHERE resolved=false AND level IN ('error','fatal') ORDER BY created_at DESC LIMIT 10`).catch(()=>[]),
      queryMany(`SELECT DISTINCT ON (service) service,status,latency_ms,message,checked_at
                 FROM public.health_checks ORDER BY service,checked_at DESC`).catch(()=>[]),
    ]);

    return NextResponse.json({ stats: (stats as any)?.data ?? {}, tenantGrowth, planDist, recentErrors, latestHealth });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
