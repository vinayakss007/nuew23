import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const data = await queryMany(
      'SELECT id, user_id, tenant_id, title, body, type, is_read, link, created_at FROM public.notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50',
      [ctx.userId]
    );
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id, markAllRead } = await request.json();
    if (markAllRead) {
      await query('UPDATE public.notifications SET is_read=true WHERE user_id=$1', [ctx.userId]);
    } else if (id) {
      await query('UPDATE public.notifications SET is_read=true WHERE id=$1 AND user_id=$2', [id, ctx.userId]);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json().catch(() => ({}));
    if (body.id) {
      await query('DELETE FROM public.notifications WHERE id=$1 AND user_id=$2', [body.id, ctx.userId]);
    } else {
      await query('DELETE FROM public.notifications WHERE user_id=$1', [ctx.userId]);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
