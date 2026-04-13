import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/session';
import { queryOne, query, withTransaction } from '@/lib/db/client';

export async function POST(request: NextRequest) {
  try {
    // Get current user from session
    const cookieStore = await cookies();
    const token = cookieStore.get('nucrm_session')?.value;
    if (!token) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const payload = await verifyToken(token);
    if (!payload) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const { token: inviteToken } = await request.json();
    if (!inviteToken) return NextResponse.json({ error: 'Invitation token required' }, { status: 400 });

    const inv = await queryOne<any>(
      `SELECT i.*, t.name as tenant_name
       FROM public.invitations i
       JOIN public.tenants t ON t.id = i.tenant_id
       WHERE i.token = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
      [inviteToken]
    );
    if (!inv) return NextResponse.json({ error: 'Invitation not found or expired' }, { status: 404 });

    const user = await queryOne<any>('SELECT email FROM public.users WHERE id=$1', [payload.userId]);
    if (!user || user.email.toLowerCase() !== inv.email.toLowerCase()) {
      return NextResponse.json({ error: 'This invitation is for a different email address' }, { status: 403 });
    }

    await withTransaction(async (client) => {
      const { rows:[role] } = await client.query(
        'SELECT id FROM public.roles WHERE tenant_id=$1 AND slug=$2',
        [inv.tenant_id, inv.role_slug]
      );
      await client.query(
        `INSERT INTO public.tenant_members (tenant_id,user_id,role_slug,role_id,status,invited_by,joined_at)
         VALUES ($1,$2,$3,$4,'active',$5,now())
         ON CONFLICT (tenant_id,user_id) DO UPDATE
           SET role_slug=$3, role_id=$4, status='active', joined_at=now()`,
        [inv.tenant_id, payload.userId, inv.role_slug, role?.id||null, inv.invited_by]
      );
      await client.query('UPDATE public.invitations SET accepted_at=now() WHERE id=$1', [inv.id]);
      await client.query('UPDATE public.users SET last_tenant_id=$1 WHERE id=$2', [inv.tenant_id, payload.userId]);
      await client.query(
        `UPDATE public.tenants SET current_users=(
           SELECT count(*) FROM public.tenant_members WHERE tenant_id=$1 AND status='active'
         ) WHERE id=$1`,
        [inv.tenant_id]
      );
    });

    return NextResponse.json({ ok: true, tenant_name: inv.tenant_name });
  } catch (err: any) {
    console.error('[accept-invite]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
