import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne, query, withTransaction } from '@/lib/db/client';
import { hashPassword } from '@/lib/auth/session';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error:'Forbidden' }, { status:403 });
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('q')?.trim();
    const status = searchParams.get('status');
    const params: any[] = [];
    let where = '1=1';
    if (search) { params.push(`%${search}%`); where += ` AND (t.name ILIKE $${params.length} OR t.slug ILIKE $${params.length} OR t.billing_email ILIKE $${params.length})`; }
    if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
    const data = await queryMany(
      `SELECT t.*, p.name as plan_name, p.price_monthly,
              u.full_name as owner_name, u.email as owner_email,
              (SELECT count(*)::int FROM public.tenant_members WHERE tenant_id=t.id AND status='active') as member_count
       FROM public.tenants t
       JOIN public.plans p ON p.id=t.plan_id
       LEFT JOIN public.users u ON u.id=t.owner_id
       WHERE ${where}
       ORDER BY t.created_at DESC LIMIT 100`,
      params
    );
    return NextResponse.json({ data });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error:'Forbidden' }, { status:403 });

    const { name, plan_id='free', status='active', billing_email, primary_color='#7c3aed',
            owner_email, owner_name, owner_password, trial_days=14 } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error:'name required' }, { status:400 });

    const slug = name.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,40) + '-' + Date.now().toString(36);

    const result = await withTransaction(async (client) => {
      // Create tenant
      const { rows:[tenant] } = await client.query(
        `INSERT INTO public.tenants (name,slug,plan_id,status,billing_email,primary_color,trial_ends_at)
         VALUES ($1,$2,$3,$4,$5,$6,now()+($7||' days')::interval) RETURNING *`,
        [name.trim(), slug, plan_id, status, billing_email||null, primary_color, trial_days]
      );

      // Create owner user if email provided
      let owner = null;
      if (owner_email?.trim()) {
        const existing = await client.query('SELECT id FROM public.users WHERE email=$1', [owner_email.toLowerCase()]);
        if (existing.rows[0]) {
          owner = existing.rows[0];
        } else {
          const pwd = owner_password || Math.random().toString(36).slice(2,10) + 'A1!';
          const ownerPasswordHash = await hashPassword(pwd);
          const { rows:[u] } = await client.query(
            `INSERT INTO public.users (email,full_name,password_hash,email_verified)
             VALUES ($1,$2,$3,true) RETURNING id,email`,
            [owner_email.toLowerCase(), owner_name||owner_email, ownerPasswordHash]
          );
          owner = { ...u, temp_password: !owner_password ? pwd : undefined };
        }
        // Add as admin member
        await client.query(
          `INSERT INTO public.tenant_members (tenant_id,user_id,role_slug,status)
           VALUES ($1,$2,'admin','active') ON CONFLICT DO NOTHING`,
          [tenant.id, owner.id]
        );
        await client.query('UPDATE public.tenants SET owner_id=$1 WHERE id=$2', [owner.id, tenant.id]);
        await client.query('UPDATE public.users SET last_tenant_id=$1 WHERE id=$2', [tenant.id, owner.id]);
      }

      return { tenant, owner };
    });

    return NextResponse.json({ data: result }, { status:201 });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}

export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error:'Forbidden' }, { status:403 });
    const { id, ...updates } = await request.json();
    if (!id) return NextResponse.json({ error:'id required' }, { status:400 });
    const allowed = ['name','plan_id','status','billing_email','primary_color','logo_url','custom_domain','trial_ends_at','admin_notes','billing_type','manual_paid_until'];
    const fields = Object.keys(updates).filter(k => allowed.includes(k));
    if (!fields.length) return NextResponse.json({ error:'No valid fields to update' }, { status:400 });
    let i = 1;
    const sets = fields.map(k => `"${k}"=$${i++}`).join(',');
    const vals = [...fields.map(k => updates[k]), id];
    const { rows:[row] } = await query(`UPDATE public.tenants SET ${sets},updated_at=now() WHERE id=$${i} RETURNING *`, vals);
    if (!row) return NextResponse.json({ error:'Not found' }, { status:404 });
    return NextResponse.json({ data:row });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error:'Forbidden' }, { status:403 });
    const { id, hard_delete } = await request.json();
    if (!id) return NextResponse.json({ error:'id required' }, { status:400 });
    if (hard_delete) {
      // Full delete — cascades to all tenant data
      await query('DELETE FROM public.tenants WHERE id=$1', [id]);
    } else {
      // Suspend
      await query(`UPDATE public.tenants SET status='suspended',updated_at=now() WHERE id=$1`, [id]);
    }
    return NextResponse.json({ ok:true });
  } catch (err:any) { return NextResponse.json({ error:err.message }, { status:500 }); }
}
