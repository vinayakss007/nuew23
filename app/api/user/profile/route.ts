import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { full_name, phone, timezone } = await request.json();
    const allowed = ['full_name','phone','timezone'];
    const updates: Record<string,any> = {};
    if (full_name !== undefined) updates['full_name'] = full_name.trim();
    if (phone !== undefined) updates['phone'] = phone?.trim() || null;
    if (timezone !== undefined) updates['timezone'] = timezone;
    if (!Object.keys(updates).length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    let i = 1;
    const sets = Object.keys(updates).map(k => `"${k}"=$${i++}`).join(', ');
    const { rows:[user] } = await query(
      `UPDATE public.users SET ${sets}, updated_at=now() WHERE id=$${i} RETURNING id,email,full_name,phone,timezone`,
      [...Object.values(updates), ctx.userId]
    );
    return NextResponse.json({ user });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
