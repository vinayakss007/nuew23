import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, queryMany } from '@/lib/db/client';
import { logError } from '@/lib/errors';

/**
 * Super Admin Platform Stats API
 * Returns all platform statistics in a single request
 * Cached on client-side for 2 minutes
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Verify super admin
    const user = await queryOne<any>(
      'SELECT is_super_admin FROM public.users WHERE id = $1',
      [ctx.userId]
    );
    
    if (!user?.is_super_admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const [stats, recentTenants, recentErrors, recentActivity, expiringSoon, platformUsage] = await Promise.all([
      queryOne<any>('SELECT public.platform_stats() as data').catch(() => ({ data: {} })),
      queryMany<any>(
        `SELECT t.id, t.name, t.plan_id, t.status, t.created_at, t.trial_ends_at,
                p.price_monthly, u.email as owner_email
         FROM public.tenants t
         JOIN public.plans p ON p.id = t.plan_id
         LEFT JOIN public.users u ON u.id = t.owner_id
         ORDER BY t.created_at DESC LIMIT 6`
      ).catch(() => []),
      queryMany<any>(
        `SELECT level, message, created_at FROM public.error_logs
         WHERE resolved = false AND level IN ('error','fatal')
         ORDER BY created_at DESC LIMIT 5`
      ).catch(() => []),
      queryMany<any>(
        `SELECT 'tenant_created' as type, t.name, t.created_at
         FROM public.tenants t WHERE t.created_at > now()-interval '7 days'
         ORDER BY t.created_at DESC LIMIT 8`
      ).catch(() => []),
      queryMany<any>(
        `SELECT id, name, trial_ends_at,
                EXTRACT(day FROM trial_ends_at - now())::int as days_left
         FROM public.tenants
         WHERE status = 'trialing' AND trial_ends_at BETWEEN now() AND now()+interval '3 days'
         ORDER BY trial_ends_at ASC`
      ).catch(() => []),
      queryOne<any>(
        `SELECT COUNT(*)::int as total_tenants,
                COUNT(*) FILTER (WHERE status = 'active') as active_tenants,
                COUNT(*) FILTER (WHERE status = 'trialing') as trialing_tenants,
                COUNT(*) FILTER (WHERE status = 'suspended') as suspended_tenants
         FROM public.tenants`
      ).catch(() => ({})),
    ]);

    const s = stats?.data ?? {};
    const mrr = Number(s.mrr ?? 0);

    const response = {
      mrr,
      arr: mrr * 12,
      activeTenants: s.active_tenants ?? 0,
      totalTenants: platformUsage?.total_tenants ?? 0,
      trialingTenants: s.trialing ?? 0,
      totalUsers: s.total_users ?? 0,
      unresolvedErrors: recentErrors.length,
      recentTenants,
      recentErrors,
      recentActivity,
      expiringSoon,
      platformUsage: {
        total: platformUsage?.total_tenants ?? 0,
        active: platformUsage?.active_tenants ?? 0,
        trialing: platformUsage?.trialing_tenants ?? 0,
        suspended: platformUsage?.suspended_tenants ?? 0,
      },
    };

    return NextResponse.json({ data: response });
  } catch (err: any) {
    logError({ error: err, context: 'superadmin stats API' }).catch(() => {});
    return NextResponse.json({ error: 'Failed to fetch platform stats' }, { status: 500 });
  }
}
