import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const [mrr, events] = await Promise.all([
      queryOne<any>(`SELECT coalesce(sum(p.price_monthly),0) as mrr,
         count(*) FILTER (WHERE t.status='active')::int as paying,
         count(*) FILTER (WHERE t.status='trialing')::int as trialing,
         count(*) FILTER (WHERE t.plan_id='free')::int as free_tier,
         count(*) FILTER (WHERE t.status='cancelled')::int as churned,
         coalesce(sum(p.price_yearly/12),0) as arr_monthly_equiv
         FROM public.tenants t JOIN public.plans p ON p.id=t.plan_id`),
      queryMany(`SELECT be.*,t.name as tenant_name FROM public.billing_events be
                 LEFT JOIN public.tenants t ON t.id=be.tenant_id ORDER BY be.created_at DESC LIMIT 20`).catch(()=>[]),
    ]);
    return NextResponse.json({ mrr, events });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
