import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/session';
import { queryOne } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const token = new URL(request.url).searchParams.get('token');
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });

    const inv = await queryOne<any>(
      `SELECT i.email, i.role_slug, i.expires_at,
              t.name as tenant_name, t.primary_color
       FROM public.invitations i
       JOIN public.tenants t ON t.id = i.tenant_id
       WHERE i.token = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
      [token]
    );
    if (!inv) return NextResponse.json({ error: 'Invitation not found or has expired' }, { status: 404 });

    // Check if already logged in with matching email
    let isLoggedIn = false;
    try {
      const cookieStore = await cookies();
      const sessionToken = cookieStore.get('nucrm_session')?.value;
      if (sessionToken) {
        const p = await verifyToken(sessionToken);
        if (p) {
          const u = await queryOne<any>('SELECT email FROM public.users WHERE id=$1', [p.userId]);
          isLoggedIn = u?.email?.toLowerCase() === inv.email.toLowerCase();
        }
      }
    } catch {}

    return NextResponse.json({
      email: inv.email, role_slug: inv.role_slug, expires_at: inv.expires_at,
      tenant_name: inv.tenant_name, primary_color: inv.primary_color, isLoggedIn,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
