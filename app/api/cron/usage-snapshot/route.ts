import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db/client';

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await queryOne<any>('SELECT public.snapshot_tenant_usage() as count');
    return NextResponse.json({ ok: true, snapshots: result?.count });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
