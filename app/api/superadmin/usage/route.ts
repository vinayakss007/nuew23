import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    await query('SELECT public.snapshot_tenant_usage()').catch(()=>{});
    const [tenantUsage, growth] = await Promise.all([
      queryMany(`SELECT t.id,t.name,t.plan_id,t.status,t.current_contacts,t.current_users,t.current_deals,
                        p.max_contacts,p.max_users,p.max_deals,p.price_monthly,
                        CASE WHEN p.max_contacts>0 THEN round((t.current_contacts::numeric/p.max_contacts*100))::int ELSE 0 END as contact_pct,
                        CASE WHEN p.max_users>0 THEN round((t.current_users::numeric/p.max_users*100))::int ELSE 0 END as user_pct
                 FROM public.tenants t JOIN public.plans p ON p.id=t.plan_id
                 WHERE t.status IN ('active','trialing') ORDER BY t.current_contacts DESC LIMIT 100`),
      queryMany(`SELECT snapshot_date::text,sum(contacts_count)::int as contacts,sum(deals_count)::int as deals,sum(users_count)::int as users
                 FROM public.usage_snapshots WHERE snapshot_date>current_date-30 GROUP BY 1 ORDER BY 1`).catch(()=>[]),
    ]);
    return NextResponse.json({ tenantUsage, growth });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
