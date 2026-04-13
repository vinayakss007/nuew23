import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { permission } = await request.json();
    if (!permission) return NextResponse.json({ error: 'permission required' }, { status: 400 });
    return NextResponse.json({ allowed: can(ctx, permission), roleSlug: ctx.roleSlug });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
