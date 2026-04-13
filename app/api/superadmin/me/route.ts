import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Super admin's own org (the one they created when they signed up)
    const ownTenant = await queryOne<any>(
      `SELECT id, name, slug, status, plan_id FROM public.tenants
       WHERE owner_id = $1 ORDER BY created_at ASC LIMIT 1`,
      [ctx.userId]
    );

    // Currently selected tenant (could be an impersonated one)
    const currentTenant = ctx.tenantId ? await queryOne<any>(
      `SELECT t.id, t.name, t.slug, t.status, t.plan_id,
              (SELECT count(*)::int FROM public.contacts WHERE tenant_id=t.id AND deleted_at IS NULL) as contacts_count
       FROM public.tenants t WHERE t.id = $1`,
      [ctx.tenantId]
    ) : null;

    return NextResponse.json({
      ok: true,
      userId: ctx.userId,
      // Own org — protected from suspension/deletion in UI
      ownTenantId: ownTenant?.id || null,
      ownTenantName: ownTenant?.name || null,
      // Currently active tenant context
      currentTenantId: currentTenant?.id || null,
      currentTenantName: currentTenant?.name || null,
      currentTenant,
      isImpersonating: currentTenant?.id !== ownTenant?.id && !!currentTenant,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
