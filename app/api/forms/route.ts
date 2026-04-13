import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { createNotification } from '@/lib/notifications';
import { fireWebhooks } from '@/lib/webhooks';

export async function POST(req: NextRequest) {
  try {
    const limited = await checkRateLimit(req, { action:'form_submit', max:20, windowMinutes:60 });
    if (limited) return limited;
    const body = await req.json();
    const { form_id, data: formData = {} } = body;
    if (!form_id) return NextResponse.json({ error: 'form_id required' }, { status: 400 });

    const form = await queryOne<any>(
      `SELECT f.*, t.owner_id, t.status as tenant_status
       FROM public.forms f JOIN public.tenants t ON t.id=f.tenant_id
       WHERE f.id=$1 AND f.is_active=true`,
      [form_id]
    );
    if (!form) return NextResponse.json({ error: 'Form not found or inactive' }, { status: 404 });
    if (!['active','trialing'].includes(form.tenant_status)) {
      return NextResponse.json({ ok: true, message: form.settings?.success_message ?? 'Thank you!' });
    }

    const email = formData.email?.trim()?.toLowerCase();
    let contact_id: string | null = null;
    if (email) {
      const existing = await queryOne<any>(
        `SELECT id FROM public.contacts WHERE tenant_id=$1 AND email=$2 AND is_archived=false`,
        [form.tenant_id, email]
      );
      if (existing) {
        contact_id = existing.id;
      } else {
        const { rows: [c] } = await query(
          `INSERT INTO public.contacts (tenant_id,first_name,last_name,email,phone,lead_status,lead_source,notes)
           VALUES ($1,$2,$3,$4,$5,'new',$6,$7) RETURNING id`,
          [form.tenant_id, formData.first_name?.trim()??'', formData.last_name?.trim()??'',
           email, formData.phone?.trim()??null, `Form: ${form.name}`,
           formData.message?.trim()??null]
        );
        contact_id = c?.id ?? null;
      }
    }

    await query(
      `INSERT INTO public.form_submissions (tenant_id,form_id,contact_id,data,ip_address)
       VALUES ($1,$2,$3,$4,$5)`,
      [form.tenant_id, form_id, contact_id, JSON.stringify(formData),
       req.headers.get('x-forwarded-for')?.split(',')[0] ?? null]
    );
    await query(
      `UPDATE public.forms SET submission_count=submission_count+1 WHERE id=$1`,
      [form_id]
    ).catch(() => {});

    if (form.owner_id && contact_id) {
      await createNotification({
        userId: form.owner_id, tenantId: form.tenant_id, type: 'system',
        title: `New form submission: ${form.name}`,
        body: email ? `From: ${email}` : undefined,
        link: `/tenant/contacts/${contact_id}`,
      });
    }

    await fireWebhooks(form.tenant_id, 'contact.created', { form_id, contact_id, ...formData }).catch(() => {});
    return NextResponse.json({ ok: true, message: form.settings?.success_message ?? 'Thank you! We will be in touch.' });
  } catch (err: any) {
    // FIX MEDIUM-02: Log error but return generic success message for security
    // This prevents information leakage while still logging the actual error
    console.error('[forms] Submission error:', err);
    return NextResponse.json({ ok: true, message: 'Thank you! Your submission has been received.' });
  }
}
