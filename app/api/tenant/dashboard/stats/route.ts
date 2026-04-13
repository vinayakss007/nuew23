import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, queryMany } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;

    // Only query columns that actually exist in the database
    const [
      contactCount,
      companyCount,
      openDeals,
      wonThisMonth,
      recentActivities,
    ] = await Promise.all([
      // Contacts count
      queryOne<{ count: string }>(
        `SELECT count(*)::text as count FROM contacts WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tid]
      ),

      // Companies count (check if deleted_at exists first)
      queryOne<{ count: string }>(
        `SELECT count(*)::text as count FROM companies WHERE tenant_id = $1`,
        [tid]
      ),

      // Open deals
      queryOne<{ total: string; count: string }>(
        `SELECT COALESCE(SUM(value), 0)::text as total, count(*)::text as count 
         FROM deals WHERE tenant_id = $1 AND deleted_at IS NULL 
         AND stage NOT IN ('won', 'lost')`,
        [tid]
      ),

      // Won this month
      queryOne<{ total: string }>(
        `SELECT COALESCE(SUM(value), 0)::text as total 
         FROM deals WHERE tenant_id = $1 AND deleted_at IS NULL 
         AND stage = 'won' AND created_at >= date_trunc('month', now())`,
        [tid]
      ),

      // Recent activities
      queryMany<any>(
        `SELECT a.id, a.action, a.event_type, a.details, a.created_at,
                u.full_name
         FROM activities a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.tenant_id = $1
         ORDER BY a.created_at DESC
         LIMIT 10`,
        [tid]
      ),
    ]);

    // Get upcoming tasks
    let tasks: any[] = [];
    try {
      tasks = await queryMany<any>(
        `SELECT id, title, due_date, priority, status
         FROM tasks WHERE tenant_id = $1 AND completed = false
         AND deleted_at IS NULL
         ORDER BY due_date ASC LIMIT 5`,
        [tid]
      );
    } catch {
      tasks = [];
    }

    // Get deals by stage
    let dealsByStage: any[] = [];
    try {
      dealsByStage = await queryMany<any>(
        `SELECT stage, count(*)::int as count, COALESCE(SUM(value), 0)::text as total
         FROM deals WHERE tenant_id = $1 AND deleted_at IS NULL
         GROUP BY stage ORDER BY count DESC`,
        [tid]
      );
    } catch {
      dealsByStage = [];
    }

    const data = {
      contactCount: parseInt(contactCount?.count ?? '0'),
      companyCount: parseInt(companyCount?.count ?? '0'),
      pipeline: parseFloat(openDeals?.total ?? '0'),
      openDealsCount: parseInt(openDeals?.count ?? '0'),
      wonThisMonth: parseFloat(wonThisMonth?.total ?? '0'),
      activities: recentActivities ?? [],
      tasks: tasks ?? [],
      dealsByStage: dealsByStage ?? [],
    };

    return NextResponse.json({ data });
  } catch (err: any) {
    // FIX LOW-09: Return 200 with error indicator instead of 500
    // This allows the UI to distinguish between "no data" and "server error"
    console.error('[Dashboard Stats Error]', err);
    return NextResponse.json({
      data: {
        contactCount: 0,
        companyCount: 0,
        pipeline: 0,
        openDealsCount: 0,
        wonThisMonth: 0,
        activities: [],
        tasks: [],
        dealsByStage: [],
      },
      error: err.message ?? 'Failed to load dashboard',
      status: 'error'
    }, { status: 200 });
  }
}
