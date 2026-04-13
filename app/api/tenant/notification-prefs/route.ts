import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query, queryOne } from '@/lib/db/client';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const row = await queryOne<any>(
      `SELECT notification_prefs FROM public.tenant_members WHERE user_id=$1 AND tenant_id=$2 AND status='active'`,
      [ctx.userId, ctx.tenantId]
    );
    return NextResponse.json({ data: row?.notification_prefs ?? {} });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const prefs = await req.json();
    // Whitelist allowed pref keys
    const allowed = ['email_task_reminders','email_deal_updates','email_mentions',
                     'browser_notifications','email_task_due','email_deal_won','email_mention','push_enabled'];
    const safe = Object.fromEntries(
      Object.entries(prefs).filter(([k]) => allowed.includes(k))
    );
    await query(
      `UPDATE public.tenant_members SET notification_prefs=$1
       WHERE user_id=$2 AND tenant_id=$3 AND status='active'`,
      [JSON.stringify(safe), ctx.userId, ctx.tenantId]
    );
    return NextResponse.json({ ok: true, data: safe });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
