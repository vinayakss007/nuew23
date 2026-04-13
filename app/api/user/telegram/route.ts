import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';

// GET /api/user/telegram - Get user's Telegram settings
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const user = await queryOne<{
      telegram_bot_token: string;
      telegram_chat_id: string;
      telegram_enabled: boolean;
      telegram_notify_login: boolean;
      telegram_notify_signup: boolean;
      telegram_notify_password_change: boolean;
      telegram_notify_2fa_change: boolean;
      telegram_notify_security_alerts: boolean;
    }>(
      `SELECT telegram_bot_token, telegram_chat_id, telegram_enabled,
              telegram_notify_login, telegram_notify_signup,
              telegram_notify_password_change, telegram_notify_2fa_change,
              telegram_notify_security_alerts
       FROM public.users WHERE id = $1`,
      [ctx.userId]
    );

    return NextResponse.json({
      ok: true,
      settings: user || {
        telegram_bot_token: null,
        telegram_chat_id: null,
        telegram_enabled: false,
        telegram_notify_login: true,
        telegram_notify_signup: true,
        telegram_notify_password_change: true,
        telegram_notify_2fa_change: true,
        telegram_notify_security_alerts: true,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// PATCH /api/user/telegram - Update Telegram settings
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const body = await request.json();
    const {
      telegram_bot_token,
      telegram_chat_id,
      telegram_enabled,
      telegram_notify_login,
      telegram_notify_signup,
      telegram_notify_password_change,
      telegram_notify_2fa_change,
      telegram_notify_security_alerts,
    } = body;

    // If testing the bot, verify it works
    if (body.action === 'test' && telegram_bot_token && telegram_chat_id) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${telegram_bot_token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegram_chat_id,
            text: '✅ *NuCRM Connection Test*\n\nYour Telegram notifications are working! 🎉',
            parse_mode: 'Markdown',
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return NextResponse.json({
            error: `Telegram error: ${data.description || res.status}`,
          }, { status: 400 });
        }

        return NextResponse.json({ ok: true, message: 'Test message sent!' });
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }

    await query(
      `UPDATE public.users SET
         telegram_bot_token = $1,
         telegram_chat_id = $2,
         telegram_enabled = $3,
         telegram_notify_login = $4,
         telegram_notify_signup = $5,
         telegram_notify_password_change = $6,
         telegram_notify_2fa_change = $7,
         telegram_notify_security_alerts = $8
       WHERE id = $9`,
      [
        telegram_bot_token || null,
        telegram_chat_id || null,
        telegram_enabled ?? false,
        telegram_notify_login ?? true,
        telegram_notify_signup ?? true,
        telegram_notify_password_change ?? true,
        telegram_notify_2fa_change ?? true,
        telegram_notify_security_alerts ?? true,
        ctx.userId,
      ]
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
