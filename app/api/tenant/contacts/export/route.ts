import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryMany } from '@/lib/db/client';

function escapeCSV(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.export');
    if (deny) return deny;

    const { searchParams } = new URL(request.url);
    const leadStatus = searchParams.get('lead_status');
    const search = searchParams.get('q');

    const params: any[] = [ctx.tenantId];
    let where = 'c.tenant_id=$1 AND c.is_archived=false';
    if (leadStatus) { params.push(leadStatus); where += ` AND c.lead_status=$${params.length}`; }
    if (search) { params.push(`%${search}%`); where += ` AND (c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.email ILIKE $${params.length})`; }

    const contacts = await queryMany(
      `SELECT c.first_name, c.last_name, c.email, c.phone,
              co.name AS company, c.lead_status, c.lead_source,
              c.city, c.country, c.website, c.linkedin_url, c.twitter_url,
              c.score, array_to_string(c.tags,';') AS tags,
              c.notes, c.created_at::date AS created_date
       FROM public.contacts c
       LEFT JOIN public.companies co ON co.id=c.company_id
       WHERE ${where}
       ORDER BY c.created_at DESC`,
      params
    );

    // FIX LOW-07: Return empty CSV with headers instead of 404
    const headers = ['first_name','last_name','email','phone','company','lead_status','lead_source','city','country','website','linkedin_url','twitter_url','score','tags','notes','created_date'];
    const rows = contacts.map(c => headers.map(h => escapeCSV((c as any)[h])).join(','));
    const csv = [headers.join(','), ...rows].join('\n');

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="contacts_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
