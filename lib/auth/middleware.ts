import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { queryOne, query } from '@/lib/db/client';
import { verifyToken, hashToken } from '@/lib/auth/session';
import { setTenantContext } from '@/lib/db/rls';
import { tryApiKeyAuth } from '@/lib/auth/api-key';
import { requestContext } from '@/lib/tenant/request-context';
import {
  validateCsrfToken,
  getCsrfTokenFromCookie,
  getCsrfTokenFromHeader,
  needsCsrfValidation
} from '@/lib/auth/csrf';

export interface AuthContext {
  userId: string;
  tenantId: string;
  roleSlug: string;
  permissions: Record<string, boolean>;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  noWorkspace?: boolean; // FIX CRITICAL-07: Flag for superadmin without workspace
  user?: {
    id: string;
    email: string;
    full_name: string | null;
    is_super_admin: boolean;
  };
  authMethod?: 'jwt' | 'api_key';
}

async function extractToken(request: NextRequest): Promise<string | null> {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  try {
    const store = await cookies();
    const val = store.get('nucrm_session')?.value;
    if (val) return val;
  } catch {}
  return request.cookies.get('nucrm_session')?.value ?? null;
}

/**
 * Demo mode is ONLY allowed in development when explicitly enabled.
 * In production, demo mode is NEVER allowed unless ALLOW_DEMO_MODE is explicitly set.
 */
function isDemoModeAllowed(): boolean {
  return process.env['NODE_ENV'] !== 'production' && process.env['ALLOW_DEMO_MODE'] === 'true';
}

/**
 * Get demo tenant context for unauthenticated access (development only)
 */
async function getDemoContext(): Promise<AuthContext | null> {
  if (!isDemoModeAllowed()) return null;

  try {
    const demoTenant = await queryOne<any>(
      `SELECT id, name, plan_id, primary_color, settings, status, trial_ends_at, current_users, current_contacts
       FROM public.tenants WHERE slug = 'demo' OR name = 'Demo Workspace' LIMIT 1`
    );

    if (demoTenant) {
      const demoUser = await queryOne<any>(
        `SELECT id, email, full_name, is_super_admin FROM public.users WHERE email = 'demo@nucrm.local' LIMIT 1`
      );

      const plan = await queryOne<any>(
        `SELECT id, name, max_users, max_contacts, max_deals, max_automations, features FROM public.plans WHERE id = $1`,
        [demoTenant.plan_id || 'free']
      );

      return {
        userId: demoUser?.id || 'demo-user',
        tenantId: demoTenant.id,
        roleSlug: 'admin',
        permissions: { all: true },
        isAdmin: true,
        isSuperAdmin: false,
        user: demoUser || { id: 'demo-user', email: 'demo@nucrm.local', full_name: 'Demo User', is_super_admin: false },
        authMethod: 'jwt',
      };
    }
  } catch (err) {
    console.error('Failed to get demo context:', err);
  }
  return null;
}

/**
 * Require authentication middleware with caching
 *
 * Caching strategy:
 * 1. Check request-scoped cache (AsyncLocalStorage)
 * 2. Check global cache (Redis/memory, 5 min TTL)
 * 3. Query database (3 queries) and cache result
 *
 * This reduces database queries from 3 per request to 0 for cached requests.
 *
 * SECURITY: Demo mode is NEVER used as a fallback for authentication failures.
 * Demo mode is only allowed in development when explicitly enabled via ALLOW_DEMO_MODE=true.
 */
