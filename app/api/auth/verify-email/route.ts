import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db/client';
import { createHash } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });
    const hash = createHash('sha256').update(token).digest('hex');
    const row = await queryOne<any>(
      `SELECT ev.*, u.email FROM public.email_verifications ev
       JOIN public.users u ON u.id=ev.user_id
       WHERE ev.token_hash=$1 AND ev.verified_at IS NULL AND ev.expires_at>now()`, [hash]
    );
    if (!row) return NextResponse.json({ error: 'Invalid or expired verification link' }, { status: 400 });
    await query('UPDATE public.users SET email_verified=true WHERE id=$1', [row.user_id]);
    await query('UPDATE public.email_verifications SET verified_at=now() WHERE id=$1', [row.id]);
    return NextResponse.json({ ok: true, email: row.email });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
