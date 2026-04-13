import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db/client';

export async function GET(req: NextRequest, { params }: any) {
  const form = await queryOne<any>(
    `SELECT f.id, f.name, f.fields, f.settings, f.is_active, t.status as tenant_status
     FROM public.forms f JOIN public.tenants t ON t.id=f.tenant_id WHERE f.id=$1`,
    [(await params).id]
  ).catch(() => null);
  if (!form || !form.is_active) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: {'Access-Control-Allow-Origin':'*'} });
  // FIX: Return form data directly (not wrapped in 'form' key) so frontend can read name, fields, settings
  return NextResponse.json(
    { id:form.id, name:form.name, fields:form.fields, description: form.description, settings:{ success_message:form.settings?.success_message??'Thank you!' } },
    { headers: {'Access-Control-Allow-Origin':'*'} }
  );
}
export async function OPTIONS() {
  return new Response(null, { headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET'} });
}
