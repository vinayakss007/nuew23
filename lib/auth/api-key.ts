/**
 * API Key Authentication Middleware
 * Validates API keys and sets auth context
 */

import { NextRequest } from 'next/server';
import { queryOne, query } from '@/lib/db/client';
import { AuthContext } from '@/lib/auth/middleware';
import { createHash } from 'crypto';

/**
 * Try to authenticate via API key
 * Returns null if not an API key request
 */
export async function tryApiKeyAuth(request: NextRequest): Promise<AuthContext | null> {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ak_')) return null;

  const rawKey = auth.slice(7);
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const row = await queryOne<{
    tenant_id: string;
    user_id: string;
    scopes: string[];
    is_active: boolean;
    is_super_admin: boolean;
  }>(
    `SELECT ak.tenant_id, ak.user_id, ak.scopes, ak.is_active,
            u.is_super_admin
     FROM public.api_keys ak
     JOIN public.users u ON u.id = ak.user_id
     WHERE ak.key_hash = $1 
       AND ak.is_active = true
       AND (ak.expires_at IS NULL OR ak.expires_at > now())`,
    [keyHash]
  );

  if (!row) return null;

  // Update last used
  await query(
    `UPDATE public.api_keys
     SET last_used_at = now(), last_used_ip = $1
     WHERE key_hash = $2`,
    [request.headers.get('x-forwarded-for')?.split(',')[0] ?? null, keyHash]
  );

  // Log usage
  try {
    await query(
      `INSERT INTO public.api_key_usage 
       (api_key_id, tenant_id, user_id, endpoint, method, ip_address, user_agent)
       SELECT id, $2, $3, $4, $5, $6, $7
       FROM public.api_keys WHERE key_hash = $1`,
      [keyHash, row.tenant_id, row.user_id, request.nextUrl.pathname, request.method, request.headers.get('x-forwarded-for')?.split(',')[0] ?? null, request.headers.get('user-agent')]
    );
  } catch (err) {
    console.error('[API Key] Failed to log usage:', err);
  }

  // Map scopes to permissions
  const scopes: string[] = Array.isArray(row.scopes) ? row.scopes : [];
  const permissions: Record<string, boolean> = {};
  
  for (const scope of scopes) {
    if (scope === 'all') {
      permissions['all'] = true;
    } else {
      permissions[scope] = true;
    }
  }

  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    roleSlug: 'api',
    permissions,
    isAdmin: scopes.includes('all') || scopes.some(s => s.endsWith(':all')),
    isSuperAdmin: row.is_super_admin,
  };
}

/**
 * Check if context has required scope
 */
export function hasScope(ctx: AuthContext, requiredScope: string): boolean {
  if (ctx.isSuperAdmin) return true;
  if (ctx.permissions['all']) return true;
  
  // Check exact scope
  if (ctx.permissions[requiredScope]) return true;
  
  // Check wildcard (e.g., contacts:all covers contacts:read)
  const [resource] = requiredScope.split(':');
  if (ctx.permissions[`${resource}:all`]) return true;
  
  return false;
}

/**
 * Generate a new API key
 */
export async function generateApiKey(
  tenantId: string,
  userId: string,
  name: string,
  scopes: string[],
  expiresAt?: string | null
): Promise<{ key: string; prefix: string }> {
  const { randomBytes } = await import('crypto');
  
  // Generate key (ak_<type>_<random>)
  const keyType = 'live'; // or 'test' for test keys
  const randomPart = randomBytes(24).toString('hex');
  const fullKey = `ak_${keyType}_${randomPart}`;
  const prefix = `ak_${keyType}_${randomPart.slice(0, 6)}`;
  
  const keyHash = createHash('sha256').update(fullKey).digest('hex');
  
  // Store in database
  await query(
    `INSERT INTO public.api_keys
     (tenant_id, user_id, name, key_hash, key_prefix, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [tenantId, userId, name, keyHash, prefix, JSON.stringify(scopes), expiresAt || null]
  );
  
  return { key: fullKey, prefix };
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(keyId: string, tenantId: string): Promise<boolean> {
  const result = await query(
    `UPDATE public.api_keys 
     SET is_active = false 
     WHERE id = $1 AND tenant_id = $2`,
    [keyId, tenantId]
  );
  
  return (result.rowCount ?? 0) > 0;
}

/**
 * Rotate an API key (revoke old, create new)
 */
export async function rotateApiKey(
  keyId: string,
  tenantId: string,
  userId: string,
  name: string,
  scopes: string[]
): Promise<{ key: string; prefix: string } | null> {
  // Revoke old key
  const revoked = await revokeApiKey(keyId, tenantId);
  if (!revoked) return null;
  
  // Generate new key
  return await generateApiKey(tenantId, userId, name, scopes);
}

/**
 * Get API key usage stats
 */
export async function getApiKeyUsage(
  keyId: string,
  days: number = 7
): Promise<{ total: number; byEndpoint: any[]; byStatus: any[] }> {
  const [total, byEndpoint, byStatus] = await Promise.all([
    query<{ count: string }>(
      `SELECT count(*)::text as count 
       FROM public.api_key_usage 
       WHERE api_key_id = $1 
         AND created_at > now() - interval '${days} days'`,
      [keyId]
    ),
    query<{ endpoint: string; count: string }>(
      `SELECT endpoint, count(*)::text as count 
       FROM public.api_key_usage 
       WHERE api_key_id = $1 
         AND created_at > now() - interval '${days} days'
       GROUP BY endpoint
       ORDER BY count DESC
       LIMIT 10`,
      [keyId]
    ),
    query<{ status_code: number; count: string }>(
      `SELECT status_code, count(*)::text as count 
       FROM public.api_key_usage 
       WHERE api_key_id = $1 
         AND created_at > now() - interval '${days} days'
       GROUP BY status_code
       ORDER BY status_code`,
      [keyId]
    ),
  ]);
  
  return {
    total: parseInt(total.rows[0]?.count ?? '0', 10),
    byEndpoint: byEndpoint.rows.map(r => ({ endpoint: r.endpoint, count: parseInt(r.count, 10) })),
    byStatus: byStatus.rows.map(r => ({ status: r.status_code, count: parseInt(r.count, 10) })),
  };
}
