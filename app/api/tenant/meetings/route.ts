import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const params: any[] = [ctx.tenantId];
    let where = 'm.tenant_id=$1 AND m.deleted_at IS NULL';
    if (start) { params.push(start); where += ` AND m.start_time >= $${params.length}`; }
    if (end) { params.push(end + 'T23:59:59'); where += ` AND m.start_time <= $${params.length}`; }
    const data = await queryMany(
      `SELECT m.*, c.first_name||' '||c.last_name as contact_name
       FROM public.meetings m
       LEFT JOIN public.contacts c ON c.id=m.contact_id
       WHERE ${where} ORDER BY m.start_time ASC`,
      params
    );
    return NextResponse.json({ data });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();
    if (!body.title || !body.start_time) {
      return NextResponse.json({ error: 'title and start_time required' }, { status: 400 });
    }
    const endTime = body.end_time || new Date(new Date(body.start_time).getTime() + 3600000).toISOString();
    const { rows:[row] } = await query(
      `INSERT INTO public.meetings
         (tenant_id,user_id,contact_id,deal_id,title,description,start_time,end_time,location,meeting_url,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'scheduled') RETURNING *`,
      [ctx.tenantId, ctx.userId, body.contact_id||null, body.deal_id||null,
       body.title, body.description||null, body.start_time, endTime,
       body.location||null, body.meeting_url||null]
    );
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
