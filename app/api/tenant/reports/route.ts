/**
 * Reports & Export API
 * Generates report data for various CRM entities
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'contacts';
    const days = parseInt(searchParams.get('days') || '30');
    const tid = ctx.tenantId;

    // FIX MEDIUM-01: Use parameterized date filter instead of string interpolation
    const dateFilter = days > 0 ? `AND created_at >= now() - make_interval(days => $2)` : '';
    const params = days > 0 ? [tid, days] : [tid];

    switch (type) {
      case 'contacts': {
        const data = await queryMany<any>(
          `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.title, c.lead_status, c.lead_source, c.score, c.lifecycle_stage, c.company_name, c.city, c.country, c.created_at
           FROM public.contacts c
           WHERE c.tenant_id = $1 AND c.deleted_at IS NULL AND c.is_archived = false ${dateFilter}
           ORDER BY c.created_at DESC LIMIT 500`,
          params
        );
        return NextResponse.json({ data });
      }

      case 'deals': {
        const data = await queryMany<any>(
          `SELECT d.id, d.title, d.value, d.stage, d.probability, d.close_date, d.created_at, c.first_name, c.last_name, co.name AS company_name
           FROM public.deals d
           LEFT JOIN public.contacts c ON c.id = d.contact_id
           LEFT JOIN public.companies co ON co.id = d.company_id
           WHERE d.tenant_id = $1 AND d.deleted_at IS NULL ${dateFilter}
           ORDER BY d.created_at DESC LIMIT 500`,
          params
        );
        return NextResponse.json({ data });
      }

      case 'tasks': {
        const data = await queryMany<any>(
          `SELECT t.id, t.title, t.description, t.priority, t.status, t.due_date, t.completed, t.created_at,
                  c.first_name, c.last_name, u.full_name AS assigned_to
           FROM public.tasks t
           LEFT JOIN public.contacts c ON c.id = t.contact_id
           LEFT JOIN public.users u ON u.id = t.assigned_to
           WHERE t.tenant_id = $1 AND t.deleted_at IS NULL ${dateFilter}
           ORDER BY t.created_at DESC LIMIT 500`,
          params
        );
        return NextResponse.json({ data });
      }

      case 'activities': {
        const data = await queryMany<any>(
          `SELECT a.id, a.action, a.entity_type, a.description, a.created_at, u.full_name AS user_name
           FROM public.activities a
           LEFT JOIN public.users u ON u.id = a.user_id
           WHERE a.tenant_id = $1 ${dateFilter}
           ORDER BY a.created_at DESC LIMIT 500`,
          params
        );
        return NextResponse.json({ data });
      }

      case 'leads': {
        const data = await queryMany<any>(
          `SELECT l.id, l.first_name, l.last_name, l.email, l.phone, l.title, l.company_name, l.lead_status, l.lead_source, l.score, l.budget, l.created_at
           FROM public.leads l
           WHERE l.tenant_id = $1 AND l.deleted_at IS NULL ${dateFilter}
           ORDER BY l.created_at DESC LIMIT 500`,
          params
        );
        return NextResponse.json({ data });
      }

      case 'companies': {
        const data = await queryMany<any>(
          `SELECT c.id, c.name, c.industry, c.size, c.phone, c.website, c.address, c.status, c.created_at
           FROM public.companies c
           WHERE c.tenant_id = $1 AND c.deleted_at IS NULL ${dateFilter}
           ORDER BY c.created_at DESC LIMIT 500`,
          params
        );
        return NextResponse.json({ data });
      }

      case 'summary': {
        const p = days > 0 ? [tid, days] : [tid];
        const [contactsCount, leadsCount, dealsCount, tasksCount, companiesCount, activitiesCount] = await Promise.all([
          queryOne<{ count: string }>(
            `SELECT count(*)::text FROM public.contacts WHERE tenant_id=$1 AND deleted_at IS NULL AND is_archived=false ${dateFilter}`,
            p
          ),
          queryOne<{ count: string }>(
            `SELECT count(*)::text FROM public.leads WHERE tenant_id=$1 AND deleted_at IS NULL ${dateFilter}`,
            p
          ),
          queryOne<{ count: string; total_value: string }>(
            `SELECT count(*)::text, COALESCE(sum(value),0)::text as total_value FROM public.deals WHERE tenant_id=$1 AND deleted_at IS NULL ${dateFilter}`,
            p
          ),
          queryOne<{ count: string }>(
            `SELECT count(*)::text FROM public.tasks WHERE tenant_id=$1 AND deleted_at IS NULL ${dateFilter}`,
            p
          ),
          queryOne<{ count: string }>(
            `SELECT count(*)::text FROM public.companies WHERE tenant_id=$1 AND deleted_at IS NULL ${dateFilter}`,
            p
          ),
          queryOne<{ count: string }>(
            `SELECT count(*)::text FROM public.activities WHERE tenant_id=$1 ${dateFilter}`,
            p
          ),
        ]);

        const summary = {
          contacts: parseInt(contactsCount?.count || '0'),
          leads: parseInt(leadsCount?.count || '0'),
          deals: parseInt(dealsCount?.count || '0'),
          deal_value: parseFloat(dealsCount?.total_value || '0'),
          tasks: parseInt(tasksCount?.count || '0'),
          companies: parseInt(companiesCount?.count || '0'),
          activities: parseInt(activitiesCount?.count || '0'),
        };
        return NextResponse.json({ data: [summary] });
      }

      default:
        return NextResponse.json({ error: 'Unknown report type' }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
