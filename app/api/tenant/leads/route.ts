import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';
import { logAudit } from '@/lib/audit';

// Whitelist for sort columns to prevent SQL injection
const ALLOWED_SORT_COLUMNS = new Set([
  'created_at', 'updated_at', 'last_activity_at', 'first_name',
  'last_name', 'email', 'company_name', 'lead_status', 'score',
  'lifecycle_stage', 'budget',
]);

// GET /api/tenant/leads - List leads with filtering and pagination
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);

    const limit  = Math.min(200, Math.max(1, parseInt(searchParams.get('limit')  ?? '50')));
    const offset = Math.max(0,                parseInt(searchParams.get('offset') ?? '0'));
    const q              = searchParams.get('q')?.trim() ?? '';
    const leadStatus     = searchParams.get('lead_status') ?? '';
    const lifecycleStage = searchParams.get('lifecycle_stage') ?? '';
    const assignedTo     = searchParams.get('assigned_to') ?? '';

    // FIX: whitelist sort column to prevent SQL injection
    const rawSortBy = searchParams.get('sort_by') ?? 'created_at';
    const sortBy    = ALLOWED_SORT_COLUMNS.has(rawSortBy) ? rawSortBy : 'created_at';
    const sortOrder = searchParams.get('sort_order') === 'ASC' ? 'ASC' : 'DESC';

    const conditions: string[] = ['l.deleted_at IS NULL', 'l.tenant_id = $1'];
    const params: any[]        = [ctx.tenantId];
    let   pi = 2;

    const canViewAll = ctx.isAdmin || ctx.permissions?.['all'] || ctx.permissions?.['leads.view_all'];
    if (!canViewAll) {
      conditions.push(`(l.assigned_to = $${pi} OR l.created_by = $${pi})`);
      params.push(ctx.userId);
      pi++;
    }

    if (leadStatus) {
      conditions.push(`l.lead_status = $${pi}`);
      params.push(leadStatus); pi++;
    }
    if (lifecycleStage) {
      conditions.push(`l.lifecycle_stage = $${pi}`);
      params.push(lifecycleStage); pi++;
    }
    if (assignedTo) {
      conditions.push(`l.assigned_to = $${pi}`);
      params.push(assignedTo); pi++;
    }

    if (q) {
      // FIX: separate params — plainto_tsquery needs raw text, ILIKE needs %wildcards%
      conditions.push(`(
        l.search_vector @@ plainto_tsquery('english', $${pi})
        OR l.first_name   ILIKE $${pi + 1}
        OR l.last_name    ILIKE $${pi + 1}
        OR l.email        ILIKE $${pi + 1}
        OR l.company_name ILIKE $${pi + 1}
      )`);
      params.push(q);        // raw text for tsquery
      params.push(`%${q}%`); // wildcard for ILIKE
      pi += 2;
    }

    const whereClause = conditions.join(' AND ');

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.leads l WHERE ${whereClause}`,
      params
    );
    const total = parseInt(countResult?.count ?? '0', 10);

    const leads = await queryMany<any>(
      `SELECT
        l.id, l.first_name, l.last_name, l.email, l.phone, l.mobile,
        l.title, l.company_name, l.lead_status, l.lead_source, l.score,
        l.lifecycle_stage, l.budget, l.timeline, l.authority_level,
        l.assigned_to, l.last_activity_at, l.created_at, l.updated_at,
        l.tags, l.country, l.city, l.linkedin_url,
        u.full_name  AS assigned_name,
        u.avatar_url AS assigned_avatar
      FROM public.leads l
      LEFT JOIN public.users u ON u.id = l.assigned_to
      WHERE ${whereClause}
      ORDER BY
        CASE WHEN l."${sortBy}" IS NULL THEN 1 ELSE 0 END,
        l."${sortBy}" ${sortOrder}
      LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    );

    return NextResponse.json({
      data: leads,
      total,
      limit,
      offset,
      hasMore: offset + leads.length < total,
    });
  } catch (error: any) {
    console.error('[leads GET]', error);
    return NextResponse.json({ error: 'Failed to fetch leads' }, { status: 500 });
  }
}

