import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';
import { randomBytes } from 'crypto';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const data = await queryMany(
      `SELECT i.id, i.name, i.is_active, i.last_used_at, i.created_at,
              i.config->>'url' as url,
              i.config->'events' as events,
              (SELECT count(*)::int FROM public.webhook_deliveries WHERE integration_id=i.id AND status='delivered') as delivered_count,
              (SELECT count(*)::int FROM public.webhook_deliveries WHERE integration_id=i.id AND status='failed') as failed_count
       FROM public.integrations i
       WHERE i.tenant_id=$1 AND i.type='webhook' ORDER BY i.created_at DESC`,
      [ctx.tenantId]
    );
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { name, url, events = [] } = await req.json();
    if (!name?.trim() || !url?.trim()) return NextResponse.json({ error: 'name and url required' }, { status: 400 });
    try { new URL(url); } catch { return NextResponse.json({ error: 'Invalid URL' }, { status: 400 }); }
    const signingSecret = randomBytes(24).toString('hex');
    const { rows:[row] } = await query(
      `INSERT INTO public.integrations (tenant_id,user_id,type,name,config,is_active)
       VALUES ($1,$2,'webhook',$3,$4,true) RETURNING id,name,is_active,created_at`,
      [ctx.tenantId, ctx.userId, name.trim(), JSON.stringify({ url, events, secret: signingSecret })]
    );
    return NextResponse.json({ data: { ...row, signing_secret: signingSecret, note: 'Save this secret — shown once.' } }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
