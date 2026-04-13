import { fireWebhooks } from '@/lib/webhooks';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryMany, queryOne, buildInsert, query } from '@/lib/db/client';
import { logAudit } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';

function canViewAll(ctx: any) {
  return ctx.isAdmin || ctx.permissions?.['all'] || ctx.permissions?.['contacts.view_all'];
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0'));
    const limit  = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50')));
    const search = searchParams.get('q')?.trim();
    const leadStatus = searchParams.get('lead_status');
    const companyId  = searchParams.get('company_id');

    const params: any[] = [ctx.tenantId];
    let where = `c.tenant_id = $1 AND c.is_archived = false AND c.deleted_at IS NULL`;

    if (!canViewAll(ctx)) {
      params.push(ctx.userId);
      where += ` AND (c.assigned_to = $${params.length} OR c.created_by = $${params.length})`;
    }
    if (search) {
      // Use full-text search_vector for speed on large tenants, fall back to ILIKE
      params.push(search);          // raw text for tsquery
      params.push(`%${search}%`);   // wildcard for ILIKE fallback
      const tsN  = params.length - 1;
      const likeN = params.length;
      where += ` AND (
        c.search_vector @@ plainto_tsquery('english', $${tsN})
        OR c.first_name ILIKE $${likeN}
        OR c.last_name  ILIKE $${likeN}
        OR c.email      ILIKE $${likeN}
        OR c.phone      ILIKE $${likeN}
      )`;
    }
    if (leadStatus) { params.push(leadStatus); where += ` AND c.lead_status = $${params.length}`; }
    if (companyId)  { params.push(companyId);  where += ` AND c.company_id  = $${params.length}`; }

    const countRes = await query<{ count: string }>(
      `SELECT count(*)::int as count FROM public.contacts c WHERE ${where}`, params
    );
    const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

    params.push(limit, offset);
    const data = await queryMany(
      `SELECT c.*, co.name AS company_name, u.full_name AS assigned_name
       FROM public.contacts c
       LEFT JOIN public.companies co ON co.id = c.company_id
       LEFT JOIN public.users u ON u.id = c.assigned_to
       WHERE ${where}
       ORDER BY c.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return NextResponse.json({ data, total, offset, limit });
  } catch (err: any) {
    console.error('[contacts GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // FIX MEDIUM-03: Add rate limiting to prevent abuse
    const limited = await checkRateLimit(request, { action:'contacts_create', max:100, windowMinutes:60 });
    if (limited) return limited;
    const deny = requirePerm(ctx, 'contacts.create');
    if (deny) return deny;

    const body = await request.json();

    // Validation - FIX MEDIUM-12: Add comprehensive input validation
    if (!body.first_name?.trim()) {
      return NextResponse.json({ error: 'first_name is required' }, { status: 400 });
    }
    if (body.first_name.trim().length > 100) {
      return NextResponse.json({ error: 'first_name is too long (max 100 chars)' }, { status: 400 });
    }
    if (body.last_name && body.last_name.length > 100) {
      return NextResponse.json({ error: 'last_name is too long (max 100 chars)' }, { status: 400 });
    }
    if (body.email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    // Validate phone format if provided
    if (body.phone && !/^[+]?[\d\s\-().]{7,20}$/.test(body.phone)) {
      return NextResponse.json({ error: 'Invalid phone number format' }, { status: 400 });
    }
    // Validate URLs
    const urlFields = ['website', 'linkedin_url', 'twitter_url'];
    for (const field of urlFields) {
      if (body[field]) {
        try {
          new URL(body[field]);
        } catch {
          return NextResponse.json({ error: `Invalid URL in ${field}` }, { status: 400 });
        }
      }
    }
    // Validate score range
    if (body.score !== undefined && body.score !== null) {
      const score = Number(body.score);
      if (isNaN(score) || score < 0 || score > 100) {
        return NextResponse.json({ error: 'Score must be between 0 and 100' }, { status: 400 });
      }
    }
    // Validate notes length
    if (body.notes && body.notes.length > 10000) {
      return NextResponse.json({ error: 'Notes too long (max 10,000 chars)' }, { status: 400 });
    }

    // Check for duplicate email
    if (body.email?.trim()) {
      const existing = await queryOne<any>(
        `SELECT id, first_name, last_name FROM public.contacts
         WHERE tenant_id=$1 AND email=lower($2) AND is_archived=false`,
        [ctx.tenantId, body.email.trim()]
      );
      if (existing) {
        return NextResponse.json({
          error: `A contact with email ${body.email} already exists: ${existing.first_name} ${existing.last_name}`,
          duplicate_id: existing.id,
          is_duplicate: true,
        }, { status: 409 });
      }
    }

    // Check plan contact limits
    const tenantRow = await queryOne<any>(
      `SELECT t.current_contacts, p.max_contacts FROM public.tenants t
       JOIN public.plans p ON p.id=t.plan_id WHERE t.id=$1`, [ctx.tenantId]
    );
    if (tenantRow?.max_contacts > 0 && tenantRow.current_contacts >= tenantRow.max_contacts) {
      return NextResponse.json({
        error: `Contact limit reached (${tenantRow.max_contacts}). Upgrade your plan to add more contacts.`,
        limit_exceeded: true,
      }, { status: 403 });
    }

    const { sql, values } = buildInsert('contacts', {
      first_name:    body.first_name.trim(),
      last_name:     body.last_name?.trim()           ?? '',
      email:         body.email?.toLowerCase().trim() ?? null,
      phone:         body.phone?.trim()               ?? null,
      company_id:    body.company_id                  || null,
      assigned_to:   body.assigned_to                 || ctx.userId,
      lead_status:   body.lead_status                 ?? 'new',
      lead_source:   body.lead_source                 ?? null,
      notes:         body.notes?.slice(0, 5000)       ?? null,
      tags:          body.tags                        ?? [],
      score:         body.score                       ?? 0,
      city:          body.city?.trim()                ?? null,
      country:       body.country?.trim()             ?? null,
      website:       body.website?.trim()             ?? null,
      linkedin_url:  body.linkedin_url?.trim()        ?? null,
      twitter_url:   body.twitter_url?.trim()         ?? null,
      custom_fields: body.custom_fields               ?? {},
      tenant_id:     ctx.tenantId,
      created_by:    ctx.userId,
    });
    const contact = await queryOne(sql, values);

    // Activity log
    await query(
      `INSERT INTO public.activities (tenant_id, user_id, contact_id, type, description)
       VALUES ($1,$2,$3,'contact_created',$4)`,
      [ctx.tenantId, ctx.userId, contact?.id,
       `Created contact ${body.first_name} ${body.last_name ?? ''}`.trim()]
    );

    // Audit log
    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'create', resourceType:'contact', resourceId: contact?.id as string, newData: { email: body.email, name: `${body.first_name} ${body.last_name}` } });

    await fireWebhooks(ctx.tenantId, 'contact.created', { id: contact?.id, email: body.email, name: `${body.first_name} ${body.last_name}` });
    // WORKFLOW-C: trigger automation rules for contact.created (non-blocking)
    const { evaluateAutomations } = await import('@/lib/automation/engine');
    evaluateAutomations({
      tenantId: ctx.tenantId, userId: ctx.userId,
      event: 'contact.created', data: { ...(contact as any) },
    }).catch(() => {});
    return NextResponse.json({ data: contact }, { status: 201 });
  } catch (err: any) {
    console.error('[contacts POST]', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}
