/**
 * Advanced Analytics API
 * Revenue forecast, conversion funnel, team performance, activity trends
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tid = ctx.tenantId;
    const { searchParams } = new URL(request.url);
    const metric = searchParams.get('metric') || 'overview';

    switch (metric) {
      case 'forecast': {
        // Monthly revenue trend (last 6 months)
        const monthly = await queryMany<any>(
          `SELECT
            to_char(created_at, 'YYYY-MM') as month,
            count(*)::int as total_deals,
            COALESCE(sum(value) FILTER (WHERE stage='won'), 0)::numeric as won_revenue,
            COALESCE(sum(value) FILTER (WHERE stage IN ('proposal','negotiation')), 0)::numeric as pipeline,
            count(*) FILTER (WHERE stage='won')::int as won_count,
            count(*) FILTER (WHERE stage='lost')::int as lost_count
           FROM public.deals
           WHERE tenant_id = $1 AND created_at >= now() - interval '6 months' AND deleted_at IS NULL
           GROUP BY to_char(created_at, 'YYYY-MM')
           ORDER BY month`,
          [tid]
        );

        // Simple forecast: average won revenue * 1.1 (10% growth)
        const avgMonthly = monthly.length > 0
          ? monthly.reduce((sum, m) => sum + parseFloat(m.won_revenue || '0'), 0) / monthly.length
          : 0;
        const forecast = Math.round(avgMonthly * 1.1);

        return NextResponse.json({ monthly, forecast, avgMonthly: Math.round(avgMonthly) });
      }

      case 'funnel': {
        // Lead to deal conversion funnel
        const [leadsTotal, contactsFromLeads, dealsCreated, dealsWon] = await Promise.all([
          queryOne<{ count: string }>(
            `SELECT count(*)::text FROM public.leads WHERE tenant_id=$1 AND deleted_at IS NULL`,
            [tid]
          ),
          queryOne<{ count: string }>(
            `SELECT count(*)::text FROM public.leads WHERE tenant_id=$1 AND converted_to_contact_id IS NOT NULL AND deleted_at IS NULL`,
            [tid]
          ),
          queryOne<{ count: string }>(
            `SELECT count(*)::text FROM public.deals WHERE tenant_id=$1 AND deleted_at IS NULL`,
            [tid]
          ),
          queryOne<{ count: string }>(
            `SELECT count(*)::text FROM public.deals WHERE tenant_id=$1 AND stage='won' AND deleted_at IS NULL`,
            [tid]
          ),
        ]);

        const funnel = [
          { stage: 'Leads Generated', count: parseInt(leadsTotal?.count || '0'), color: '#7c3aed' },
          { stage: 'Converted to Contact', count: parseInt(contactsFromLeads?.count || '0'), color: '#4f46e5' },
          { stage: 'Deals Created', count: parseInt(dealsCreated?.count || '0'), color: '#0ea5e9' },
          { stage: 'Deals Won', count: parseInt(dealsWon?.count || '0'), color: '#10b981' },
        ].filter(f => f.count > 0);

        return NextResponse.json({ funnel });
      }

      case 'team': {
        // FIX HIGH-07: Replace 6N correlated subqueries with single query using CTEs
        const teamPerformance = await queryMany<any>(
          `WITH leads_agg AS (
            SELECT assigned_to, count(*)::int as leads_assigned
            FROM public.leads WHERE tenant_id = $1 AND deleted_at IS NULL
            GROUP BY assigned_to
          ),
          contacts_agg AS (
            SELECT assigned_to, count(*)::int as contacts_assigned
            FROM public.contacts WHERE tenant_id = $1 AND deleted_at IS NULL AND is_archived = false
            GROUP BY assigned_to
          ),
          deals_agg AS (
            SELECT assigned_to,
                   count(*) FILTER (WHERE stage = 'won')::int as deals_won,
                   COALESCE(sum(value) FILTER (WHERE stage = 'won'), 0)::numeric as revenue_won
            FROM public.deals WHERE tenant_id = $1 AND deleted_at IS NULL
            GROUP BY assigned_to
          ),
          tasks_agg AS (
            SELECT assigned_to, count(*)::int as tasks_completed
            FROM public.tasks WHERE tenant_id = $1 AND deleted_at IS NULL AND completed = true
            GROUP BY assigned_to
          ),
          activities_agg AS (
            SELECT user_id, count(*)::int as activities_logged
            FROM public.activities WHERE tenant_id = $1
            GROUP BY user_id
          )
          SELECT
            u.id, u.full_name, u.email, u.avatar_url,
            COALESCE(l.leads_assigned, 0) as leads_assigned,
            COALESCE(c.contacts_assigned, 0) as contacts_assigned,
            COALESCE(d.deals_won, 0) as deals_won,
            COALESCE(d.revenue_won, 0) as revenue_won,
            COALESCE(t.tasks_completed, 0) as tasks_completed,
            COALESCE(a.activities_logged, 0) as activities_logged
           FROM public.tenant_members tm
           JOIN public.users u ON u.id = tm.user_id
           LEFT JOIN leads_agg l ON l.assigned_to = u.id
           LEFT JOIN contacts_agg c ON c.assigned_to = u.id
           LEFT JOIN deals_agg d ON d.assigned_to = u.id
           LEFT JOIN tasks_agg t ON t.assigned_to = u.id
           LEFT JOIN activities_agg a ON a.user_id = u.id
           WHERE tm.tenant_id = $1 AND tm.status = 'active'
           ORDER BY revenue_won DESC NULLS LAST`,
          [tid]
        );

        return NextResponse.json({ team: teamPerformance });
      }

      case 'activity_trend': {
        // Daily activity for last 30 days
        const daily = await queryMany<any>(
          `SELECT
            to_char(a.created_at, 'YYYY-MM-DD') as day,
            count(*)::int as total,
            count(*) FILTER (WHERE a.action LIKE '%contact%')::int as contact_actions,
            count(*) FILTER (WHERE a.action LIKE '%deal%')::int as deal_actions,
            count(*) FILTER (WHERE a.action LIKE '%lead%')::int as lead_actions,
            count(*) FILTER (WHERE a.action LIKE '%task%')::int as task_actions
           FROM public.activities a
           WHERE a.tenant_id = $1 AND a.created_at >= now() - interval '30 days'
           GROUP BY to_char(a.created_at, 'YYYY-MM-DD')
           ORDER BY day`,
          [tid]
        );

        return NextResponse.json({ daily });
      }

      case 'top_deals': {
        const topDeals = await queryMany<any>(
          `SELECT d.id, d.title, d.value, d.stage, d.close_date, d.created_at,
                  c.first_name, c.last_name, co.name AS company_name,
                  u.full_name AS assigned_name
           FROM public.deals d
           LEFT JOIN public.contacts c ON c.id = d.contact_id
           LEFT JOIN public.companies co ON co.id = d.company_id
           LEFT JOIN public.users u ON u.id = d.assigned_to
           WHERE d.tenant_id = $1 AND d.deleted_at IS NULL AND d.stage NOT IN ('won','lost')
           ORDER BY d.value DESC NULLS LAST
           LIMIT 10`,
          [tid]
        );

        return NextResponse.json({ deals: topDeals });
      }

      case 'recent_activities': {
        const activities = await queryMany<any>(
          `SELECT a.id, a.action, a.entity_type, a.description, a.metadata, a.created_at,
                  u.full_name AS user_name, u.avatar_url
           FROM public.activities a
           LEFT JOIN public.users u ON u.id = a.user_id
           WHERE a.tenant_id = $1
           ORDER BY a.created_at DESC
           LIMIT 50`,
          [tid]
        );

        return NextResponse.json({ activities });
      }

      default:
        return NextResponse.json({ error: 'Unknown metric' }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
