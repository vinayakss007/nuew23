import { logError } from '@/lib/errors';
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, withTransaction } from '@/lib/db/client';
import { hashPassword, verifyPassword, createToken, hashToken, setSessionCookie, clearSessionCookie, validatePassword } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendEmail, sendWebhookNotification, sendTelegram } from '@/lib/email/service';
import { devLogger } from '@/lib/dev-logger';

// ── Login ─────────────────────────────────────────────────────
export async function POST_login(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action:'login', max:10, windowMinutes:15 });
    if (limited) return limited;

    const body = await request.json();
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    if (!email || !password) return NextResponse.json({ error:'Email and password required' }, { status:400 });

    const user = await queryOne<any>(
      'SELECT id, email, password_hash, full_name, is_super_admin, email_verified, totp_enabled, totp_secret, totp_backup_codes, last_tenant_id FROM public.users WHERE email=$1',
      [email]
    );
    if (!user || !user.password_hash || !await verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ error:'Invalid email or password' }, { status:401 });
    }

    // Email verification check (soft — warn but don't block, unless platform requires it)
    const requireVerify = process.env['REQUIRE_EMAIL_VERIFY'] !== 'false';
    if (requireVerify && !user.email_verified && !user.is_super_admin) {
      return NextResponse.json({
        error: 'Please verify your email address before signing in.',
        needs_verification: true,
        email: user.email,
      }, { status: 403 });
    }


    // 2FA check
    if (user.totp_enabled) {
      const totpToken = body.totp_token;
      if (!totpToken) {
        return NextResponse.json({ requires_2fa: true, email: user.email }, { status: 200 });
      }
      const { createHmac, createHash } = await import('crypto');
      const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let bits = 0, val = 0; const kb: number[] = [];
      for (const ch of (user.totp_secret ?? '').toUpperCase()) {
        const idx = b32.indexOf(ch); if (idx === -1) continue;
        val = (val << 5) | idx; bits += 5;
        if (bits >= 8) { kb.push((val >>> (bits-8)) & 255); bits -= 8; }
      }
      const key = Buffer.from(kb);
      const ctr = Math.floor(Date.now() / 30000);
      let valid = false;
      for (let i = -1; i <= 1; i++) {
        const c = ctr + i; const buf = Buffer.alloc(8);
        buf.writeUInt32BE(Math.floor(c/0x100000000),0); buf.writeUInt32BE(c>>>0,4);
        const hmac = createHmac('sha1',key).update(buf).digest();
        const off = hmac[hmac.length-1]! & 0xf;
        const code = (((hmac[off]!)&0x7f)<<24|(hmac[off+1]!)<<16|(hmac[off+2]!)<<8|(hmac[off+3]!))%1000000;
        if (String(code).padStart(6,'0') === String(totpToken)) { valid = true; break; }
      }
      if (!valid && user.totp_backup_codes) {
        const hash = createHash('sha256').update(String(totpToken).toUpperCase()).digest('hex');
        const codes: string[] = typeof user.totp_backup_codes === 'string' ? JSON.parse(user.totp_backup_codes) : user.totp_backup_codes;
        if (codes.includes(hash)) {
          valid = true;
          await query('UPDATE public.users SET totp_backup_codes=$1 WHERE id=$2', [JSON.stringify(codes.filter((x:string)=>x!==hash)), user.id]).catch(()=>{});
        }
      }
      if (!valid) return NextResponse.json({ error:'Invalid 2FA code', requires_2fa:true }, { status:401 });
    }

    // Create session
    const token = await createToken(user.id);
    const tokenHash = await hashToken(token);
    await query(
      `INSERT INTO public.sessions (user_id,token_hash,expires_at,ip_address,user_agent)
       VALUES ($1,$2,now()+interval '30 days',$3,$4)`,
      [user.id, tokenHash,
       request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown',
       (request.headers.get('user-agent') ?? '').slice(0,255)]
    );
    await setSessionCookie(token);
    return NextResponse.json({ ok:true, user:{ id:user.id, email:user.email, full_name:user.full_name, is_super_admin:user.is_super_admin } });
  } catch (err:any) {
    devLogger.error(err as Error, '[auth/login]');
    return NextResponse.json({ error:'Login failed. Please try again.' }, { status:500 });
  }
}

