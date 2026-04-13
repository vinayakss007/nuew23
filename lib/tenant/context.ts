/**
 * Server-side tenant context helpers.
 * Used in Next.js server components and layouts.
 */
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken } from '@/lib/auth/session';
import { queryOne } from '@/lib/db/client';
import type { TenantContext } from '@/types';

export async function requireTenantCtx(): Promise<TenantContext> {
  const cookieStore = await cookies();
  const token = cookieStore.get('nucrm_session')?.value;
  
  // If no token, use demo fallback only in dev mode — NEVER in production
  if (!token) {
    if (process.env.NODE_ENV === 'production' || process.env['ALLOW_DEMO_MODE'] !== 'true') {
      redirect('/auth/login');
    }
    // Try to get or create default demo tenant
    const demoTenant = await queryOne<any>(
      `SELECT id, name, plan_id, primary_color, settings, status, trial_ends_at, current_users, current_contacts
       FROM public.tenants WHERE slug = 'demo' OR name = 'Demo Workspace' LIMIT 1`
    );
    
    if (demoTenant) {
      // Get or create demo user
      const demoUser = await queryOne<any>(
        `SELECT id, is_super_admin FROM public.users WHERE email = 'demo@nucrm.local' LIMIT 1`
      );
      
      const userId = demoUser?.id || 'demo-user';
      const plan = await queryOne<any>(
        `SELECT id, name, max_users, max_contacts, max_deals, max_automations, features FROM public.plans WHERE id = $1`,
        [demoTenant.plan_id || 'free']
      );
      
      return {
        userId,
        tenantId: demoTenant.id,
        roleSlug: 'admin',
        permissions: { all: true },
        isAdmin: true,
        isSuperAdmin: false,
        tenant: {
          id: demoTenant.id,
          status: demoTenant.status || 'active',
          trial_ends_at: demoTenant.trial_ends_at,
          name: demoTenant.name || 'Demo Workspace',
          plan_id: demoTenant.plan_id || 'free',
          primary_color: demoTenant.primary_color || '#7c3aed',
          settings: demoTenant.settings || {},
          current_users: demoTenant.current_users || 1,
          current_contacts: demoTenant.current_contacts || 0,
        },
        plan: {
          id: plan?.id || 'free',
          name: plan?.name || 'Free',
          max_users: plan?.max_users || 5,
          max_contacts: plan?.max_contacts || 500,
          max_deals: plan?.max_deals || 100,
          max_automations: plan?.max_automations || 3,
          features: plan?.features || [],
        },
      };
    }
    
    // No demo tenant - redirect to setup
    redirect('/setup');
  }

  const payload = await verifyToken(token);
  if (!payload) redirect('/auth/login');

  const row = await queryOne<any>(
    `SELECT
       u.id AS user_id,
       u.is_super_admin,
       tm.tenant_id,
       tm.role_slug,
       COALESCE(r.permissions, '{}'::jsonb) AS permissions,
       t.name AS tenant_name,
       t.plan_id,
       t.primary_color,
       t.settings AS tenant_settings,
       t.status AS tenant_status,
       t.trial_ends_at,
       t.current_users,
       t.current_contacts,
       p.name AS plan_name,
       p.max_users,
       p.max_contacts,
       p.max_deals,
       p.max_automations,
       p.features
     FROM public.users u
     JOIN public.tenant_members tm
       ON tm.user_id = u.id AND tm.status = 'active'
     JOIN public.tenants t ON t.id = tm.tenant_id
     JOIN public.plans p ON p.id = t.plan_id
     LEFT JOIN public.roles r ON r.id = tm.role_id
     WHERE u.id = $1
     ORDER BY (tm.tenant_id = u.last_tenant_id)::int DESC, tm.created_at ASC
     LIMIT 1`,
    [payload.userId]
  );

  if (!row) {
    // Super admin without a workspace - redirect to superadmin console
    const user = await queryOne<any>(
      'SELECT is_super_admin FROM public.users WHERE id = $1', [payload.userId]
    );
    if (user?.is_super_admin) redirect('/superadmin/dashboard');
    redirect('/auth/no-workspace');
  }

  const perms: Record<string, boolean> = row.permissions ?? {};
  const isAdmin = row.role_slug === 'admin' || row.is_super_admin;

  // MISSING-001: Enforce trial expiry — redirect to upgrade page if trial has ended
  if (row.tenant_status === 'trial_expired' ||
      (row.tenant_status === 'trialing' && row.trial_ends_at && new Date(row.trial_ends_at) < new Date())) {
    // Allow billing and settings routes so they can upgrade
    const { headers } = await import('next/headers');
    try {
      const headersList = await headers();
      const pathname = headersList.get('x-invoke-path') ?? headersList.get('next-url') ?? '';
      const isExempt = pathname.startsWith('/tenant/settings') || pathname.startsWith('/tenant/trial-expired') || pathname.startsWith('/api/');
      if (!isExempt) redirect('/tenant/trial-expired');
    } catch {
      redirect('/tenant/trial-expired');
    }
  }

  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    roleSlug: row.role_slug,
    permissions: perms,
    isAdmin,
    isSuperAdmin: row.is_super_admin,
    tenant: {
      id: row.tenant_id,
      status: row.tenant_status,
      trial_ends_at: row.trial_ends_at,
      name: row.tenant_name,
      plan_id: row.plan_id,
      primary_color: row.primary_color ?? '#7c3aed',
      settings: row.tenant_settings ?? {},
      current_users: row.current_users,
      current_contacts: row.current_contacts,
    },
    plan: {
      id: row.plan_id,
      name: row.plan_name,
      max_users: row.max_users,
      max_contacts: row.max_contacts,
      max_deals: row.max_deals,
      max_automations: row.max_automations,
      features: row.features ?? [],
    },
  };
}

/** Check a permission given a TenantContext */
export function can(ctx: TenantContext, perm: string): boolean {
  if (ctx.isSuperAdmin || ctx.isAdmin) return true;
  return ctx.permissions['all'] === true || ctx.permissions[perm] === true;
}

/** Whether the tenant is at or over a resource limit */
export function isAtLimit(ctx: TenantContext, resource: 'contacts' | 'users'): boolean {
  if (ctx.plan.id === 'enterprise') return false;
  const limits: Record<string, number> = {
    contacts: ctx.plan.max_contacts,
    users: ctx.plan.max_users,
  };
  const current: Record<string, number> = {
    contacts: ctx.tenant.current_contacts,
    users: ctx.tenant.current_users,
  };
  const limit = limits[resource];
  if (!limit || limit < 0) return false;
  return (current[resource] ?? 0) >= limit;
}
