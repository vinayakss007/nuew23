import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const data = await queryMany('SELECT id, title, message, type, active, target_audience, created_at, updated_at FROM public.announcements ORDER BY created_at DESC LIMIT 50').catch(()=>[]);
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const b = await request.json();
    if (!b.title||!b.body) return NextResponse.json({ error: 'title and body required' }, { status: 400 });
    const { rows:[row] } = await query(
      `INSERT INTO public.announcements (title,body,type,target,is_active,starts_at,ends_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [b.title,b.body,b.type||'info',b.target||'all',b.is_active??true,b.starts_at||new Date().toISOString(),b.ends_at||null,ctx.userId]
    );
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { id } = await request.json();
    await query('DELETE FROM public.announcements WHERE id=$1', [id]);
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