// POST /api/tenant/leads - Create a new lead
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'leads.create');
    if (deny) return deny;

    const body = await request.json();

    if (!body.first_name?.trim())
      return NextResponse.json({ error: 'first_name is required' }, { status: 400 });
    if (body.first_name.trim().length > 100)
      return NextResponse.json({ error: 'first_name is too long (max 100 chars)' }, { status: 400 });
    if (!body.email?.trim())
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()))
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });

    const existing = await queryOne<any>(
      `SELECT id, first_name, last_name, email
       FROM public.leads
       WHERE tenant_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL`,
      [ctx.tenantId, body.email.trim()]
    );
    if (existing) {
      return NextResponse.json(
        { error: 'A lead with this email already exists', is_duplicate: true, duplicate_id: existing.id, duplicate: existing },
        { status: 409 }
      );
    }

    // Plan limit check
    const tenantRow = await queryOne<any>(
      `SELECT t.current_contacts, p.max_contacts FROM public.tenants t
       JOIN public.plans p ON p.id = t.plan_id WHERE t.id = $1`,
      [ctx.tenantId]
    );
    if (tenantRow?.max_contacts > 0 && tenantRow.current_contacts >= tenantRow.max_contacts) {
      return NextResponse.json(
        { error: `Lead limit reached (${tenantRow.max_contacts}). Upgrade your plan.`, limit_exceeded: true },
        { status: 403 }
      );
    }

    const result = await queryOne<any>(
      `INSERT INTO public.leads (
        tenant_id, first_name, last_name, email, phone, mobile,
        title, company_name, company_size, company_industry,
        lead_source, lead_status, lifecycle_stage,
        budget, budget_currency, authority_level, need_description, timeline, timeline_target_date,
        country, state, city, address_line1, postal_code,
        linkedin_url, twitter_handle, website,
        utm_source, utm_medium, utm_campaign,
        assigned_to, created_by, owner_id,
        tags, notes, internal_notes, custom_fields
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
        $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37
      ) RETURNING *`,
      [
        ctx.tenantId,
        body.first_name.trim(),
        body.last_name?.trim()              || null,
        body.email.toLowerCase().trim(),
        body.phone?.trim()                  || null,
        body.mobile?.trim()                 || null,
        body.title?.trim()                  || null,
        body.company_name?.trim()           || null,
        body.company_size                   || null,
        body.company_industry               || null,
        body.lead_source                    || 'website',
        body.lead_status                    || 'new',
        body.lifecycle_stage                || 'lead',
        body.budget                         || null,
        body.budget_currency                || 'USD',
        body.authority_level                || 'unknown',
        body.need_description?.slice(0, 2000) || null,
        body.timeline                       || null,
        body.timeline_target_date           || null,
        body.country?.trim()                || null,
        body.state?.trim()                  || null,
        body.city?.trim()                   || null,
        body.address_line1?.trim()          || null,
        body.postal_code?.trim()            || null,
        body.linkedin_url?.trim()           || null,
        body.twitter_handle?.trim()         || null,
        body.website?.trim()                || null,
        body.utm_source                     || null,
        body.utm_medium                     || null,
        body.utm_campaign                   || null,
        body.assigned_to                    || ctx.userId,
        ctx.userId,
        body.owner_id                       || ctx.userId,
        body.tags                           || [],
        body.notes?.slice(0, 5000)          || null,
        body.internal_notes?.slice(0, 5000) || null,
        body.custom_fields                  || {},
      ]
    );

    await query(
      `INSERT INTO public.lead_activities (tenant_id, lead_id, performed_by, activity_type, description, activity_data)
       VALUES ($1, $2, $3, 'created', 'Lead created', '{}')`,
      [ctx.tenantId, result?.id, ctx.userId]
    );

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'create', resourceType: 'lead', resourceId: result?.id,
      newData: { email: body.email, name: `${body.first_name} ${body.last_name ?? ''}`.trim() },
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error('[leads POST]', error);
    return NextResponse.json({ error: 'Failed to create lead' }, { status: 500 });
  }
}
