import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query } from '@/lib/db/client';

const ALLOWED = [
  'platform_name','support_email','app_url','allow_signups','require_email_verify',
  'maintenance_mode','default_trial_days','default_plan','max_free_tenants',
  'stripe_publishable_key','stripe_secret_key','stripe_webhook_secret',
  'resend_api_key','smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from',
  'default_timezone','contact_score_enabled','session_duration_days','max_sessions_per_user',
  'backup_retention_days','backup_bucket','ai_features_enabled','anthropic_api_key',
];

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS public.platform_settings (
      key        text primary key,
      value      text not null,
      updated_at timestamptz default now()
    )`).catch(()=>{});
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error:'Forbidden' }, { status:403 });
    await ensureTable();
    const { rows } = await query<{key:string;value:string}>('SELECT key,value FROM public.platform_settings');
    const defaults: Record<string,string> = {
      platform_name:'NuCRM', support_email:'', app_url:process.env.NEXT_PUBLIC_APP_URL??'',
      allow_signups:'true', require_email_verify:'true', maintenance_mode:'false',
      default_trial_days: process.env.DEFAULT_TRIAL_DAYS??'14',
      default_plan:'free', max_free_tenants:'1000',
      stripe_publishable_key:'', stripe_secret_key:'', stripe_webhook_secret:'',
      resend_api_key:'', smtp_host:'', smtp_port:'587', smtp_user:'', smtp_pass:'', smtp_from:'',
      default_timezone:'UTC', contact_score_enabled:'true',
      session_duration_days:'30', max_sessions_per_user:'10',
      backup_retention_days:'30', backup_bucket:process.env.BACKUP_BUCKET??'',
      ai_features_enabled:'false', anthropic_api_key:'',
    };
    for (const row of rows) defaults[row.key] = row.value;
    return NextResponse.json({ data: defaults });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error:'Forbidden' }, { status:403 });
    await ensureTable();
    const body = await request.json();
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED.includes(k)) {
        await query(
          `INSERT INTO public.platform_settings (key,value,updated_at) VALUES ($1,$2,now())
           ON CONFLICT (key) DO UPDATE SET value=$2,updated_at=now()`,
          [k, String(v)]
        );
      }
    }
    return NextResponse.json({ ok:true });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}
