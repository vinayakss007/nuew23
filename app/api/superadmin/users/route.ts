import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';
import { hashPassword, validatePassword } from '@/lib/auth/session';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error:'Forbidden' }, { status:403 });
    const q = new URL(request.url).searchParams.get('q');
    const params: any[] = [];
    let where = '1=1';
    if (q) { params.push(`%${q}%`); where += ` AND (u.email ILIKE $1 OR u.full_name ILIKE $1)`; }
    const data = await queryMany(
      `SELECT u.id, u.email, u.full_name, u.is_super_admin, u.email_verified, u.created_at,
              coalesce(json_agg(json_build_object('tenant_name',t.name,'role_slug',tm.role_slug,'plan',t.plan_id))
                FILTER (WHERE tm.id IS NOT NULL),'[]') as memberships
       FROM public.users u
       LEFT JOIN public.tenant_members tm ON tm.user_id=u.id AND tm.status='active'
       LEFT JOIN public.tenants t ON t.id=tm.tenant_id
       WHERE ${where}
       GROUP BY u.id ORDER BY u.created_at DESC LIMIT 200`,
      params
    );
    return NextResponse.json({ data });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error:'Forbidden' }, { status:403 });
    const { email, full_name, password, is_super_admin=false } = await request.json();
    if (!email?.trim() || !password) return NextResponse.json({ error:'email and password required' }, { status:400 });
    // FIX HIGH-14: Use same password policy as main signup (12+ chars, uppercase, number, special char)
    const pwErr = validatePassword(password);
    if (pwErr) return NextResponse.json({ error: pwErr }, { status:400 });
    const passwordHash = await hashPassword(password);
    const { rows:[user] } = await query(
      `INSERT INTO public.users (email,full_name,password_hash,is_super_admin,email_verified)
       VALUES (lower($1),$2,$3,$4,true) RETURNING id,email,full_name,is_super_admin`,
      [email.trim(), full_name?.trim()||null, passwordHash, is_super_admin]
    );
    return NextResponse.json({ data:user }, { status:201 });
  } catch (err:any) {
    if (err.code==='23505') return NextResponse.json({ error:'Email already exists' }, { status:409 });
    return NextResponse.json({ error:err.message }, { status:500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error:'Forbidden' }, { status:403 });
    const { userId, is_super_admin, revoke_sessions, transfer_super } = await request.json();
    if (!userId) return NextResponse.json({ error:'userId required' }, { status:400 });

    if (revoke_sessions) {
      await query('DELETE FROM public.sessions WHERE user_id=$1', [userId]);
      return NextResponse.json({ ok:true });
    }

    // Transfer super admin to another user
    if (transfer_super && is_super_admin === true && userId !== ctx.userId) {
      await query('UPDATE public.users SET is_super_admin=true WHERE id=$1', [userId]);
      await query('UPDATE public.users SET is_super_admin=false WHERE id=$1', [ctx.userId]);
      return NextResponse.json({ ok:true, message:'Super admin transferred. You are now a regular user.' });
    }

    // Block removing super admin status
    if (is_super_admin !== undefined) {
      return NextResponse.json({ error:'Cannot remove super admin status. Use transfer to give it to another user instead.' }, { status:403 });
    }
    return NextResponse.json({ error:'Nothing to update' }, { status:400 });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}

// DELETE is permanently blocked — super admin cannot be deleted, only transferred
export async function DELETE(_request: NextRequest) {
  return NextResponse.json({ error:'Super admin accounts cannot be deleted. Transfer super admin status to another user first.' }, { status:403 });
}
