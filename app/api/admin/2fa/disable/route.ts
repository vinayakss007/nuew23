import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';

/**
 * Admin Recovery: Disable 2FA for a user
 * 
 * Usage: When user contacts you and proves identity
 * - Verify their identity (email, phone, etc.)
 * - Use this endpoint to disable their 2FA
 * - User can then login with password only
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Only super admins can disable 2FA for others
    if (!ctx.user?.is_super_admin) {
      return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    }

    const { user_email, reason } = await request.json();

    if (!user_email) {
      return NextResponse.json({ error: 'User email required' }, { status: 400 });
    }

    // Find user
    const user = await queryOne<any>(
      'SELECT id, email, full_name, totp_enabled FROM public.users WHERE email = $1',
      [user_email.toLowerCase()]
    );

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!user.totp_enabled) {
      return NextResponse.json({ error: 'User does not have 2FA enabled' }, { status: 400 });
    }

    // Disable 2FA for user
    await query(
      'UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_backup_codes = NULL WHERE id = $1',
      [user.id]
    );

    // Log the action
    await query(
      `INSERT INTO public.audit_logs (tenant_id, user_id, action, resource_type, resource_id, new_data)
       VALUES ($1, $2, 'admin_disable_2fa', 'user', $3, $4)`,
      [ctx.tenantId, ctx.userId, user.id, { reason: reason || 'Admin recovery', user_email }]
    );

    return NextResponse.json({
      ok: true,
      message: `2FA disabled for ${user.email}`,
      user: { email: user.email, full_name: user.full_name }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
