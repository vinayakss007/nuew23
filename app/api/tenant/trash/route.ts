import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';
import { logAudit } from '@/lib/audit';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const type = new URL(req.url).searchParams.get('type');

    const tables: Record<string, string> = {
      contact: `SELECT 'contact' as resource_type, id, tenant_id, deleted_at, deleted_by,
                 first_name||' '||last_name as name, lead_status as extra, email
                FROM public.contacts WHERE tenant_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200`,
      deal:    `SELECT 'deal' as resource_type, id, tenant_id, deleted_at, deleted_by,
                 title as name, stage as extra, null::text as email
                FROM public.deals WHERE tenant_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200`,
      task:    `SELECT 'task' as resource_type, id, tenant_id, deleted_at, deleted_by,
                 title as name, priority as extra, null::text as email
                FROM public.tasks WHERE tenant_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200`,
      company: `SELECT 'company' as resource_type, id, tenant_id, deleted_at, deleted_by,
                 name, null::text as extra, null::text as email
                FROM public.companies WHERE tenant_id=$1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 200`,
    };

    let items: any[] = [];
    if (type && tables[type]) {
      items = await queryMany(tables[type], [ctx.tenantId]);
    } else {
      // All types
      const results = await Promise.all(
        Object.values(tables).map(sql => queryMany(sql, [ctx.tenantId]))
      );
      items = results.flat().sort((a: any, b: any) =>
        new Date(b.deleted_at).getTime() - new Date(a.deleted_at).getTime()
      );
    }

    // Add days remaining before permanent deletion
    const now = Date.now();
    const withExpiry = items.map((item: any) => ({
      ...item,
      days_remaining: Math.max(0, 30 - Math.floor((now - new Date(item.deleted_at).getTime()) / 86400000)),
    }));

    return NextResponse.json({ data: withExpiry, total: withExpiry.length });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.edit'); // basic edit permission needed to restore
    if (deny) return deny;

    const { id, resource_type } = await req.json();
    if (!id || !resource_type) return NextResponse.json({ error: 'id and resource_type required' }, { status: 400 });

    const tableMap: Record<string, string> = {
      contact: 'contacts', deal: 'deals', task: 'tasks', company: 'companies',
    };
    const table = tableMap[resource_type];
    if (!table) return NextResponse.json({ error: 'Invalid resource_type' }, { status: 400 });

    const extra = resource_type === 'contact' ? ', is_archived=false' : '';
    const { rows:[row] } = await query(
      `UPDATE public.${table}
       SET deleted_at=NULL, deleted_by=NULL${extra}
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NOT NULL
       RETURNING id`,
      [id, ctx.tenantId]
    );
    if (!row) return NextResponse.json({ error: 'Not found in trash' }, { status: 404 });

    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:`restore`, resourceType: resource_type, resourceId: id });
    return NextResponse.json({ ok: true, message: `${resource_type} restored successfully` });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required to permanently delete' }, { status: 403 });

    const { id, resource_type, purge_all } = await req.json();

    if (purge_all) {
      // Permanently delete everything in trash older than 30 days
      const count = await query('SELECT public.purge_trash() as count');
      return NextResponse.json({ ok: true, purged: count.rows[0]?.count ?? 0 });
    }

    if (!id || !resource_type) return NextResponse.json({ error: 'id and resource_type required' }, { status: 400 });

    const tableMap: Record<string, string> = {
      contact: 'contacts', deal: 'deals', task: 'tasks', company: 'companies',
    };
    const table = tableMap[resource_type];
    if (!table) return NextResponse.json({ error: 'Invalid resource_type' }, { status: 400 });

    // Only permanently delete items already in trash
    const { rowCount } = await query(
      `DELETE FROM public.${table} WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NOT NULL`,
      [id, ctx.tenantId]
    );
    if (!rowCount) return NextResponse.json({ error: 'Not found in trash' }, { status: 404 });
    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'permanent_delete', resourceType: resource_type, resourceId: id });
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
