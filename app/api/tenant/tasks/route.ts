import { createNotification } from '@/lib/notifications';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm, can } from '@/lib/auth/middleware';
import { queryMany, queryOne, buildInsert, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(500, parseInt(searchParams.get('limit') ?? '100'));
    const offset = parseInt(searchParams.get('offset') ?? '0');
    const dueStart = searchParams.get('due_start');
    const dueEnd = searchParams.get('due_end');
    const params: any[] = [ctx.tenantId];
    let where = 't.tenant_id = $1 AND t.deleted_at IS NULL';
    if (!can(ctx, 'tasks.view_all')) {
      params.push(ctx.userId);
      where += ` AND (t.assigned_to = $${params.length} OR t.created_by = $${params.length})`;
    }
    if (dueStart) { params.push(dueStart); where += ` AND t.due_date >= $${params.length}`; }
    if (dueEnd)   { params.push(dueEnd);   where += ` AND t.due_date <= $${params.length}`; }
    const countRes = await queryOne<{ count: string }>(
      `SELECT count(*)::text as count FROM public.tasks t WHERE ${where}`, params
    );
    params.push(limit, offset);
    const data = await queryMany(
      `SELECT t.*,
              c.first_name, c.last_name,
              d.title AS deal_title,
              u.full_name AS assignee_name
       FROM public.tasks t
       LEFT JOIN public.contacts c ON c.id = t.contact_id
       LEFT JOIN public.deals d ON d.id = t.deal_id
       LEFT JOIN public.users u ON u.id = t.assigned_to
       WHERE ${where}
       ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return NextResponse.json({ data, total: parseInt(countRes?.count ?? '0') });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'tasks.create');
    if (deny) return deny;
    const body = await request.json();
    if (!body.title?.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });

    // MISSING-002: Enforce plan task limit (uses max_contacts as a proxy where no dedicated limit exists)
    // Only check if the plan defines a hard cap via custom features
    const taskLimit = await queryOne<any>(
      `SELECT p.features FROM public.tenants t JOIN public.plans p ON p.id = t.plan_id WHERE t.id = $1`,
      [ctx.tenantId]
    );
    const maxTasks = taskLimit?.features?.max_tasks;
    if (maxTasks > 0) {
      const taskCount = await queryOne<{ count: string }>(
        `SELECT count(*)::text as count FROM public.tasks WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [ctx.tenantId]
      );
      if (parseInt(taskCount?.count ?? '0') >= maxTasks) {
        return NextResponse.json({
          error: `Task limit reached (${maxTasks}). Upgrade your plan to create more tasks.`,
        }, { status: 403 });
      }
    }

    const { sql, values } = buildInsert('tasks', {
      title: body.title.trim(), description: body.description || null,
      due_date: body.due_date || null, priority: body.priority ?? 'medium',
      contact_id: body.contact_id || null, deal_id: body.deal_id || null,
      assigned_to: body.assigned_to || ctx.userId, completed: false,
      tenant_id: ctx.tenantId, created_by: ctx.userId,
    });
    const row = await queryOne(sql, values);
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
