/**
 * Bulk Contact Operations
 * POST /api/tenant/contacts/bulk
 * Body: { action, contact_ids, payload? }
 * Actions: tag, untag, assign, status, delete, export
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
    const { action, contact_ids, payload = {} } = body;

    if (!Array.isArray(contact_ids) || !contact_ids.length)
      return NextResponse.json({ error: 'contact_ids array required' }, { status: 400 });
    if (contact_ids.length > MAX_BULK)
      return NextResponse.json({ error: `Max ${MAX_BULK} contacts per bulk operation` }, { status: 400 });

    // Validate all IDs belong to this tenant
    const valid = await queryMany<{ id: string }>(
      `SELECT id FROM public.contacts WHERE id = ANY($1::uuid[]) AND tenant_id=$2 AND deleted_at IS NULL`,
      [contact_ids, ctx.tenantId]
    );
    const validIds = valid.map(r => r.id);
    if (!validIds.length)
      return NextResponse.json({ error: 'No valid contacts found' }, { status: 404 });

    let affected = 0;

    switch (action) {
      case 'tag': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const tag = payload.tag?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
        const res = await query(
          `UPDATE public.contacts
           SET tags = array_append(tags, $1), updated_at=now()
           WHERE id = ANY($2::uuid[]) AND tenant_id=$3 AND NOT ($1 = ANY(tags))`,
          [tag, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'untag': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const tag = payload.tag?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
        const res = await query(
          `UPDATE public.contacts
           SET tags = array_remove(tags, $1), updated_at=now()
           WHERE id = ANY($2::uuid[]) AND tenant_id=$3`,
          [tag, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'assign': {
        const deny = requirePerm(ctx, 'contacts.assign');
        if (deny) return deny;
        if (!payload.assign_to) return NextResponse.json({ error: 'assign_to required' }, { status: 400 });
        // Verify assignee is a member
        const member = await queryMany<any>(
          `SELECT user_id FROM public.tenant_members WHERE user_id=$1 AND tenant_id=$2 AND status='active'`,
          [payload.assign_to, ctx.tenantId]
        );
        if (!member.length) return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
        const res = await query(
          `UPDATE public.contacts SET assigned_to=$1, updated_at=now() WHERE id=ANY($2::uuid[]) AND tenant_id=$3`,
          [payload.assign_to, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'status': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const STATUSES = ['new','contacted','qualified','unqualified','converted','lost'];
        if (!STATUSES.includes(payload.lead_status))
          return NextResponse.json({ error: `lead_status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
        const res = await query(
          `UPDATE public.contacts SET lead_status=$1, updated_at=now() WHERE id=ANY($2::uuid[]) AND tenant_id=$3`,
          [payload.lead_status, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'delete': {
        const deny = requirePerm(ctx, 'contacts.delete');
        if (deny) return deny;
        const res = await query(
          `UPDATE public.contacts SET deleted_at=now(), deleted_by=$1, is_archived=true
           WHERE id=ANY($2::uuid[]) AND tenant_id=$3 AND deleted_at IS NULL`,
          [ctx.userId, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'do_not_contact': {
        const deny = requirePerm(ctx, 'contacts.edit');
        if (deny) return deny;
        const val = payload.value !== false;
        const res = await query(
          `UPDATE public.contacts SET do_not_contact=$1, updated_at=now() WHERE id=ANY($2::uuid[]) AND tenant_id=$3`,
          [val, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: `bulk_${action}`, resourceType: 'contact',
      newData: { count: affected, contact_ids: validIds.slice(0, 20), payload },
    });

    return NextResponse.json({ ok: true, affected, action });
  } catch (err: any) {
    await logError({ error: err, context: 'contacts/bulk', tenantId: undefined });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
