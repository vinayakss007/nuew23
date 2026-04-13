import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { generateApiKey, revokeApiKey } from '@/lib/auth/api-key';
import { queryMany } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * GET /api/tenant/api-keys
 * List all API keys for current tenant
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const keys = await queryMany<{
      id: string;
      name: string;
      key_prefix: string;
      scopes: string[];
      is_active: boolean;
      expires_at: string | null;
      last_used_at: string | null;
      created_at: string;
    }>(
      `SELECT id, name, key_prefix, scopes, is_active, expires_at, last_used_at, created_at
       FROM public.api_keys
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [ctx.tenantId]
    );

    return NextResponse.json({
      data: keys.map(k => ({
        ...k,
        // Never return full key, only prefix
        scopes: Array.isArray(k.scopes) ? k.scopes : [],
      })),
    });
  } catch (error: any) {
    console.error('[API Keys] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/api-keys
 * Create new API key
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { name, scopes, expires_in_days } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    if (!Array.isArray(scopes) || scopes.length === 0) {
      return NextResponse.json({ error: 'At least one scope is required' }, { status: 400 });
    }

    // Calculate expiry date
    let expiresAt = null;
    if (expires_in_days && typeof expires_in_days === 'number') {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expires_in_days);
    }

    // Generate key (expiry passed directly to INSERT, no separate UPDATE needed)
    const { key, prefix } = await generateApiKey(
      ctx.tenantId,
      ctx.userId,
      name.trim(),
      scopes,
      expiresAt ? expiresAt.toISOString() : null
    );

    return NextResponse.json({
      ok: true,
      key,
      prefix,
      warning: 'Store this key securely. It will not be shown again.',
    }, { status: 201 });
  } catch (error: any) {
    console.error('[API Keys] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