// ── Signup ────────────────────────────────────────────────────
export async function POST_signup(request: NextRequest) {
  try {
    // Rate limiting to prevent abuse
    const limited = await checkRateLimit(request, { action:'signup', max:5, windowMinutes:60 });
    if (limited) return limited;

    const body = await request.json();
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    const fullName = body.full_name?.trim();
    const workspaceName = body.workspace_name?.trim();

    if (!email || !password || !fullName || !workspaceName) return NextResponse.json({ error:'All fields are required' }, { status:400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error:'Invalid email address' }, { status:400 });
    const passwordError = validatePassword(password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status:400 });

    const existing = await queryOne<{id:string}>('SELECT id FROM public.users WHERE email=$1', [email]);
    if (existing) return NextResponse.json({ error:'An account with this email already exists' }, { status:409 });

    const trialDays = parseInt(process.env.DEFAULT_TRIAL_DAYS ?? '14');
    const { user, tenant } = await withTransaction(async (client) => {
      const { rows:[u] } = await client.query(
        `INSERT INTO public.users (email,password_hash,full_name) VALUES ($1,$2,$3) RETURNING id,email,full_name,is_super_admin`,
        [email, await hashPassword(password), fullName]
      );
      const base = workspaceName.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,40);
      const slug = `${base}-${Date.now().toString(36)}`;
      const { rows:[t] } = await client.query(
        `INSERT INTO public.tenants (name,slug,owner_id,plan_id,status,trial_ends_at)
         VALUES ($1,$2,$3,'free','trialing',now()+($4||' days')::interval) RETURNING id,name,slug`,
        [workspaceName, slug, u.id, trialDays]
      );
      // CRITICAL: Create tenant_member row — user is ADMIN of their own org
      // Resolve the admin role_id so permission JOINs work for non-admin users too
      const adminRoleRes = await client.query(
        `SELECT id FROM public.roles WHERE tenant_id=$1 AND slug='admin' LIMIT 1`,
        [t.id]
      );
      const adminRoleId = adminRoleRes.rows[0]?.id || null;
      await client.query(
        `INSERT INTO public.tenant_members (tenant_id,user_id,role_slug,role_id,status,joined_at)
         VALUES ($1,$2,'admin',$3,'active',now())
         ON CONFLICT (tenant_id,user_id) DO UPDATE SET status='active',role_slug='admin',role_id=$3`,
        [t.id, u.id, adminRoleId]
      );
      // Set last_tenant_id so they land in their org after login
      await client.query('UPDATE public.users SET last_tenant_id=$1 WHERE id=$2', [t.id, u.id]);
      await client.query(`INSERT INTO public.onboarding_progress (tenant_id,steps_done) VALUES ($1,'{}') ON CONFLICT DO NOTHING`, [t.id]);
      return { user:u, tenant:t };
    });

    // Session
    const token = await createToken(user.id);
    const tokenHash = await hashToken(token);
    await query(`INSERT INTO public.sessions (user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '30 days')`, [user.id, tokenHash]);
    await setSessionCookie(token);

    // Send Discord/Slack webhook notification (fire-and-forget)
    sendWebhookNotification({
      title: '🎉 New User Signed Up',
      message: `**${user.full_name}** (${user.email}) joined\nWorkspace: **${tenant.name}** (\`${tenant.slug}\`)`,
      color: '#10b981',
      url: `${process.env.NEXT_PUBLIC_APP_URL}/tenant`,
    }).catch(() => {});

    // Send Telegram notification if user configured it (fire-and-forget)
    sendTelegram({
      botToken: process.env['TELEGRAM_BOT_TOKEN'] || '',
      chatId: process.env['TELEGRAM_CHAT_ID'] || '',
      title: '🎉 New User Signed Up',
      message: `${user.full_name} (${user.email}) joined\nWorkspace: ${tenant.name} (${tenant.slug})`,
      icon: '🟢',
      url: `${process.env.NEXT_PUBLIC_APP_URL}/tenant`,
    }).catch(() => {});

    // Send verification email (fire-and-forget)
    if (process.env.RESEND_API_KEY || process.env.SMTP_HOST) {
      const { randomBytes, createHash } = await import('crypto');
      const vToken = randomBytes(32).toString('hex');
      const vHash = createHash('sha256').update(vToken).digest('hex');

      query(
        `INSERT INTO public.email_verifications (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '24 hours')`,
        [user.id, vHash]
      ).then(() => {
        const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/verify-email?token=${vToken}`;
        sendEmail({
          to: email,
          subject: 'Verify your email address — NuCRM',
          html: `<p>Welcome to NuCRM! Click the link below to verify your email address:</p>
                 <a href="${verifyUrl}">${verifyUrl}</a>
                 <p>This link expires in 24 hours.</p>`,
        }).catch((err) => devLogger.error(err as Error, '[auth/signup] Failed to send verification email'));
      }).catch((err) => devLogger.error(err as Error, '[auth/signup] Failed to create verification token'));
    }

    return NextResponse.json({ ok:true, user:{ id:user.id, email:user.email, full_name:user.full_name }, tenant:{ id:tenant.id, name:tenant.name, slug:tenant.slug } }, { status:201 });
  } catch (err:any) {
    devLogger.error(err as Error, '[auth/signup]');
    return NextResponse.json({ error: err.message ?? 'Signup failed.' }, { status:500 });
  }
}

// ── Logout ────────────────────────────────────────────────────
export async function POST_logout(request: NextRequest) {
  try {
    const token = request.cookies.get('nucrm_session')?.value;
    if (token) {
      const tokenHash = await hashToken(token);
      await query('DELETE FROM public.sessions WHERE token_hash=$1', [tokenHash]).catch(()=>{});
    }
    await clearSessionCookie();
    return NextResponse.json({ ok:true });
  } catch { await clearSessionCookie(); return NextResponse.json({ ok:true }); }
}
