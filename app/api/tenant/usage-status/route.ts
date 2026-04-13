import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const row = await queryOne<any>(
      `SELECT t.status AS workspace_status,
              t.current_contacts, t.current_users, t.current_deals,
              t.trial_ends_at,
              CASE WHEN t.trial_ends_at IS NOT NULL
                   THEN GREATEST(0, EXTRACT(day FROM t.trial_ends_at - now())::int)
                   ELSE NULL
              END AS trial_days_left,
              p.max_contacts, p.max_users, p.max_deals,
              p.name AS plan_name, p.id AS plan_id
       FROM public.tenants t
       JOIN public.plans p ON p.id = t.plan_id
       WHERE t.id = $1`,
      [ctx.tenantId]
    );
    return NextResponse.json({ data: row });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
