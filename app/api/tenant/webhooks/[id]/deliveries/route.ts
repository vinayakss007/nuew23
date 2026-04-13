import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany } from '@/lib/db/client';

export async function GET(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const data = await queryMany(
      `SELECT id,event,status,response_code,attempts,delivered_at,next_retry_at,created_at
       FROM public.webhook_deliveries WHERE integration_id=$1 AND tenant_id=$2
       ORDER BY created_at DESC LIMIT 50`,
      [(await params).id, ctx.tenantId]
    );
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
