import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    const data = await queryMany('SELECT id, name, price, max_users, max_contacts, max_deals, max_automations, features, is_active, sort_order, created_at FROM public.plans ORDER BY sort_order');
    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    const b = await request.json();
    const { rows: [row] } = await query(
      `INSERT INTO public.plans
         (id,name,price_monthly,price_yearly,max_users,max_contacts,max_deals,
          max_storage_gb,max_automations,max_forms,max_api_calls_day,features,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [b.id, b.name, b.price_monthly??0, b.price_yearly??0, b.max_users??5,
       b.max_contacts??1000, b.max_deals??500, b.max_storage_gb??1,
       b.max_automations??5, b.max_forms??3, b.max_api_calls_day??1000,
       JSON.stringify(b.features??[]), b.sort_order??99]
    );
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });
    const { id, ...b } = await request.json();
    const fields = Object.keys(b).filter(k => b[k] !== undefined);
    if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    let i = 1;
    const sets = fields.map(k => `"${k}" = $${i++}`).join(', ');
    const vals = [...fields.map(k => b[k]), id];
    const { rows: [row] } = await query(
      `UPDATE public.plans SET ${sets} WHERE id = $${i} RETURNING *`, vals
    );
    return NextResponse.json({ data: row });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
