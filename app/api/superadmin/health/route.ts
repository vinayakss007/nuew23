import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, query } from '@/lib/db/client';

async function runCheck(service: string, fn: () => Promise<{ latency_ms: number; message: string }>) {
  try {
    const result = await fn();
    return { service, status: 'up', ...result };
  } catch (e: any) {
    return { service, status: 'down', latency_ms: 0, message: e.message };
  }
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const checks = await Promise.all([
      runCheck('database', async () => {
        const t = Date.now(); await query('SELECT 1'); return { latency_ms: Date.now()-t, message: 'Connected' };
      }),
      runCheck('app', async () => {
        return { latency_ms: 0, message: `Node ${process.version} · Uptime ${Math.floor(process.uptime())}s` };
      }),
      runCheck('email', async () => {
        const key = process.env.RESEND_API_KEY;
        if (!key) return { latency_ms: 0, message: 'Not configured' };
        const t = Date.now();
        await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` } });
        return { latency_ms: Date.now()-t, message: 'Resend OK' };
      }),
    ]);

    // Persist
    for (const c of checks) {
      await query(`INSERT INTO public.health_checks (service,status,latency_ms,message) VALUES ($1,$2,$3,$4)`,
        [c.service, c.status, c.latency_ms, c.message]).catch(()=>{});
    }

    const history = await queryMany(
      `SELECT service,status,latency_ms,checked_at::text FROM public.health_checks
       WHERE checked_at > now()-interval '24 hours' ORDER BY checked_at DESC LIMIT 300`
    ).catch(()=>[]);

    return NextResponse.json({ checks, history });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
