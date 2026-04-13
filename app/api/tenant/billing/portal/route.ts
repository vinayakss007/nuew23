import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne } from '@/lib/db/client';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error:'Admin required' }, { status:403 });
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) return NextResponse.json({ error:'Stripe not configured' }, { status:503 });
    const tenant = await queryOne<any>('SELECT stripe_customer_id FROM public.tenants WHERE id=$1', [ctx.tenantId]);
    if (!tenant?.stripe_customer_id) return NextResponse.json({ error:'No billing account. Upgrade first.' }, { status:404 });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method:'POST',
      headers:{ 'Authorization':`Bearer ${stripeKey}`, 'Content-Type':'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ customer: tenant.stripe_customer_id, return_url: `${appUrl}/tenant/settings/billing` }).toString(),
    });
    const session = await res.json() as any;
    if (!res.ok) return NextResponse.json({ error: session.error?.message ?? 'Stripe error' }, { status:400 });
    return NextResponse.json({ url: session.url });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status:500 }); }
}
