import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query, withTransaction } from '@/lib/db/client';
import { hashPassword, createToken, hashToken, setSessionCookie, validatePassword } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    // Parse body once
    const body = await request.json().catch(() => ({}));
    const { full_name, email, password, workspace_name, setup_key } = body;

    // Only works if zero super admin users exist (or in development)
    const existing = await queryOne<{ count: number }>(
      'SELECT count(*)::int as count FROM public.users WHERE is_super_admin = true'
    );
    if (process.env.NODE_ENV !== 'development' && (existing?.count ?? 0) > 0) {
      return NextResponse.json({ error: 'Setup already complete. An admin account already exists.' }, { status: 403 });
    }

    // Validate setup key in production
    if (process.env.NODE_ENV === 'production' && process.env.SETUP_KEY) {
      if (setup_key !== process.env.SETUP_KEY) {
        return NextResponse.json({ error: 'Invalid setup key' }, { status: 401 });
      }
    }

    if (!full_name?.trim() || !email?.trim() || !password || !workspace_name?.trim()) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }
    const passwordError = validatePassword(password);
    if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

    const { user, tenant } = await withTransaction(async (client) => {
      const passwordHash = await hashPassword(password);
      const { rows: [u] } = await client.query(
        `INSERT INTO public.users (email, password_hash, full_name, is_super_admin)
         VALUES (lower($1), $2, $3, true) RETURNING *`,
        [email.trim(), passwordHash, full_name.trim()]
      );
      const slug = workspace_name.toLowerCase()
        .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)
        + '-' + Date.now().toString(36);

      // Look up the Enterprise plan UUID
      const { rows: [enterprisePlan] } = await client.query(
        `SELECT id FROM public.plans WHERE slug = 'enterprise' LIMIT 1`
      );
      const planId = enterprisePlan?.id ?? '850c4bce-5cdf-4c29-b50f-09e64b6fbe90';

      const { rows: [t] } = await client.query(
        `INSERT INTO public.tenants (name, slug, owner_id, plan_id, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
        [workspace_name.trim(), slug, u.id, planId]
      );
      // CRITICAL: Create tenant_member row — super admin is ADMIN of their org
      await client.query(
        `INSERT INTO public.tenant_members (tenant_id,user_id,role_slug,status,joined_at)
         VALUES ($1,$2,'admin','active',now())
         ON CONFLICT (tenant_id,user_id) DO UPDATE SET status='active',role_slug='admin'`,
        [t.id, u.id]
      );
      await client.query('UPDATE public.users SET last_tenant_id=$1 WHERE id=$2', [t.id, u.id]);
      await client.query(
        `INSERT INTO public.onboarding_progress (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`, [t.id]
      ).catch(() => {});
      return { user: u, tenant: t };
    });

    const token = await createToken(user.id);
    const tokenHash = await hashToken(token);
    await query(
      `INSERT INTO public.sessions (user_id, token_hash, expires_at) VALUES ($1,$2,now()+interval '30 days')`,
      [user.id, tokenHash]
    );
    await setSessionCookie(token);

    return NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, full_name: user.full_name, is_super_admin: true },
      tenant: { id: tenant.id, name: tenant.name },
    }, { status: 201 });
  } catch (err: any) {
    console.error('[setup/create-admin]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
