import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const r: Record<string,number> = {};
    r['sessions'] = (await query('DELETE FROM public.sessions WHERE expires_at < now()')).rowCount ?? 0;
    r['invitations'] = (await query(`DELETE FROM public.invitations WHERE expires_at < now()-interval '7 days' AND accepted_at IS NULL`)).rowCount ?? 0;
    r['resets'] = (await query('DELETE FROM public.password_resets WHERE expires_at < now()')).rowCount ?? 0;
    // NOTE: rate limiting uses Redis (cache.incr), not a DB table — no cleanup needed here
    // Purge trash items older than 30 days
    try {
      const trash = await query('SELECT public.purge_trash() as count');
      r['trash_purged'] = trash.rows[0]?.count ?? 0;
    } catch {}

    return NextResponse.json({ ok: true, cleaned: r });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
