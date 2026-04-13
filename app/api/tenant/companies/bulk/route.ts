/**
 * Bulk Company Operations
 * POST /api/tenant/companies/bulk
 * Body: { action, company_ids, payload? }
 * Actions: assign, status, delete, tag
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
    const { action, company_ids, payload = {} } = body;

    if (!Array.isArray(company_ids) || !company_ids.length)
      return NextResponse.json({ error: 'company_ids array required' }, { status: 400 });
    if (company_ids.length > MAX_BULK)
      return NextResponse.json({ error: `Max ${MAX_BULK} companies per bulk operation` }, { status: 400 });

    // Validate all IDs belong to this tenant
    const valid = await queryMany<{ id: string }>(
      `SELECT id FROM public.companies WHERE id = ANY($1::uuid[]) AND tenant_id=$2 AND deleted_at IS NULL`,
      [company_ids, ctx.tenantId]
    );
    const validIds = valid.map(r => r.id);
    if (!validIds.length)
      return NextResponse.json({ error: 'No valid companies found' }, { status: 404 });

    let affected = 0;

    switch (action) {
      case 'assign': {
        const deny = requirePerm(ctx, 'companies.assign');
        if (deny) return deny;
        if (!payload.assigned_to) return NextResponse.json({ error: 'assigned_to required' }, { status: 400 });
        const member = await queryMany<any>(
          `SELECT user_id FROM public.tenant_members WHERE user_id=$1 AND tenant_id=$2 AND status='active'`,
          [payload.assigned_to, ctx.tenantId]
        );
        if (!member.length) return NextResponse.json({ error: 'Assignee not found' }, { status: 404 });
        const res = await query(
          `UPDATE public.companies SET assigned_to=$1, updated_at=now() WHERE id=ANY($2::uuid[]) AND tenant_id=$3`,
          [payload.assigned_to, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'status': {
        const deny = requirePerm(ctx, 'companies.edit');
        if (deny) return deny;
        const STATUSES = ['active','inactive','archived'];
        if (!STATUSES.includes(payload.status))
          return NextResponse.json({ error: `status must be one of: ${STATUSES.join(', ')}` }, { status: 400 });
        const res = await query(
          `UPDATE public.companies SET status=$1, updated_at=now() WHERE id=ANY($2::uuid[]) AND tenant_id=$3`,
          [payload.status, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'delete': {
        const deny = requirePerm(ctx, 'companies.delete');
        if (deny) return deny;
        const res = await query(
          `UPDATE public.companies SET deleted_at=now(), deleted_by=$1, is_archived=true
           WHERE id=ANY($2::uuid[]) AND tenant_id=$3 AND deleted_at IS NULL`,
          [ctx.userId, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      case 'tag': {
        const deny = requirePerm(ctx, 'companies.edit');
        if (deny) return deny;
        const tag = payload.tag?.trim();
        if (!tag) return NextResponse.json({ error: 'tag required' }, { status: 400 });
        const res = await query(
          `UPDATE public.companies
           SET tags = array_append(tags, $1), updated_at=now()
           WHERE id = ANY($2::uuid[]) AND tenant_id=$3 AND NOT ($1 = ANY(tags))`,
          [tag, validIds, ctx.tenantId]
        );
        affected = res.rowCount ?? 0;
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: `bulk_${action}`, resourceType: 'company',
      newData: { count: affected, company_ids: validIds.slice(0, 20), payload },
    });

    return NextResponse.json({ ok: true, affected, action });
  } catch (err: any) {
    await logError({ error: err, context: 'companies/bulk', tenantId: undefined });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
