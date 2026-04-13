import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const status = new URL(request.url).searchParams.get('status');
    const params: any[] = []; let where = '1=1';
    if (status) { params.push(status); where=`st.status=$1`; }
    const [tickets, counts] = await Promise.all([
      queryMany(`SELECT st.*,t.name as tenant_name,u.email as user_email,u.full_name as user_name
                 FROM public.support_tickets st LEFT JOIN public.tenants t ON t.id=st.tenant_id
                 LEFT JOIN public.users u ON u.id=st.created_by WHERE ${where}
                 ORDER BY CASE st.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,st.created_at DESC LIMIT 100`, params),
      queryOne<any>(`SELECT count(*) FILTER (WHERE status='open')::int as open,
         count(*) FILTER (WHERE status='in_progress')::int as in_progress,
         count(*) FILTER (WHERE status='resolved')::int as resolved,
         count(*) FILTER (WHERE priority='critical' AND status NOT IN ('resolved','closed'))::int as critical
         FROM public.support_tickets`),
    ]);
    return NextResponse.json({ tickets, counts });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { subject, body, category='general', priority='normal', tenant_id } = await request.json();
    if (!subject||!body) return NextResponse.json({ error: 'subject and body required' }, { status: 400 });
    const tid = tenant_id || ctx.tenantId;
    const { rows:[row] } = await query(
      `INSERT INTO public.support_tickets (tenant_id,created_by,subject,body,category,priority) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tid, ctx.userId, subject, body, category, priority]
    );
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id, status, resolution, assigned_to } = await request.json();
    const upd: string[] = []; const vals: any[] = [];
    const s = (f:string,v:any)=>{vals.push(v);upd.push(`${f}=$${vals.length}`);};
    if (status){s('status',status);if(status==='resolved'){s('resolved_at',new Date().toISOString());}}
    if(resolution!==undefined)s('resolution',resolution);
    if(assigned_to!==undefined)s('assigned_to',assigned_to);
    if(!upd.length)return NextResponse.json({error:'Nothing to update'},{status:400});
    vals.push(id);
    await query(`UPDATE public.support_tickets SET ${upd.join(',')} WHERE id=$${vals.length}`,vals);
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
