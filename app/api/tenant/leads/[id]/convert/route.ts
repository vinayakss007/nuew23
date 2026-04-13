/**
 * POST /api/tenant/leads/[id]/convert
 *
 * Converts a lead → contact, optionally creates a linked deal.
 * Marks the lead as converted and stores the resulting contact_id.
 *
 * Body (all optional except none required):
 *   create_deal?:    boolean        — also create a deal for the new contact
 *   deal_title?:     string         — defaults to lead's company or full name
 *   deal_value?:     number         — deal value in cents
 *   deal_stage?:     string         — defaults to 'qualified'
 *   pipeline_id?:    string         — pipeline to attach deal to
 *   assigned_to?:    string (uuid)  — override assignee for contact + deal
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { can } from '@/lib/auth/middleware';
import { queryOne, withTransaction, query } from '@/lib/db/client';
import { logAudit } from '@/lib/audit';
import { fireWebhooks } from '@/lib/webhooks';
import { createNotification } from '@/lib/notifications';

export async function POST(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    if (!can(ctx, 'leads.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const {
      create_deal    = false,
      deal_title,
      deal_value     = 0,
      deal_stage     = 'qualified',
      pipeline_id,
      assigned_to,
    } = body;

    // Load the lead
    const lead = await queryOne<any>(
      `SELECT * FROM public.leads WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [id, ctx.tenantId]
    );
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }
    if (lead.lead_status === 'converted' && lead.converted_to_contact_id) {
      return NextResponse.json({
        error: 'Lead already converted',
        contact_id: lead.converted_to_contact_id,
      }, { status: 409 });
    }

    const assignee = assigned_to || lead.assigned_to || ctx.userId;

    const result = await withTransaction(async (client) => {
      // ── 1. Upsert company if lead has company_name ──────────────────
      let companyId: string | null = null;
      if (lead.company_name?.trim()) {
        const existingCo = await client.query(
          `SELECT id FROM public.companies
           WHERE tenant_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL LIMIT 1`,
          [ctx.tenantId, lead.company_name.trim()]
        );
        if (existingCo.rows[0]) {
          companyId = existingCo.rows[0].id;
        } else {
          const { rows: [co] } = await client.query(
            `INSERT INTO public.companies (tenant_id, name, industry, website, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [ctx.tenantId, lead.company_name.trim(),
             lead.company_industry || null,
             lead.company_website || null,
             ctx.userId]
          );
          companyId = co.id;
        }
      }

      // ── 2. Check for existing contact with same email ───────────────
      let contactId: string | null = null;
      let isNewContact = false;

      if (lead.email) {
        const existing = await client.query(
          `SELECT id FROM public.contacts
           WHERE tenant_id = $1 AND email = lower($2) AND deleted_at IS NULL LIMIT 1`,
          [ctx.tenantId, lead.email]
        );
        if (existing.rows[0]) {
          // Merge key lead fields into existing contact
          contactId = existing.rows[0].id;
          await client.query(
            `UPDATE public.contacts SET
               phone       = COALESCE(NULLIF($3,''), phone),
               title       = COALESCE(NULLIF($4,''), title),
               company_id  = COALESCE($5, company_id),
               assigned_to = COALESCE($6, assigned_to),
               lead_status = 'qualified',
               lifecycle_stage = 'opportunity',
               score       = GREATEST(score, $7),
               updated_at  = now()
             WHERE id = $1 AND tenant_id = $2`,
            [contactId, ctx.tenantId,
             lead.phone || '', lead.title || '',
             companyId, assignee, lead.score ?? 0]
          );
        } else {
          isNewContact = true;
        }
      } else {
        isNewContact = true;
      }

      if (isNewContact) {
        const { rows: [contact] } = await client.query(
          `INSERT INTO public.contacts
             (tenant_id, first_name, last_name, email, phone, mobile, title,
              company_id, lead_status, lead_source, lifecycle_stage,
              score, tags, country, city, linkedin_url,
              assigned_to, created_by, notes)
           VALUES ($1,$2,$3,lower($4),$5,$6,$7,$8,'qualified',$9,'opportunity',
                   $10,$11,$12,$13,$14,$15,$16,$17)
           RETURNING id`,
          [
            ctx.tenantId,
            lead.first_name, lead.last_name || null,
            lead.email || null,
            lead.phone || null, lead.mobile || null,
            lead.title || null, companyId,
            lead.lead_source || 'converted_lead',
            lead.score ?? 0,
            lead.tags ?? [],
            lead.country || null, lead.city || null,
            lead.linkedin_url || null,
            assignee, ctx.userId,
            lead.notes || null,
          ]
        );
        contactId = contact.id;
      }

      // ── 3. Mark lead as converted ───────────────────────────────────
      await client.query(
        `UPDATE public.leads
         SET lead_status = 'converted',
             converted_at = now(),
             converted_to_contact_id = $3,
             lifecycle_stage = 'opportunity',
             updated_at = now()
         WHERE id = $1 AND tenant_id = $2`,
        [id, ctx.tenantId, contactId!]
      );

      // Log activity on the lead
      await client.query(
        `INSERT INTO public.lead_activities
           (tenant_id, lead_id, performed_by, activity_type, description, activity_data)
         VALUES ($1, $2, $3, 'converted', 'Lead converted to contact', $4)`,
        [ctx.tenantId, id, ctx.userId,
         JSON.stringify({ contact_id: contactId, created_by: ctx.userId })]
      ).catch(() => {});

      // ── 4. Optionally create a deal ─────────────────────────────────
      let dealId: string | null = null;
      if (create_deal) {
        const title = (deal_title?.trim()) ||
          (lead.company_name ? `${lead.company_name} — ${lead.full_name || lead.first_name}` : lead.full_name || lead.first_name || 'New Deal');

        // Resolve pipeline
        let resolvedPipelineId = pipeline_id || null;
        if (!resolvedPipelineId) {
          const defaultPipeline = await client.query(
            `SELECT id FROM public.pipelines WHERE tenant_id = $1 AND is_default = true LIMIT 1`,
            [ctx.tenantId]
          );
          resolvedPipelineId = defaultPipeline.rows[0]?.id ?? null;
        }

        const { rows: [deal] } = await client.query(
          `INSERT INTO public.deals
             (tenant_id, title, stage, value, probability, contact_id, company_id,
              pipeline_id, assigned_to, created_by, custom_fields)
           VALUES ($1,$2,$3,$4,30,$5,$6,$7,$8,$9,'{}')
           RETURNING id`,
          [
            ctx.tenantId, title, deal_stage,
            typeof deal_value === 'number' ? deal_value : parseFloat(deal_value) || 0,
            contactId!, companyId,
            resolvedPipelineId, assignee, ctx.userId,
          ]
        );
        dealId = deal.id;

        // Log deal creation activity
        await client.query(
          `INSERT INTO public.activities
             (tenant_id, user_id, contact_id, deal_id, type, description)
           VALUES ($1,$2,$3,$4,'deal_update','Deal created from lead conversion')`,
          [ctx.tenantId, ctx.userId, contactId, dealId]
        ).catch(() => {});
      }

      return { contactId: contactId!, dealId, isNewContact };
    });

    // ── 5. Side-effects (outside transaction) ──────────────────────────
    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'lead_converted', resourceType: 'lead', resourceId: id,
      newData: { contact_id: result.contactId, deal_id: result.dealId },
    });

    await fireWebhooks(ctx.tenantId, 'contact.created', {
      id: result.contactId,
      lead_id: id,
      converted_from_lead: true,
    }).catch(() => {});

    // Notify assignee if different from converter
    if (assignee !== ctx.userId) {
      await createNotification({
        userId: assignee,
        tenantId: ctx.tenantId,
        type: 'contact_assigned',
        title: `Lead converted: ${lead.first_name} ${lead.last_name ?? ''}`.trim(),
        body: result.dealId ? 'A new contact and deal have been created for you.' : 'A new contact has been created for you.',
        link: `/tenant/contacts/${result.contactId}`,
      });
    }

    return NextResponse.json({
      ok: true,
      contact_id: result.contactId,
      deal_id: result.dealId,
      is_new_contact: result.isNewContact,
      message: result.isNewContact ? 'Lead converted to new contact.' : 'Lead merged into existing contact.',
    }, { status: 201 });

  } catch (error: any) {
    console.error('[lead convert] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
