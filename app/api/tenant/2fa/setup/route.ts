import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';
import { randomBytes, createHash } from 'crypto';
import * as QRCode from 'qrcode';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Generate TOTP secret (20 bytes = 32 base32 chars)
    const secret = randomBytes(20).toString('hex').toUpperCase();

    // Generate QR code
    const issuer = 'NuCRM';
    const email = ctx.user?.email ?? 'user@nucrm.com';
    const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
    const qrCode = await QRCode.toDataURL(otpauth);

    // Generate 10 backup codes
    const backupCodes = Array(10).fill(0).map(() => 
      randomBytes(4).toString('hex').slice(0, 6) + '-' + randomBytes(4).toString('hex').slice(0, 6)
    );

    // Hash backup codes for storage
    const hashedCodes = backupCodes.map(code => createHash('sha256').update(code).digest('hex'));

    // Store secret and backup codes (but don't enable yet - wait for verification)
    await query(
      'UPDATE users SET totp_secret = $1, totp_backup_codes = $2 WHERE id = $3',
      [secret, hashedCodes, ctx.userId]
    );

    return NextResponse.json({
      secret,
      qr_code: `<img src="${qrCode}" alt="QR Code" class="w-48 h-48" />`,
      backup_codes: backupCodes,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
