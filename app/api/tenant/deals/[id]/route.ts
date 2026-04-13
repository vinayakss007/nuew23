import { fireWebhooks } from '@/lib/webhooks';
import { notifyTenantMembers } from '@/lib/notifications';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryOne, buildUpdate, query } from '@/lib/db/client';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    // FIX HIGH-11: Add permission check for viewing deals
    const deny = requirePerm(ctx, 'deals.view');
    if (deny) return deny;
    const row = await queryOne(
      'SELECT id, tenant_id, name, stage, value, probability, close_date, contact_id, company_id, owner_id, description, custom_fields, created_at, updated_at, deleted_at FROM public.deals WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',
      [(await params).id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ data: row });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'deals.edit');
    if (deny) return deny;
    const body = await req.json();
    if (body.value !== undefined) {
      const v = Number(body.value);
      if (isNaN(v) || v < 0) return NextResponse.json({ error: 'value must be a non-negative number' }, { status: 400 });
      if (v > 999_999_999) return NextResponse.json({ error: 'value too large' }, { status: 400 });
      body.value = v;
    }
    if (body.probability !== undefined) {
      const p = Number(body.probability);
      if (isNaN(p) || p < 0 || p > 100) return NextResponse.json({ error: 'probability must be 0–100' }, { status: 400 });
    }
    const prev = await queryOne<any>('SELECT stage FROM public.deals WHERE id=$1 AND tenant_id=$2', [(await params).id, ctx.tenantId]);
    const { sql, values } = buildUpdate('deals', body, { id: (await params).id, tenant_id: ctx.tenantId });
    const row = await queryOne(sql, values);
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (body.stage && prev?.stage !== body.stage) {
      await notifyTenantMembers({ tenantId:ctx.tenantId, excludeUserId:ctx.userId, type:'deal_stage', title:`Deal moved to ${body.stage}: ${(row as any)?.title ?? ''}`.trim(), entity_type:'deal', entity_id:(await params).id, link:`/tenant/deals/${(await params).id}` } as any);
      await query(
        `INSERT INTO public.activities (tenant_id,user_id,deal_id,type,description,metadata)
         VALUES ($1,$2,$3,'deal_update',$4,$5)`,
        [ctx.tenantId, ctx.userId, (await params).id,
         `Deal stage: ${prev?.stage} → ${body.stage}`,
         JSON.stringify({ stage_from: prev?.stage, stage_to: body.stage })]
      );
      await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'deal_stage_change', resourceType:'deal', resourceId: (await params).id, oldData: { stage: prev?.stage }, newData: { stage: body.stage } });

      // WORKFLOW-B: deal.won → fire webhook + send win notification email to contact
      if (body.stage === 'won') {
        const dealRow = row as any;
        await fireWebhooks(ctx.tenantId, 'deal.won', {
          id: (await params).id,
          title: dealRow?.title,
          value: dealRow?.value,
          contact_id: dealRow?.contact_id,
        }).catch(() => {});

        // Send win notification email to the contact (fire-and-forget)
        if (dealRow?.contact_id) {
          try {
            const { sendEmail } = await import('@/lib/email/service');
            const { queryOne: qOne } = await import('@/lib/db/client');
            const contact = await qOne<any>(
              `SELECT c.email, c.first_name, t.name as tenant_name
               FROM public.contacts c
               JOIN public.tenants t ON t.id = c.tenant_id
               WHERE c.id = $1 AND c.tenant_id = $2 AND c.do_not_contact = false`,
              [dealRow.contact_id, ctx.tenantId]
            );
            if (contact?.email) {
              await sendEmail({
                to: contact.email,
                subject: `Great news from ${contact.tenant_name}!`,
                html: `<div style="font-family:sans-serif;max-width:600px">
                  <p>Hi ${contact.first_name || 'there'},</p>
                  <p>We're excited to move forward — your deal <strong>${dealRow.title}</strong> has been marked as <strong>Won</strong>!</p>
                  <p>Our team will be in touch shortly with next steps.</p>
                  <br/>
                  <p>Best regards,<br/>${contact.tenant_name} Team</p>
                </div>`,
              }).catch(() => {});
            }
          } catch { /* non-critical */ }
        }

        // FIX HIGH-15: Add proper error logging to fire-and-forget operations
        // Record won_at timestamp on the deal
        await query(
          `UPDATE public.deals SET won_at = now() WHERE id = $1 AND tenant_id = $2`,
          [(await params).id, ctx.tenantId]
        ).catch((err) => {
          console.error('[deal-won] Failed to update won_at:', err);
        });

        // WORKFLOW-C: trigger automation rules for deal.won (non-blocking but logged)
        const { evaluateAutomations } = await import('@/lib/automation/engine');
        evaluateAutomations({
          tenantId: ctx.tenantId, userId: ctx.userId,
          event: 'deal.won',
          data: { ...(row as any), id: (await params).id },
        }).catch((err) => {
          console.error('[deal-won] Automation evaluation failed:', err);
        });
      }
    }
    return NextResponse.json({ data: row });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'deals.delete');
    if (deny) return deny;
    const { rows:[row] } = await query(
      `UPDATE public.deals SET deleted_at=now(), deleted_by=$1
       WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL RETURNING id`,
      [ctx.userId, (await params).id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'delete', resourceType:'deal', resourceId: (await params).id });
    return NextResponse.json({ ok: true, message: 'Moved to trash. Restore within 30 days.' });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
