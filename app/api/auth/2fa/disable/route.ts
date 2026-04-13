import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query, queryOne } from '@/lib/db/client';
import { verifyPassword } from '@/lib/auth/session';

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { password } = await req.json();
    if (!password) return NextResponse.json({ error: 'Current password required to disable 2FA' }, { status: 400 });
    const user = await queryOne<any>('SELECT password_hash, totp_enabled FROM public.users WHERE id=$1', [ctx.userId]);
    if (!user?.totp_enabled) return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 });
    if (!await verifyPassword(password, user.password_hash)) return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    await query('UPDATE public.users SET totp_enabled=false, totp_secret=NULL, totp_backup_codes=NULL WHERE id=$1', [ctx.userId]);
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
