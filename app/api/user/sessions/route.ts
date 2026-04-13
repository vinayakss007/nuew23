import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';
import { hashToken } from '@/lib/auth/session';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const currentToken = request.cookies.get('nucrm_session')?.value;
    const currentHash = currentToken ? await hashToken(currentToken) : null;
    const sessions = await queryMany(
      `SELECT id, ip_address, user_agent, created_at, expires_at, token_hash
       FROM public.sessions WHERE user_id=$1 AND expires_at>now() ORDER BY created_at DESC`,
      [ctx.userId]
    );
    const data = sessions.map(s => ({ ...s, is_current: s.token_hash === currentHash, token_hash: undefined }));
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { sessionId, revokeAll } = await request.json();
    const currentToken = request.cookies.get('nucrm_session')?.value;
    const currentHash = currentToken ? await hashToken(currentToken) : null;
    if (revokeAll) {
      await query('DELETE FROM public.sessions WHERE user_id=$1 AND token_hash!=$2', [ctx.userId, currentHash]);
    } else if (sessionId) {
      // Can only revoke own sessions
      await query('DELETE FROM public.sessions WHERE id=$1 AND user_id=$2 AND token_hash!=$3', [sessionId, ctx.userId, currentHash]);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