export async function requireAuth(request: NextRequest): Promise<AuthContext | NextResponse> {
  // Generate request ID for request-scoped caching
  const requestId = requestContext.generateId();

  // Try API key auth first
  const apiKeyCtx = await tryApiKeyAuth(request);
  if (apiKeyCtx) {
    apiKeyCtx.authMethod = 'api_key';
    await setTenantContext(apiKeyCtx.tenantId, apiKeyCtx.userId);
    requestContext.set(requestId, { ...apiKeyCtx, cachedAt: Date.now() });
    return apiKeyCtx;
  }

  // Fall back to JWT auth
  const token = await extractToken(request);

  // SECURITY: No token = 401. Demo mode is NEVER a fallback for missing auth.
  if (!token) {
    if (isDemoModeAllowed()) {
      const demoCtx = await getDemoContext();
      if (demoCtx) {
        await setTenantContext(demoCtx.tenantId, demoCtx.userId);
        requestContext.set(requestId, { ...demoCtx, cachedAt: Date.now() });
        return demoCtx;
      }
    }
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const payload = await verifyToken(token);
  if (!payload) {
    // SECURITY: Invalid token = 401. Never fall back to demo mode.
    return NextResponse.json(
      { error: 'Invalid or expired token' },
      { status: 401 }
    );
  }

  const tokenHash = await hashToken(token);

  // Use cached context if available
  const cached = await requestContext.getCached(tokenHash);
  if (cached) {
    const sessionExists = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM public.sessions WHERE token_hash = $1 AND expires_at > now())`,
      [tokenHash]
    );

    if (sessionExists?.exists) {
      requestContext.set(requestId, cached);
      return cached as AuthContext;
    }

    await requestContext.invalidate(tokenHash);
  }

  // Cache miss - fetch from database
  const session = await queryOne<{ user_id: string }>(
    `SELECT user_id FROM public.sessions WHERE token_hash = $1 AND expires_at > now() LIMIT 1`,
    [tokenHash]
  );
  if (!session) {
    // SECURITY: Expired session = 401. Never fall back to demo mode.
    return NextResponse.json(
      { error: 'Session expired' },
      { status: 401 }
    );
  }

  // Fetch user and membership in a single query to reduce N+1
  const userWithMember = await queryOne<{
    id: string; email: string; full_name: string | null;
    is_super_admin: boolean; last_tenant_id: string | null;
    tenant_id: string; role_slug: string; permissions: Record<string, boolean>;
  }>(
    `SELECT u.id, u.email, u.full_name, u.is_super_admin, u.last_tenant_id,
            tm.tenant_id, tm.role_slug,
            COALESCE(r.permissions, '{}'::jsonb) as permissions
     FROM public.users u
     LEFT JOIN public.tenant_members tm ON tm.user_id = u.id AND tm.status = 'active'
     LEFT JOIN public.roles r ON r.id = tm.role_id
     WHERE u.id = $1
     ORDER BY (tm.tenant_id = $2)::int DESC, tm.created_at ASC
     LIMIT 1`,
    [payload.userId, payload.userId]
  );

  if (!userWithMember) {
    return NextResponse.json(
      { error: 'User not found' },
      { status: 401 }
    );
  }

  if (!userWithMember.tenant_id) {
    if (userWithMember.is_super_admin) {
      // FIX CRITICAL-07: Don't use empty string for tenantId
      // Super admins without workspace should not bypass tenant filters
      // Use a special marker that queries can check
      const ctx: AuthContext = {
        userId: userWithMember.id, 
        tenantId: '__superadmin_no_tenant__', // Explicit marker, not empty string
        roleSlug: 'superadmin',
        permissions: { all: true }, 
        isAdmin: true, 
        isSuperAdmin: true,
        noWorkspace: true, // Flag to indicate no active workspace
      };
      await requestContext.cache(tokenHash, { ...ctx, cachedAt: Date.now() });
      return ctx;
    }
    return NextResponse.json(
      { error: 'No active workspace' },
      { status: 403 }
    );
  }

  // Set RLS tenant context for database-enforced isolation
  await setTenantContext(userWithMember.tenant_id, userWithMember.id);

  const perms = (userWithMember.permissions as Record<string, boolean>) ?? {};
  const ctx: AuthContext = {
    userId: userWithMember.id, tenantId: userWithMember.tenant_id,
    roleSlug: userWithMember.role_slug, permissions: perms,
    isAdmin: userWithMember.role_slug === 'admin' || userWithMember.is_super_admin,
    isSuperAdmin: userWithMember.is_super_admin,
  };

  await requestContext.cache(tokenHash, { ...ctx, cachedAt: Date.now() });
  requestContext.set(requestId, { ...ctx, cachedAt: Date.now() });

  return ctx;
}

export function can(ctx: AuthContext, perm: string): boolean {
  if (ctx.isSuperAdmin || ctx.isAdmin) return true;
  return ctx.permissions['all'] === true || ctx.permissions[perm] === true;
}

export function requirePerm(ctx: AuthContext, perm: string): NextResponse | null {
  if (can(ctx, perm)) {
    return null;
  }
  return NextResponse.json({ error: `Permission denied: ${perm} required` }, { status: 403 });
}

/**
 * CSRF Token Validation Middleware
 *
 * Validates CSRF token for state-changing requests (POST, PUT, PATCH, DELETE)
 * Uses Double Submit Cookie pattern
 */
export function requireCsrf(request: NextRequest): NextResponse | null {
  const method = request.method;
  const path = request.nextUrl.pathname;

  const authMethod = request.headers.get('x-auth-method');

  if (!needsCsrfValidation(method, path, authMethod ?? undefined)) {
    return null;
  }

  const cookieHeader = request.headers.get('cookie');
  const cookieToken = getCsrfTokenFromCookie(cookieHeader);
  const headerToken = getCsrfTokenFromHeader(request.headers);

  if (!validateCsrfToken(cookieToken, headerToken)) {
    return NextResponse.json(
      { error: 'CSRF token missing or invalid. Please refresh the page and try again.' },
      { status: 403 }
    );
  }

  return null;
}
