import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const data = await queryMany(
      'SELECT id, name, slug, description, permissions, created_at FROM public.roles WHERE tenant_id=$1 ORDER BY name',
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
    const { name, description, permissions } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const slug = name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    const { rows:[row] } = await query(
      `INSERT INTO public.roles (tenant_id,name,slug,description,permissions)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [ctx.tenantId, name.trim(), slug, description||null, JSON.stringify(permissions||{})]
    );
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
