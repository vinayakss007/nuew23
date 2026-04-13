import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query, dbCache, invalidateCache } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const tenant = await dbCache(`workspace:${ctx.tenantId}`, 2*60*1000, () => queryOne(`SELECT t.*, p.name as plan_name, p.max_users, p.max_contacts, p.max_deals, p.features FROM public.tenants t JOIN public.plans p ON p.id = t.plan_id WHERE t.id = $1`, [ctx.tenantId]));
    return NextResponse.json({ data: tenant });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { name } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const slug = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now().toString(36);
    const { rows:[tenant] } = await query(
      `INSERT INTO public.tenants (name,slug,owner_id,plan_id,status)
       VALUES ($1,$2,$3,'free','trialing') RETURNING *`,
      [name.trim(), slug, ctx.userId]
    );
    await query('UPDATE public.users SET last_tenant_id=$1 WHERE id=$2', [tenant.id, ctx.userId]);
    return NextResponse.json({ data: tenant }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const body = await request.json();
    const allowed = ['name','primary_color','industry','company_size','country','settings','logo_url','subdomain','custom_domain'];
    const fields = Object.keys(body).filter(k => allowed.includes(k) && body[k] !== undefined);
    if (!fields.length) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
    let i = 1;
    const sets = fields.map(k => {
      const val = k === 'settings' ? `$${i++}::jsonb` : `$${i++}`;
      return `"${k}" = ${val}`;
    }).join(', ');
    const vals = [...fields.map(k => k === 'settings' ? JSON.stringify(body[k]) : body[k]), ctx.tenantId];
    const { rows:[tenant] } = await query(
      `UPDATE public.tenants SET ${sets}, updated_at=now() WHERE id=$${i} RETURNING *`, vals
    );
    return NextResponse.json({ data: tenant });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
