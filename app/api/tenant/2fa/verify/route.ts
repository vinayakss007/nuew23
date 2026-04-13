import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';
import { createHash, createHmac } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { totp_code, backup_codes } = await request.json();

    if (!totp_code || !/^\d{6}$/.test(totp_code)) {
      return NextResponse.json({ error: 'Invalid 6-digit code' }, { status: 400 });
    }

    // Get user's TOTP secret
    const user = await queryOne<any>('SELECT totp_secret FROM public.users WHERE id = $1', [ctx.userId]);
    if (!user?.totp_secret) {
      return NextResponse.json({ error: '2FA not initiated' }, { status: 400 });
    }

    // Verify TOTP code
    const isValid = verifyTOTP(user.totp_secret, totp_code);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
    }

    // Enable 2FA
    await query('UPDATE users SET totp_enabled = true WHERE id = $1', [ctx.userId]);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function verifyTOTP(secret: string, token: string): boolean {
  const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0;
  const kb: number[] = [];
  
  for (const c of secret.toUpperCase()) {
    const idx = b32.indexOf(c);
    if (idx === -1) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      kb.push((val >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  
  const key = Buffer.from(kb);
  const counter = Math.floor(Date.now() / 30000);
  
  // Check current and adjacent time windows (±1)
  for (let i = -1; i <= 1; i++) {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter + i));
    
    const hmac = createHmac('sha1', key);
    hmac.update(buf);
    const digest = hmac.digest();
    
    const offset = digest[digest.length - 1]! & 0xf;
    const code = ((digest[offset]! & 0x7f) << 24 |
                  (digest[offset + 1]! & 0xff) << 16 |
                  (digest[offset + 2]! & 0xff) << 8 |
                  (digest[offset + 3]! & 0xff)) % 1000000;
    
    if (code.toString().padStart(6, '0') === token) {
      return true;
    }
  }
  
  return false;
}
