import { logAudit } from '@/lib/audit';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, can } from '@/lib/auth/middleware';
import { queryOne, query } from '@/lib/db/client';
import { sendEmail } from '@/lib/email/service';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'team.invite') && !ctx.isAdmin) {
      return NextResponse.json({ error: 'Permission denied: team.invite required' }, { status: 403 });
    }

    const { email, roleSlug = 'sales_rep' } = await request.json();
    if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
    const emailLower = email.trim().toLowerCase();

    // Check if already a member
    const existing = await queryOne<any>(
      `SELECT tm.id FROM public.tenant_members tm
       JOIN public.users u ON u.id = tm.user_id
       WHERE tm.tenant_id = $1 AND u.email = $2 AND tm.status = 'active'`,
      [ctx.tenantId, emailLower]
    );
    if (existing) return NextResponse.json({ error: 'This person is already a team member' }, { status: 409 });

    // Check plan user limits
    const [tenant, plan] = await Promise.all([
      queryOne<any>('SELECT name, primary_color, current_users, plan_id FROM public.tenants WHERE id=$1', [ctx.tenantId]),
      queryOne<any>('SELECT max_users FROM public.plans p JOIN public.tenants t ON t.plan_id=p.id WHERE t.id=$1', [ctx.tenantId]),
    ]);
    if (plan && plan.max_users > 0 && (tenant?.current_users ?? 0) >= plan.max_users) {
      return NextResponse.json({ error: `User limit (${plan.max_users}) reached. Upgrade your plan.` }, { status: 403 });
    }

    // Upsert invitation
    const { rows: [inv] } = await query(
      `INSERT INTO public.invitations (tenant_id, email, role_slug, invited_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, email) DO UPDATE
         SET role_slug=$3, token=encode(gen_random_bytes(32),'hex'),
             expires_at=now()+interval '7 days', accepted_at=NULL
       RETURNING token, email`,
      [ctx.tenantId, emailLower, roleSlug, ctx.userId]
    );

    const inviter = await queryOne<any>('SELECT full_name, email FROM public.users WHERE id=$1', [ctx.userId]);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const inviteUrl = `${appUrl}/auth/invite?token=${inv.token}`;
    const accent = tenant?.primary_color ?? '#7c3aed';
    const roleName = roleSlug.replace(/_/g, ' ');

    await sendEmail({
      to: emailLower,
      subject: `${inviter?.full_name ?? 'Someone'} invited you to join ${tenant?.name} on NuCRM`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto">
          <div style="height:4px;background:linear-gradient(90deg,${accent},#4f46e5);border-radius:4px 4px 0 0"></div>
          <div style="padding:40px 32px;background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
            <div style="width:48px;height:48px;background:${accent};border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:20px">
              <span style="color:#fff;font-size:20px;font-weight:700">${tenant?.name?.charAt(0)?.toUpperCase()}</span>
            </div>
            <h2 style="margin:0 0 8px;color:#111827;font-size:20px">You're invited to ${tenant?.name}</h2>
            <p style="color:#6b7280;margin:0 0 8px;font-size:14px">
              <strong>${inviter?.full_name ?? inviter?.email}</strong> has invited you to join as
              <strong style="text-transform:capitalize">${roleName}</strong>.
            </p>
            <p style="color:#6b7280;margin:0 0 28px;font-size:14px">Click the button below to accept and set up your account.</p>
            <a href="${inviteUrl}" style="display:inline-block;background:${accent};color:#fff;padding:13px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
              Accept Invitation →
            </a>
            <p style="color:#9ca3af;font-size:12px;margin-top:24px">
              Link expires in 7 days.<br>
              <a href="${inviteUrl}" style="color:${accent};word-break:break-all">${inviteUrl}</a>
            </p>
          </div>
        </div>`,
      text: `${inviter?.full_name} invited you to ${tenant?.name} on NuCRM. Accept: ${inviteUrl}`,
    });

    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'invite_sent', resourceType:'invitation', newData: { email: emailLower, role: roleSlug } });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[invite/send]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
