import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { revokeApiKey, rotateApiKey, getApiKeyUsage } from '@/lib/auth/api-key';
import { queryOne } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * GET /api/tenant/api-keys/[id]
 * Get API key details and usage stats
 */
export async function GET(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const key = await queryOne<{
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
       WHERE id = $1 AND tenant_id = $2`,
      [(await params).id, ctx.tenantId]
    );

    if (!key) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    // Get usage stats (last 7 days)
    const usage = await getApiKeyUsage((await params).id, 7);

    return NextResponse.json({
      data: {
        ...key,
        scopes: Array.isArray(key.scopes) ? key.scopes : [],
        usage,
      },
    });
  } catch (error: any) {
    console.error('[API Keys] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/tenant/api-keys/[id]
 * Revoke (delete) API key
 */
export async function DELETE(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const revoked = await revokeApiKey((await params).id, ctx.tenantId);
    if (!revoked) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, message: 'API key revoked' });
  } catch (error: any) {
    console.error('[API Keys] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/api-keys/[id]/rotate
 * Rotate API key (revoke old, create new)
 */
export async function POST(
  request: NextRequest,
  { params }: any
) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'settings.manage')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // Get existing key info
    const existingKey = await queryOne<{
      name: string;
      scopes: string[];
    }>(
      `SELECT name, scopes FROM public.api_keys WHERE id = $1 AND tenant_id = $2`,
      [(await params).id, ctx.tenantId]
    );

    if (!existingKey) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    // Rotate key
    const result = await rotateApiKey(
      (await params).id,
      ctx.tenantId,
      ctx.userId,
      existingKey.name,
      Array.isArray(existingKey.scopes) ? existingKey.scopes : []
    );

    if (!result) {
      return NextResponse.json({ error: 'Failed to rotate key' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      key: result.key,
      prefix: result.prefix,
      warning: 'Store this key securely. It will not be shown again. The old key is now invalid.',
    });
  } catch (error: any) {
    console.error('[API Keys] ROTATE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
