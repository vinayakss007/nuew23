import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { queryMany, query } from '@/lib/db/client';
import { sendEmail } from '@/lib/email/service';

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error:'Unauthorized' }, { status:401 });
  }
  try {
    let expired=0, warned=0;

    // 1. Expire trials that ended
    const justExpired = await queryMany<any>(
      `UPDATE public.tenants SET status='trial_expired'
       WHERE status='trialing' AND trial_ends_at < now()
       RETURNING id, name, billing_email,
         (SELECT email FROM public.users WHERE id=owner_id) as owner_email,
         (SELECT full_name FROM public.users WHERE id=owner_id) as owner_name`
    );
    for (const t of justExpired) {
      expired++;
      const to = t.billing_email || t.owner_email;
      if (to) {
        await sendEmail({
          to,
          subject: `Your NuCRM trial has ended — upgrade to keep access`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
            <h2 style="color:#111827">Your free trial has ended</h2>
            <p style="color:#6b7280">Hi ${t.owner_name||'there'}, your ${t.name} workspace trial has expired.</p>
            <p style="color:#6b7280">Your data is safe — upgrade within 30 days to regain full access.</p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/tenant/settings/billing" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">Upgrade Now →</a>
          </div>`,
          text: `Your NuCRM trial for ${t.name} has ended. Upgrade: ${process.env.NEXT_PUBLIC_APP_URL}/tenant/settings/billing`,
        }).catch(()=>{});
      }
    }

    // 2. Warn 3 days before expiry
    const expiringSoon = await queryMany<any>(
      `SELECT t.id, t.name, t.billing_email, t.trial_ends_at,
              u.email as owner_email, u.full_name as owner_name
       FROM public.tenants t
       LEFT JOIN public.users u ON u.id=t.owner_id
       WHERE t.status='trialing'
         AND t.trial_ends_at BETWEEN now() AND now()+interval '3 days 1 hour'
         AND NOT EXISTS (
           SELECT 1 FROM public.activities
           WHERE tenant_id=t.id AND type='trial_warning' AND created_at > now()-interval '4 days'
         )`
    );
    for (const t of expiringSoon) {
      warned++;
      const daysLeft = Math.max(1, Math.ceil((new Date(t.trial_ends_at).getTime()-Date.now())/86400000));
      const to = t.billing_email || t.owner_email;
      if (to) {
        await sendEmail({
          to,
          subject: `⏰ Your NuCRM trial expires in ${daysLeft} day${daysLeft>1?'s':''}`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
            <h2 style="color:#d97706">Trial expiring in ${daysLeft} day${daysLeft>1?'s':''}</h2>
            <p style="color:#6b7280">Hi ${t.owner_name||'there'}, your ${t.name} workspace trial ends in ${daysLeft} day${daysLeft>1?'s':''}.</p>
            <p style="color:#6b7280">Upgrade now to keep all your data and team access.</p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL}/tenant/settings/billing" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">View Plans →</a>
          </div>`,
          text: `Your NuCRM trial for ${t.name} expires in ${daysLeft} day(s). Upgrade: ${process.env.NEXT_PUBLIC_APP_URL}/tenant/settings/billing`,
        }).catch(()=>{});
      }
      // Mark warned
      await query(
        `INSERT INTO public.activities (tenant_id,user_id,type,description) VALUES ($1,(SELECT owner_id FROM public.tenants WHERE id=$1),'trial_warning',$2)`,
        [t.id, `Trial warning sent — ${daysLeft} days left`]
      ).catch(()=>{});
    }

    return NextResponse.json({ ok:true, expired, warned });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}
