import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryMany, queryOne, buildInsert, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // FIX HIGH-11: Add permission check for viewing companies
    const deny = requirePerm(ctx, 'companies.view');
    if (deny) return deny;
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('q')?.trim();
    const params: any[] = [ctx.tenantId];
    let where = 'c.tenant_id = $1';
    if (search) { params.push(`%${search}%`); where += ` AND c.name ILIKE $${params.length}`; }
    
    // FIX HIGH-06: Replace N+1 correlated subquery with LEFT JOIN
    const data = await queryMany(
      `SELECT c.*, COALESCE(cnt.contact_count, 0) AS contact_count
       FROM public.companies c
       LEFT JOIN (
         SELECT company_id, count(*)::int AS contact_count
         FROM public.contacts
         WHERE tenant_id = $1
         GROUP BY company_id
       ) cnt ON cnt.company_id = c.id
       WHERE ${where}
       ORDER BY c.name`,
      params
    );
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'companies.create');
    if (deny) return deny;
    const body = await request.json();
    if (!body.name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const { sql, values } = buildInsert('companies', {
      name: body.name.trim(), industry: body.industry || null, size: body.size || null,
      website: body.website || null, phone: body.phone || null, address: body.address || null,
      notes: body.notes || null, custom_fields: body.custom_fields ?? {},
      tenant_id: ctx.tenantId, created_by: ctx.userId,
    });
    const row = await queryOne(sql, values);
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
