import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';


export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const data = await queryMany(
      `SELECT f.*, (SELECT count(*)::int FROM public.form_submissions WHERE form_id=f.id) as submissions
       FROM public.forms f WHERE f.tenant_id=$1 ORDER BY f.created_at DESC`,
      [ctx.tenantId]
    );
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const formsWithEmbed = data.map((f: any) => ({
      ...f,
      embed_code: `<iframe src="${appUrl}/lead-capture?form=${f.slug}" 
  style="width:100%;min-height:500px;border:none;border-radius:8px;" 
  title="${f.name}" loading="lazy" allow="clipboard-write"></iframe>
<!-- Powered by abetworks.in — NuCRM -->`,
      public_url: `${appUrl}/lead-capture?form=${f.slug}`
    }));
    return NextResponse.json({ data: formsWithEmbed });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    const { name, description, fields = [], settings = {} } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
    const slug = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,40) + '-' + Date.now().toString(36);
    const { rows: [form] } = await query(
      `INSERT INTO public.forms (tenant_id,name,slug,description,fields,settings,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [ctx.tenantId, name.trim(), slug, description?.trim()??null,
       JSON.stringify(fields), JSON.stringify(settings), ctx.userId]
    );

    // Generate embed code with abetworks branding
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const embedCode = `<iframe src="${appUrl}/lead-capture?form=${slug}" 
  style="width:100%;min-height:500px;border:none;border-radius:8px;" 
  title="${name.trim()}" loading="lazy"
  allow="clipboard-write"></iframe>
<!-- Powered by abetworks.in — NuCRM -->`;

    return NextResponse.json({ 
      data: { ...form, embed_code: embedCode, public_url: `${appUrl}/lead-capture?form=${slug}` }
    }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
