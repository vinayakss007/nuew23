import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });

    const [contacts, companies, deals, tasks, activities, members] = await Promise.all([
      queryMany('SELECT id, tenant_id, first_name, last_name, email, phone, company_name, title, tags, lead_status, score, lifecycle_stage, lead_source, custom_fields, created_at, updated_at FROM public.contacts WHERE tenant_id=$1 ORDER BY created_at', [ctx.tenantId]),
      queryMany('SELECT id, tenant_id, name, website, industry, size, phone, address, custom_fields, created_at, updated_at FROM public.companies WHERE tenant_id=$1 ORDER BY created_at', [ctx.tenantId]),
      queryMany('SELECT id, tenant_id, name, stage, value, probability, close_date, contact_id, company_id, custom_fields, created_at, updated_at FROM public.deals WHERE tenant_id=$1 ORDER BY created_at', [ctx.tenantId]),
      queryMany('SELECT id, tenant_id, title, description, status, priority, due_date, assigned_to, contact_id, deal_id, completed_at, custom_fields, created_at, updated_at FROM public.tasks WHERE tenant_id=$1 ORDER BY created_at', [ctx.tenantId]),
      queryMany('SELECT type,description,created_at FROM public.activities WHERE tenant_id=$1 ORDER BY created_at', [ctx.tenantId]),
      queryMany(`SELECT u.email,u.full_name,tm.role_slug,tm.joined_at FROM public.tenant_members tm JOIN public.users u ON u.id=tm.user_id WHERE tm.tenant_id=$1`, [ctx.tenantId]),
    ]);

    const export_data = {
      exported_at: new Date().toISOString(),
      tenant_id: ctx.tenantId,
      contacts,
      companies,
      deals,
      tasks,
      activities,
      members,
    };

    return new NextResponse(JSON.stringify(export_data, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="nucrm_export_${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
