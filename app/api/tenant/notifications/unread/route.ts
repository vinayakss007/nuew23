import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const r = await queryOne<{ count: string }>(
      'SELECT count(*)::int as count FROM public.notifications WHERE user_id=$1 AND is_read=false',
      [ctx.userId]
    );
    return NextResponse.json({ count: parseInt(r?.count ?? '0', 10) });
  } catch { return NextResponse.json({ count: 0 }); }
}
