/**
 * Bulk Lead Operations
 * POST /api/tenant/leads/bulk
 * Body: { action, lead_ids, payload? }
 * Actions: status, assign, tag, delete
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { query, queryMany } from '@/lib/db/client';
import { logAudit } from '@/lib/audit';
import { logError } from '@/lib/errors';

const MAX_BULK = 500;

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json();
    const { action, lead_ids, payload = {} } = body;

    if (!Array.isArray(lead_ids) || !lead_ids.length)
      return NextResponse.json({ error: 'lead_ids array required' }, { status: 400 });
    if (lead_ids.length > MAX_BULK)
      return NextResponse.json({ error: `Max ${MAX_BULK} leads per bulk operation` }, { status: 400 });

    // Validate all IDs belong to this tenant
    const valid = await queryMany<{ id: string }>(
      `SELECT id FROM public.leads WHERE id = ANY($1::uuid[]) AND tenant_id=$2 AND deleted_at IS NULL`,
      [lead_ids, ctx.tenantId]
    );
    const validIds = valid.map(r => r.id);
    if (!validIds.length)
      return NextResponse.json({ error: 'No valid leads found' }, { status: 404 });

    let affected = 0;

    switch (action) {
      case 'status': {
        const deny = requirePerm(ctx, 'leads.edit');
        if (deny) return deny;
        const STATUSES = ['new','contacted','qualified','unqualified','converted','lost'];
        if (!STATUSES.includes(payload.lead_status))
          return NextResponse.json({ error: `lead_status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
        const res = await query(
          `UPDATE public.leads SET lead_status=$1, updated_at=now() WHERE id=ANY($2::uuid[]) AND tenant_id=$3`,
          [payload.lead_status, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'assign': {
        const deny = requirePerm(ctx, 'leads.assign');
        if (deny) return deny;
        if (!payload.assigned_to) return NextResponse.json({ error: 'assigned_to required' }, { status: 400 });
        const member = await queryMany<any>(
          `SELECT user_id FROM public.tenant_members WHERE user_id=$1 AND tenant_id=$2 AND status='active'`,
          [payload.assigned_to, ctx.tenantId]
        );
        if (!member.length) return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
        const res = await query(
          `UPDATE public.leads SET assigned_to=$1, updated_at=now() WHERE id=ANY($2::uuid[]) AND tenant_id=$3`,
          [payload.assigned_to, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'tag': {
        const deny = requirePerm(ctx, 'leads.edit');
        if (deny) return deny;
        const tag = payload.tag?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
        const res = await query(
          `UPDATE public.leads
           SET tags = array_append(tags, $1), updated_at=now()
           WHERE id = ANY($2::uuid[]) AND tenant_id=$3 AND NOT ($1 = ANY(tags))`,
          [tag, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'delete': {
        const deny = requirePerm(ctx, 'leads.delete');
        if (deny) return deny;
        const res = await query(
          `UPDATE public.leads SET deleted_at=now(), deleted_by=$1, is_archived=true
           WHERE id=ANY($2::uuid[]) AND tenant_id=$3 AND deleted_at IS NULL`,
          [ctx.userId, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'convert': {
        const deny = requirePerm(ctx, 'leads.edit');
        if (deny) return deny;
        const res = await query(
          `UPDATE public.leads SET lifecycle_stage='customer', updated_at=now() WHERE id=ANY($1::uuid[]) AND tenant_id=$2`,
          [validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: `bulk_${action}`, resourceType: 'lead',
      newData: { count: affected, lead_ids: validIds.slice(0, 20), payload },
    });

    return NextResponse.json({ ok: true, affected, action });
  } catch (err: any) {
    await logError({ error: err, context: 'leads/bulk', tenantId: undefined });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
