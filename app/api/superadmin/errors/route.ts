import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { searchParams } = new URL(request.url);
    const level = searchParams.get('level');
    const resolved = searchParams.get('resolved');
    const limit = Math.min(200, parseInt(searchParams.get('limit')||'50'));
    const conds = ['1=1']; const params: any[] = [];
    if (level) { params.push(level); conds.push(`e.level=$${params.length}`); }
    if (resolved!==null && resolved!=='') { params.push(resolved==='true'); conds.push(`e.resolved=$${params.length}`); }
    params.push(limit);
    const errors = await queryMany(
      `SELECT e.*,t.name as tenant_name,u.email as user_email FROM public.error_logs e
       LEFT JOIN public.tenants t ON t.id=e.tenant_id LEFT JOIN public.users u ON u.id=e.user_id
       WHERE ${conds.join(' AND ')} ORDER BY e.created_at DESC LIMIT $${params.length}`, params
    ).catch(()=>[]);
    const summary = await queryOne<any>(
      `SELECT count(*) FILTER (WHERE NOT resolved AND level='fatal')::int as fatal_unresolved,
              count(*) FILTER (WHERE NOT resolved AND level='error')::int as error_unresolved,
              count(*) FILTER (WHERE NOT resolved AND level='warn')::int as warn_unresolved,
              count(*) FILTER (WHERE created_at>now()-interval '1 hour')::int as last_hour,
              count(*) FILTER (WHERE created_at>now()-interval '24 hours')::int as last_day
       FROM public.error_logs`
    ).catch(()=>({fatal_unresolved:0,error_unresolved:0,warn_unresolved:0,last_hour:0,last_day:0}));
    return NextResponse.json({ errors, summary });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const { level='error', code, message, tenant_id, stack, context } = await request.json();
    await query(
      `INSERT INTO public.error_logs (level,code,message,tenant_id,stack,context) VALUES ($1,$2,$3,$4,$5,$6)`,
      [level, code||null, message, tenant_id||null, stack||null, context?JSON.stringify(context):null]
    ).catch(()=>{});
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch { return NextResponse.json({ ok: true }, { status: 201 }); }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id, resolveAll, level } = await request.json();
    if (resolveAll) {
      const where = level ? `level='${level}' AND ` : '';
      await query(`UPDATE public.error_logs SET resolved=true,resolved_at=now() WHERE ${where}resolved=false`);
    } else if (id) {
      await query('UPDATE public.error_logs SET resolved=true,resolved_at=now() WHERE id=$1', [id]);
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
