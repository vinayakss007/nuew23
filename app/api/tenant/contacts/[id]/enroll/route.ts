import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';

export async function POST(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'automations.manage');
    if (deny) return deny;
    const { sequence_id } = await req.json();
    if (!sequence_id) return NextResponse.json({ error: 'sequence_id required' }, { status: 400 });

    // Verify contact belongs to this tenant
    const contact = await queryOne('SELECT id FROM public.contacts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL', [(await params).id, ctx.tenantId]);
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

    // Verify sequence belongs to this tenant
    const seq = await queryOne<any>('SELECT id, steps FROM public.sequences WHERE id=$1 AND tenant_id=$2 AND is_active=true', [sequence_id, ctx.tenantId]);
    if (!seq) return NextResponse.json({ error: 'Sequence not found or inactive' }, { status: 404 });

    const steps = Array.isArray(seq.steps) ? seq.steps : [];
    const firstDelay = steps[0]?.delay_days ?? 0;
    const nextRun = new Date(Date.now() + firstDelay * 86400000).toISOString();

    const { rows:[enrollment] } = await query(
      `INSERT INTO public.sequence_enrollments (tenant_id,sequence_id,contact_id,current_step,status,next_run_at)
       VALUES ($1,$2,$3,0,'active',$4)
       ON CONFLICT (sequence_id,contact_id) DO UPDATE
         SET status='active', current_step=0, next_run_at=$4, enrolled_at=now()
       RETURNING *`,
      [ctx.tenantId, sequence_id, (await params).id, nextRun]
    );
    await query('UPDATE public.sequences SET enroll_count=enroll_count+1 WHERE id=$1', [sequence_id]).catch(()=>{});
    return NextResponse.json({ data: enrollment }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { sequence_id } = await req.json();
    if (!sequence_id) return NextResponse.json({ error: 'sequence_id required' }, { status: 400 });
    // FIX CRITICAL-04: Added tenant_id filter to prevent cross-tenant cancellation
    await query(
      `UPDATE public.sequence_enrollments SET status='cancelled' WHERE contact_id=$1 AND sequence_id=$2 AND tenant_id=$3`,
      [(await params).id, sequence_id, ctx.tenantId]
    );
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
