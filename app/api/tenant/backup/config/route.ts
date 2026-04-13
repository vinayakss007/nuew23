import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query, queryOne } from '@/lib/db/client';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const CONFIG_KEY_PREFIX = 'tenant_backup_config:';

// ── Encryption helpers ─────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const secret = process.env['ENCRYPTION_KEY'];
  if (!secret) {
    // FIX HIGH-13: Don't use hardcoded fallback in production
    // In production, ENCRYPTION_KEY MUST be set
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ENCRYPTION_KEY environment variable is required in production. ' +
        'Generate a secure key: openssl rand -hex 32'
      );
    }
    // Dev mode: use SESSION_SECRET if available, otherwise generate from app name
    const fallback = process.env['SESSION_SECRET'] || `dev-key-${process.env['APP_NAME'] || 'nucrm'}-${process.env.NODE_ENV}`;
    console.warn('[WARNING] Using derived encryption key in non-production. Set ENCRYPTION_KEY for better security.');
    return scryptSync(fallback, 'tenant-backup-salt-v2', 32); // Updated salt
  }
  // If key is hex-encoded, decode it; otherwise hash it to 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, 'hex');
  }
  return scryptSync(secret, 'tenant-backup-salt-v2', 32); // Updated salt
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ── Ensure platform_settings table exists ──────────────────────

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS public.platform_settings (
      key        text primary key,
      value      text not null,
      updated_at timestamptz default now()
    )`).catch(() => {});
}

// ── Parse config from DB rows ──────────────────────────────────

interface RawConfig {
  endpoint_url: string;
  bucket: string;
  access_key: string;
  secret_key_encrypted: string;
  region: string;
  backup_type: string;
  enabled: string;
  tenant_id: string;
}

function parseConfig(rows: { key: string; value: string }[], tenantId: string): RawConfig | null {
  const prefix = `${CONFIG_KEY_PREFIX}${tenantId}`;
  const config: Record<string, string> = {};
  for (const row of rows) {
    if (row.key.startsWith(prefix)) {
      const field = row.key.replace(prefix + ':', '');
      config[field] = row.value;
    }
  }

  if (!config['bucket'] && !config['endpoint_url']) return null;

  return {
    endpoint_url: config['endpoint_url'] || '',
    bucket: config['bucket'] || '',
    access_key: config['access_key'] || '',
    secret_key_encrypted: config['secret_key'] || '',
    region: config['region'] || 'us-east-1',
    backup_type: config['backup_type'] || 'full',
    enabled: config['enabled'] ?? 'true',
    tenant_id: tenantId,
  };
}

// ── GET: Read config (decrypts secrets, never returns raw secret_key) ──

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    await ensureTable();

    const { rows } = await query<{ key: string; value: string; updated_at?: string }>(
      `SELECT key, value, updated_at FROM public.platform_settings WHERE key LIKE $1`,
      [`${CONFIG_KEY_PREFIX}${ctx.tenantId}:%`]
    );

    const raw = parseConfig(rows, ctx.tenantId);
    if (!raw) {
      return NextResponse.json({ data: null });
    }

    // Decrypt secret_key for the config response
    let decryptedSecret = '';
    if (raw.secret_key_encrypted) {
      try {
        decryptedSecret = decrypt(raw.secret_key_encrypted);
      } catch {
        // If decryption fails, leave it empty – user will need to re-enter
      }
    }

    // FIX LOW-08: Get actual timestamps from the platform_settings table
    const updatedAt = rows[0]?.updated_at ?? null;

    return NextResponse.json({
      data: {
        tenant_id: raw.tenant_id,
        endpoint_url: raw.endpoint_url,
        bucket: raw.bucket,
        access_key: raw.access_key,
        // Do NOT return secret_key – frontend will show placeholder
        region: raw.region,
        backup_type: raw.backup_type,
        enabled: raw.enabled === 'true',
        created_at: updatedAt,
        updated_at: updatedAt,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── PUT: Save config (encrypts sensitive fields) ──

export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      endpoint_url = '',
      bucket,
      access_key = '',
      secret_key,
      region = 'us-east-1',
      backup_type = 'full',
      enabled = true,
    } = body;

    // Validation
    if (!bucket || !bucket.trim()) {
      return NextResponse.json({ error: 'Bucket name is required' }, { status: 400 });
    }
    if (!access_key || !access_key.trim()) {
      return NextResponse.json({ error: 'Access key is required' }, { status: 400 });
    }

    await ensureTable();

    const prefix = `${CONFIG_KEY_PREFIX}${ctx.tenantId}`;

    // Encrypt secret_key if provided
    let secretValue = '';
    if (secret_key && secret_key.trim()) {
      secretValue = encrypt(secret_key.trim());
    }

    const fields: Record<string, string> = {
      endpoint_url: endpoint_url.trim(),
      bucket: bucket.trim(),
      access_key: access_key.trim(),
      region: region.trim(),
      backup_type,
      enabled: String(enabled),
    };

    // Build upsert queries for each field
    const queries: Promise<any>[] = [];
    for (const [field, value] of Object.entries(fields)) {
      queries.push(
        query(
          `INSERT INTO public.platform_settings (key, value, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
          [`${prefix}:${field}`, value]
        )
      );
    }

    // Only update secret_key if a new one is provided
    if (secretValue) {
      queries.push(
        query(
          `INSERT INTO public.platform_settings (key, value, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
          [`${prefix}:secret_key`, secretValue]
        )
      );
    }

    await Promise.all(queries);

    return NextResponse.json({
      ok: true,
      data: {
        tenant_id: ctx.tenantId,
        endpoint_url: endpoint_url.trim(),
        bucket: bucket.trim(),
        access_key: access_key.trim(),
        region: region.trim(),
        backup_type,
        enabled,
      },
    });
  } catch (err: any) {
    console.error('[tenant-backup-config] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── DELETE: Remove config ──

export async function DELETE(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    await ensureTable();

    await query(
      `DELETE FROM public.platform_settings WHERE key LIKE $1`,
      [`${CONFIG_KEY_PREFIX}${ctx.tenantId}:%`]
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
