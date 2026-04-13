import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';
import { verifyPassword, hashPassword } from '@/lib/auth/session';

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { current_password, new_password } = await request.json();
    if (!current_password || !new_password) return NextResponse.json({ error: 'Both passwords required' }, { status: 400 });
    if (new_password.length < 12) return NextResponse.json({ error: 'New password must be at least 12 characters' }, { status: 400 });
    if (!/[A-Z]/.test(new_password)) return NextResponse.json({ error: 'Password must contain an uppercase letter' }, { status: 400 });
    if (!/[0-9]/.test(new_password)) return NextResponse.json({ error: 'Password must contain a number' }, { status: 400 });
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(new_password)) return NextResponse.json({ error: 'Password must contain a special character' }, { status: 400 });
    const user = await queryOne<any>('SELECT password_hash FROM public.users WHERE id=$1', [ctx.userId]);
    if (!user || !await verifyPassword(current_password, user.password_hash)) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }
    const newHash = await hashPassword(new_password);
    await query('UPDATE public.users SET password_hash=$1, updated_at=now() WHERE id=$2', [newHash, ctx.userId]);
    // Invalidate all other sessions
    await query(`DELETE FROM public.sessions WHERE user_id=$1 AND created_at < now()`, [ctx.userId]);
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
