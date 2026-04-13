import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query, queryOne } from '@/lib/db/client';
import { createToken, setSessionCookie } from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    
    const { userId, tenantId, reason } = await request.json();
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

    // If userId not provided, find the admin user of the tenant
    let targetUserId = userId;
    let targetUser: any;
    if (targetUserId) {
      targetUser = await queryOne<any>(
        'SELECT id, email, full_name FROM public.users WHERE id = $1',
        [targetUserId]
      );
      if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    } else {
      // Find the admin member of the tenant
      const adminMember = await queryOne<any>(
        `SELECT u.id, u.email, u.full_name
         FROM public.tenant_members tm
         JOIN public.users u ON u.id = tm.user_id
         WHERE tm.tenant_id = $1 AND tm.status = 'active'
         ORDER BY tm.role_slug, tm.joined_at LIMIT 1`,
        [tenantId]
      );
      if (!adminMember) return NextResponse.json({ error: 'No active user found in this tenant' }, { status: 404 });
      targetUserId = adminMember.id;
      targetUser = adminMember;
    }

    // Ensure super admin is a member of the target tenant (add them if not)
    const member = await queryOne<any>(
      'SELECT id FROM public.tenant_members WHERE tenant_id=$1 AND user_id=$2',
      [tenantId, ctx.userId]
    );
    if (!member) {
      const adminRole = await queryOne<any>(
        'SELECT id FROM public.roles WHERE tenant_id=$1 AND slug=$2', [tenantId, 'admin']
      );
      await query(
        `INSERT INTO public.tenant_members (tenant_id,user_id,role_slug,role_id,status,joined_at)
         VALUES ($1,$2,'admin',$3,'active',now())`,
        [tenantId, ctx.userId, adminRole?.id||null]
      );
    } else {
      // Ensure they're active with admin role
      await query(
        "UPDATE public.tenant_members SET status='active', role_slug='admin' WHERE id=$1",
        [member.id]
      );
    }

    // Start impersonation session (creates DB record + audit log)
    const { rows: [session] } = await query(
      `SELECT public.start_impersonation($1, $2, $3, $4, $5, $6) as session_id`,
      [ctx.userId, userId, tenantId, request.headers.get('x-forwarded-for')?.split(',')[0] || null, (request.headers.get('user-agent') || '').slice(0, 255), reason || null]
    );

    // Update last tenant
    await query('UPDATE public.users SET last_tenant_id=$1 WHERE id=$2', [tenantId, ctx.userId]);

    // Create session token for impersonated user
    const token = await createToken(targetUserId);
    const response = NextResponse.json({
      ok: true,
      sessionId: session?.session_id,
      message: `Impersonating ${targetUser.full_name || targetUser.email}`,
      token,
    });
    await setSessionCookie(token);
    return response;
  } catch (err: any) { 
    console.error('[Impersonation] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 }); 
  }
}
