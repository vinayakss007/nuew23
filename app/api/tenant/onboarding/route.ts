import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    // Ensure row exists
    await query(
      `INSERT INTO public.onboarding_progress (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [ctx.tenantId]
    ).catch(() => {});
    const row = await queryOne<any>(
      'SELECT steps_done, completed FROM public.onboarding_progress WHERE tenant_id=$1',
      [ctx.tenantId]
    );
    return NextResponse.json({ steps_done: row?.steps_done ?? [], completed: row?.completed ?? false });
  } catch { return NextResponse.json({ steps_done: [], completed: false }); }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const body = await request.json();

    if (body.complete) {
      await query(
        `INSERT INTO public.onboarding_progress (tenant_id, completed, completed_at)
         VALUES ($1, true, now())
         ON CONFLICT (tenant_id) DO UPDATE SET completed=true, completed_at=now()`,
        [ctx.tenantId]
      );
    } else if (body.step) {
      // First ensure row exists
      await query(
        `INSERT INTO public.onboarding_progress (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [ctx.tenantId]
      );
      // Then add step if not already there
      await query(
        `UPDATE public.onboarding_progress
         SET steps_done = array_append(steps_done, $1)
         WHERE tenant_id = $2 AND NOT ($1 = ANY(steps_done))`,
        [body.step, ctx.tenantId]
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
