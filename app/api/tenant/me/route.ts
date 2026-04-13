import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const user = await queryOne<any>(
      'SELECT id, email, full_name, avatar_url, is_super_admin, last_tenant_id, created_at FROM public.users WHERE id=$1',
      [ctx.userId]
    );
    return NextResponse.json({
      user_id: ctx.userId, tenant_id: ctx.tenantId, role_slug: ctx.roleSlug,
      permissions: ctx.permissions, is_admin: ctx.isAdmin, is_super_admin: ctx.isSuperAdmin,
      user,
    });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
