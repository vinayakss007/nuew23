import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, dbCache } from '@/lib/db/client';

// Public read-only plans endpoint for tenant billing page
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const data = await dbCache('plans:all', 10*60*1000, () => queryMany('SELECT id,name,price_monthly,price_yearly,max_users,max_contacts,max_deals,max_automations,features,sort_order FROM public.plans WHERE is_active=true ORDER BY sort_order'));
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
