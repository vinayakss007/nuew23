import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const contactId = new URL(request.url).searchParams.get('contact_id');
    const params: any[] = [ctx.tenantId];
    let where = 'la.tenant_id=$1';
    if (contactId) { params.push(contactId); where += ' AND la.contact_id=$2'; }
    const data = await queryMany(
      `SELECT la.*, u1.full_name as assigned_to_name, u2.full_name as assigned_by_name,
              c.first_name, c.last_name
       FROM public.lead_assignments la
       LEFT JOIN public.users u1 ON u1.id=la.assigned_to
       LEFT JOIN public.users u2 ON u2.id=la.assigned_by
       LEFT JOIN public.contacts c ON c.id=la.contact_id
       WHERE ${where}
       ORDER BY la.assigned_at DESC LIMIT 50`,
      params
    );
    return NextResponse.json({ data });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}
