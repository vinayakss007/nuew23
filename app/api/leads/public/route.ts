import { logError } from '@/lib/errors';
/**
 * Public lead capture endpoint — no auth required.
 * Accepts leads from embedded forms, landing pages, etc.
 * Requires tenant_id or api_key to route the lead to the correct org.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';
import { fireWebhooks } from '@/lib/webhooks';

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 20 lead submissions per IP per hour
    const limited = await checkRateLimit(request, { action: 'public_lead', max: 20, windowMinutes: 60 });
    if (limited) return limited;

    const body = await request.json();
    const {
      first_name,
      last_name,
      email,
      phone,
      company,
      message,
      source = 'Website Form',
      tenant_id,   // required — the org this lead belongs to
      form_id,     // optional — which form captured this lead
    } = body;

    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    if (!tenant_id) {
      return NextResponse.json({ error: 'tenant_id is required' }, { status: 400 });
    }

    // Verify tenant exists and is active
    const tenant = await queryOne<any>(
      `SELECT id, name, owner_id FROM public.tenants
       WHERE id = $1 AND status IN ('active', 'trialing')`,
      [tenant_id]
    );
    if (!tenant) {
      return NextResponse.json({ error: 'Invalid or inactive organization' }, { status: 404 });
    }

    // Check contact limit before inserting
    const limitCheck = await queryOne<any>(
      `SELECT t.current_contacts, p.max_contacts
       FROM public.tenants t JOIN public.plans p ON p.id = t.plan_id
       WHERE t.id = $1`,
      [tenant_id]
    );
    if (limitCheck?.max_contacts > 0 && limitCheck.current_contacts >= limitCheck.max_contacts) {
      // Still return success to the visitor, just don't insert
      return NextResponse.json({ ok: true, message: 'Thank you! We will be in touch.' });
    }

    // Look up or create company
    let company_id: string | null = null;
    if (company?.trim()) {
      const existingCo = await queryOne<any>(
        `SELECT id FROM public.companies WHERE tenant_id=$1 AND lower(name)=lower($2) LIMIT 1`,
        [tenant_id, company.trim()]
      );
      if (existingCo) {
        company_id = existingCo.id;
      } else {
        const { rows: [co] } = await query(
          `INSERT INTO public.companies (tenant_id, name, created_by)
           VALUES ($1, $2, NULL) RETURNING id`,
          [tenant_id, company.trim()]
        );
        company_id = co?.id ?? null;
      }
    }

    // Check for duplicate email — upsert into leads table
    const existing = await queryOne<any>(
      `SELECT id FROM public.leads WHERE tenant_id=$1 AND lower(email)=lower($2) AND deleted_at IS NULL`,
      [tenant_id, email.trim()]
    );

    let contactId: string;

    if (existing) {
      // Re-activate and update existing lead
      const { rows: [updated] } = await query(
        `UPDATE public.leads
         SET phone = COALESCE(NULLIF($1,''), phone),
             company_name = COALESCE(NULLIF($5,''), company_name),
             lead_status = CASE WHEN lead_status IN ('lost','unqualified') THEN 'new' ELSE lead_status END,
             form_submissions_count = form_submissions_count + 1,
             last_activity_at = now(),
             updated_at = now()
         WHERE id = $3 AND tenant_id = $4
         RETURNING id`,
        [phone?.trim() || null, null, existing.id, tenant_id, company?.trim() || null]
      );
      contactId = updated?.id ?? existing.id;
    } else {
      // Create new lead record
      const { rows: [lead] } = await query(
        `INSERT INTO public.leads
           (tenant_id, first_name, last_name, email, phone, company_name,
            lead_status, lead_source, notes, form_id, form_submissions_count,
            last_activity_at, created_by)
         VALUES ($1, $2, $3, lower($4), $5, $6, 'new', $7, $8, $9, 1, now(), NULL)
         RETURNING id`,
        [
          tenant_id,
          first_name?.trim() || null,
          last_name?.trim() || null,
          email.trim(),
          phone?.trim() || null,
          company?.trim() || null,
          source,
          message?.trim() || null,
          form_id || null,
        ]
      );
      contactId = lead?.id;

      // Log lead activity
      await query(
        `INSERT INTO public.lead_activities (tenant_id, lead_id, activity_type, description)
         VALUES ($1, $2, 'lead_created', $3)`,
        [tenant_id, contactId, `Lead captured via ${source}${form_id ? ` (form: ${form_id})` : ''}`]
      ).catch(() => {});
    }

    // Notify workspace owner about new lead
    if (tenant.owner_id && contactId) {
      await createNotification({
        userId: tenant.owner_id,
        tenantId: tenant_id,
        type: 'contact_assigned',
        title: `New lead: ${first_name || ''} ${last_name || email}`.trim(),
        body: `Via ${source}${message ? ` — "${message.slice(0, 80)}"` : ''}`,
        link: `/tenant/leads/${contactId}`,
      });
    }

    // Fire webhooks
    await fireWebhooks(tenant_id, 'contact.created', { // lead captured
      id: contactId, email: email.trim(),
      name: `${first_name || ''} ${last_name || ''}`.trim(),
      source,
    });

    return NextResponse.json({
      ok: true,
      lead_id: contactId,
      message: 'Thank you! We will be in touch.',
    }, { status: 201 });

  } catch (err: any) {
    logError({ error: err, context: 'leads/public' }).catch(()=>{});
    // Return generic success to visitor even on error
    return NextResponse.json({ ok: true, message: 'Thank you! We will be in touch.' });
  }
}

// GET — check if an email already exists in a workspace (for form validation)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email')?.trim().toLowerCase();
    const tenant_id = searchParams.get('tenant_id');

    if (!email || !tenant_id) {
      return NextResponse.json({ exists: false });
    }

    const contact = await queryOne<any>(
      'SELECT id FROM public.contacts WHERE tenant_id=$1 AND email=$2 AND is_archived=false',
      [tenant_id, email]
    );

    return NextResponse.json({ exists: !!contact });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
