import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { alertSuperAdmin } from '@/lib/email/service';

function verifyStripeSignature(payload: string, header: string, secret: string): boolean {
  try {
    const parts = header.split(',').reduce((acc: Record<string,string>, part) => {
      const [k, v] = part.split('=');
      if (k && v) acc[k] = v;
      return acc;
    }, {});
    const ts = parts['t'];
    const sig = parts['v1'];
    if (!ts || !sig) return false;
    // Reject events older than 5 minutes
    if (Math.abs(Date.now() / 1000 - parseInt(ts)) > 300) return false;
    const expected = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sig, 'hex'));
  } catch { return false; }
}

export async function POST(request: NextRequest) {
  const body    = await request.text();
  const sigHeader = request.headers.get('stripe-signature') ?? '';
  const secret  = process.env.STRIPE_WEBHOOK_SECRET;

  // Require webhook secret to be configured — never process unsigned events
  if (!secret) {
    console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET not configured — rejecting request');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  // Verify signature
  if (!sigHeader || !verifyStripeSignature(body, sigHeader, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(body); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const obj = event.data?.object ?? {};

  try {
    switch (event.type) {
      case 'invoice.paid': {
        const tenantId = obj.metadata?.tenant_id;
        await query(
          `INSERT INTO public.billing_events (tenant_id,event_type,amount,stripe_event_id,metadata)
           VALUES ($1,'invoice.paid',$2,$3,$4)`,
          [tenantId||null, (obj.amount_paid||0)/100, event.id, JSON.stringify(obj)]
        ).catch(()=>{});
        // Activate tenant if trialing
        if (tenantId) {
          await query(
            `UPDATE public.tenants SET status='active' WHERE id=$1 AND status IN ('trialing','trial_expired','past_due')`,
            [tenantId]
          ).catch(()=>{});
        }
        break;
      }

      case 'customer.subscription.updated': {
        const tenantId = obj.metadata?.tenant_id;
        const plan_id  = obj.metadata?.plan_id;
        if (tenantId) {
          const status = obj.status === 'active' ? 'active'
            : obj.status === 'past_due' ? 'past_due'
            : obj.status === 'canceled'  ? 'cancelled'
            : null;
          if (status) {
            await query('UPDATE public.tenants SET status=$1 WHERE id=$2', [status, tenantId]).catch(()=>{});
          }
          if (plan_id) {
            await query('UPDATE public.tenants SET plan_id=$1 WHERE id=$2', [plan_id, tenantId]).catch(()=>{});
          }
          await query(
            `INSERT INTO public.billing_events (tenant_id,event_type,stripe_event_id,metadata)
             VALUES ($1,'subscription_updated',$2,$3)`,
            [tenantId, event.id, JSON.stringify({status:obj.status, plan_id})]
          ).catch(()=>{});
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const tenantId = obj.metadata?.tenant_id;
        if (tenantId) {
          await query(`UPDATE public.tenants SET status='cancelled' WHERE id=$1`, [tenantId]).catch(()=>{});
        }
        await query(
          `INSERT INTO public.billing_events (tenant_id,event_type,stripe_event_id,metadata)
           VALUES ($1,'cancelled',$2,$3)`,
          [tenantId||null, event.id, JSON.stringify(obj)]
        ).catch(()=>{});
        break;
      }

      case 'payment_intent.payment_failed': {
        const tenantId = obj.metadata?.tenant_id;
        if (tenantId) {
          await query(`UPDATE public.tenants SET status='past_due' WHERE id=$1 AND status='active'`, [tenantId]).catch(()=>{});
        }
        await query(
          `INSERT INTO public.billing_events (tenant_id,event_type,stripe_event_id,metadata)
           VALUES ($1,'payment_failed',$2,$3)`,
          [tenantId||null, event.id, JSON.stringify(obj)]
        ).catch(()=>{});
        // Alert super admin on payment failure
        await alertSuperAdmin('Payment Failed', `Stripe event: ${event.id}\nTenant: ${tenantId||'unknown'}\nAmount: $${(obj.amount||0)/100}`).catch(()=>{});
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[stripe webhook]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
