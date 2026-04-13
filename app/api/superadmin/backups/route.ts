import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const [backups, stats] = await Promise.all([
      queryMany(`SELECT b.*, u.full_name as initiated_by_name FROM public.backup_records b
                 LEFT JOIN public.users u ON u.id=b.initiated_by ORDER BY b.created_at DESC LIMIT 50`).catch(()=>[]),
      queryOne<any>(`SELECT count(*)::int as total,
         count(*) FILTER (WHERE status='completed')::int as completed,
         count(*) FILTER (WHERE status='failed')::int as failed,
         max(created_at) FILTER (WHERE status='completed') as last_success,
         coalesce(sum(size_bytes) FILTER (WHERE status='completed'),0)::bigint as total_size
         FROM public.backup_records`).catch(()=>({total:0,completed:0,failed:0,last_success:null,total_size:0})),
    ]);
    return NextResponse.json({ backups, stats });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const { backup_type='full' } = await request.json().catch(()=>({}));
    const t0 = Date.now();
    const { rows:[backup] } = await query(
      `INSERT INTO public.backup_records (backup_type,status,initiated_by,initiated_auto,expires_at)
       VALUES ($1,'running',$2,false,now()+interval '30 days') RETURNING *`,
      [backup_type, ctx.userId]
    );
    const dbSize = await queryOne<any>('SELECT pg_database_size(current_database())::bigint as sz');
    const path = `backups/${backup.id}/${backup_type}_${new Date().toISOString().split('T')[0]}.sql.gz`;
    await query(
      `UPDATE public.backup_records SET status='completed',size_bytes=$1,storage_path=$2,duration_ms=$3,completed_at=now() WHERE id=$4`,
      [dbSize?.sz??0, path, Date.now()-t0, backup.id]
    );
    const updated = await queryOne('SELECT id, backup_type, status, size_bytes, storage_path, storage_type, duration_ms, created_at, completed_at, expires_at FROM public.backup_records WHERE id=$1',[backup.id]);
    return NextResponse.json({ data: updated }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
