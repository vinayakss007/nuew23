import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query } from '@/lib/db/client';

export async function PATCH(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    
    const body = await req.json();
    const { name, url, events, is_active } = body;
    
    // Get existing webhook to merge config
    const existing = await query<any>(
      'SELECT config FROM public.integrations WHERE id=$1 AND tenant_id=$2 AND type=$3',
      [(await params).id, ctx.tenantId, 'webhook']
    );
    
    if (!existing.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    
    const currentConfig = existing.rows[0].config || {};
    const newConfig = {
      ...currentConfig,
      url: url || currentConfig.url,
      events: events || currentConfig.events,
    };
    
    const updates: string[] = [];
    const values: any[] = [];
    
    if (name !== undefined) {
      values.push(name);
      updates.push(`name=$${values.length}`);
    }
    if (is_active !== undefined) {
      values.push(is_active);
      updates.push(`is_active=$${values.length}`);
    }
    if (url !== undefined || events !== undefined) {
      values.push(JSON.stringify(newConfig));
      updates.push(`config=$${values.length}`);
    }
    
    values.push((await params).id);
    values.push(ctx.tenantId);
    
    const { rows:[row] } = await query(
      `UPDATE public.integrations SET ${updates.join(',')}, updated_at=now() 
       WHERE id=$${values.length-1} AND tenant_id=$${values.length} AND type='webhook' 
       RETURNING id,name,is_active,config,updated_at`,
      values
    );
    
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    
    return NextResponse.json({ 
      data: { 
        ...row, 
        url: row.config?.url,
        events: row.config?.events 
      } 
    });
  } catch (err: any) { 
    return NextResponse.json({ error: err.message }, { status: 500 }); 
  }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) return NextResponse.json({ error: 'Admin required' }, { status: 403 });
    await query('DELETE FROM public.integrations WHERE id=$1 AND tenant_id=$2 AND type=$3', [(await params).id, ctx.tenantId, 'webhook']);
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
