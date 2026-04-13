import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query } from '@/lib/db/client';

export async function DELETE(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { rowCount } = await query(
      'DELETE FROM public.invitations WHERE id=$1 AND tenant_id=$2',
      [(await params).id, ctx.tenantId]
    );
    if (!rowCount) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
