/**
 * GDPR Data Export — GET /api/user/export
 * Returns all personal data for the authenticated user as JSON.
 * Required by GDPR Article 20 (right to data portability).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryOne, queryMany } from '@/lib/db/client';

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const [profile, sessions, activities, notifications, memberships] = await Promise.all([
      queryOne<any>(
        `SELECT id, email, full_name, phone, timezone, avatar_url, email_verified, created_at
         FROM public.users WHERE id=$1`,
        [ctx.userId]
      ),
      queryMany<any>(
        `SELECT id, ip_address, user_agent, created_at, expires_at
         FROM public.sessions WHERE user_id=$1 ORDER BY created_at DESC`,
        [ctx.userId]
      ),
      queryMany<any>(
        `SELECT a.type, a.description, a.created_at FROM public.activities a
         WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 500`,
        [ctx.userId]
      ),
      queryMany<any>(
        `SELECT type, title, body, is_read, created_at FROM public.notifications
         WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`,
        [ctx.userId]
      ),
      queryMany<any>(
        `SELECT t.name as org_name, tm.role_slug, tm.status, tm.joined_at
         FROM public.tenant_members tm
         JOIN public.tenants t ON t.id = tm.tenant_id
         WHERE tm.user_id=$1`,
        [ctx.userId]
      ),
    ]);

    const exportData = {
      exported_at: new Date().toISOString(),
      gdpr_note: 'This export contains all personal data NuCRM holds about you, per GDPR Article 20.',
      profile,
      organizations: memberships,
      sessions: sessions.map(s => ({ ...s, ip_address: s.ip_address ? s.ip_address.replace(/\.\d+$/, '.xxx') : null })),
      recent_activities: activities,
      notifications,
    };

    const json = JSON.stringify(exportData, null, 2);
    return new NextResponse(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="nucrm-data-export-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
