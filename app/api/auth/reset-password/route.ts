import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db/client';
import { createHash } from 'crypto';
import { hashPassword, createToken, hashToken, setSessionCookie, validatePassword } from '@/lib/auth/session';
import { sendTelegramToUser } from '@/lib/email/service';

export async function POST(request: NextRequest) {
  try {
    const { token, password } = await request.json();
    if (!token || !password) return NextResponse.json({ error: 'Token and password required' }, { status: 400 });

    // SEC-006 FIX: Use same password validation as signup (12+ chars, uppercase, number, special)
    const pwError = validatePassword(password);
    if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const reset = await queryOne<any>(
      `SELECT id, user_id, token_hash, expires_at, used_at FROM public.password_resets
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash]
    );
    if (!reset) return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 });

    // Update password and mark token used
    const newPasswordHash = await hashPassword(password);
    await query('UPDATE public.users SET password_hash=$1, updated_at=now() WHERE id=$2', [newPasswordHash, reset.user_id]);
    await query('UPDATE public.password_resets SET used_at=now() WHERE id=$1', [reset.id]);
    // Invalidate all existing sessions
    await query('DELETE FROM public.sessions WHERE user_id=$1', [reset.user_id]);

    // Auto login
    const sessionToken = await createToken(reset.user_id);
    const sessionTokenHash = await hashToken(sessionToken);
    await query(
      `INSERT INTO public.sessions (user_id, token_hash, expires_at) VALUES ($1,$2,now()+interval '30 days')`,
      [reset.user_id, sessionTokenHash]
    );
    await setSessionCookie(sessionToken);

    // Send Telegram password change alert
    sendTelegramToUser({
      userId: reset.user_id,
      title: '🔑 Password Changed',
      message: 'Your account password has been successfully changed. If this wasn\'t you, contact support immediately.',
      icon: '⚠️',
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
