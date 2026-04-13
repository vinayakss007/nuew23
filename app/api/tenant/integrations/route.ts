import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const data = await queryMany(
      'SELECT id,type,name,is_active,last_used_at,created_at,config FROM public.integrations WHERE tenant_id=$1 ORDER BY created_at DESC',
      [ctx.tenantId]
    );
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { type, name, config } = await request.json();
    if (!type || !name) return NextResponse.json({ error: 'type and name required' }, { status: 400 });
    const { rows:[row] } = await query(
      `INSERT INTO public.integrations (tenant_id,user_id,type,name,config,is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id,type,name,is_active,created_at`,
      [ctx.tenantId, ctx.userId, type, name, JSON.stringify(config||{})]
    );
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
