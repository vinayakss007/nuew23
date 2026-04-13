import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { queryOne, query, queryMany, buildInsert } from '@/lib/db/client';
import { RateLimiter, getRateLimitHeaders } from '@/lib/rate-limit';
import { fireWebhooks, type WebhookEvent } from '@/lib/webhooks';
import { logAudit } from '@/lib/audit';
import { devLogger } from '@/lib/dev-logger';

// ── Constants ──────────────────────────────────────────────────────────
const MAX_PAYLOAD_SIZE = 1_000_000; // 1 MB
const MAX_BATCH_SIZE = 100;
const VALID_ACTIONS = new Set(['create', 'update', 'upsert']);
const VALID_ENTITIES = new Set(['contact', 'lead', 'deal', 'company', 'task']);

// Rate limiter: 100 requests per API key per minute
const inboundLimiter = new RateLimiter({ max: 100, window: 60 });

// ── In-memory request tracking (last 100 per API key prefix) ──────────
const requestLog = new Map<string, Array<{ ts: number; status: number; path: string }>>();
const MAX_LOG_PER_KEY = 100;

function logRequest(keyPrefix: string, status: number, path: string) {
  const entries = requestLog.get(keyPrefix) ?? [];
  entries.push({ ts: Date.now(), status, path });
  if (entries.length > MAX_LOG_PER_KEY) entries.splice(0, entries.length - MAX_LOG_PER_KEY);
  requestLog.set(keyPrefix, entries);
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Resolve an API key to a tenant. Accepts either a raw key (from header/query)
 * or a key hash. Returns null if the key is invalid, expired, or inactive.
 */
async function resolveApiKey(rawKey: string) {
  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  const row = await queryOne<{
    id: string;
    tenant_id: string;
    user_id: string;
    key_prefix: string;
    scopes: string[];
    is_active: boolean;
    name: string;
  }>(
    `SELECT id, tenant_id, user_id, key_prefix, scopes, is_active, name
     FROM public.api_keys
     WHERE key_hash = $1
       AND is_active = true
       AND (expires_at IS NULL OR expires_at > now())`,
    [keyHash]
  );

  if (!row) return null;

  // Update last_used_at
  await query(
    `UPDATE public.api_keys SET last_used_at = now(), last_used_ip = $1 WHERE key_hash = $2`,
    [null, keyHash]
  );

  return row;
}

/**
 * Sanitize a string value — trim, limit length, strip control characters.
 */
function sanitizeString(val: string | null | undefined, maxLen = 200): string | null {
  if (val == null) return null;
  const s = String(val).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s || null;
}

/**
 * Convert snake_case keys to camelCase for database insertion.
 * Handles both camelCase and snake_case input transparently.
 */
function normalizeFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(data)) {
    // Convert snake_case to camelCase
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = val;
  }
  return out;
}

/**
 * Log a webhook delivery attempt. Silently ignores if the table does not exist.
 */
async function logWebhookDelivery(input: {
  tenantId: string;
  apiKeyId: string | null;
  action: string;
  entity: string;
  status: string;
  statusCode: number;
  errorMessage: string | null;
  recordId: string | null;
  payloadSize: number;
}) {
  try {
    await query(
      `INSERT INTO public.webhook_inbound_logs
       (tenant_id, api_key_id, action, entity, status, status_code, error_message, record_id, payload_size, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
      [
        input.tenantId,
        input.apiKeyId,
        input.action,
        input.entity,
        input.status,
        input.statusCode,
        input.errorMessage?.slice(0, 1000) ?? null,
        input.recordId,
        input.payloadSize,
      ]
    );
  } catch {
    // Table may not exist yet — silently skip
  }
}

// ── Entity handlers ────────────────────────────────────────────────────

interface EntityResult {
  id: string | null;
  action: 'created' | 'updated';
}

/**
 * Create or upsert a contact.
 * Duplicates are prevented by email within the tenant.
 */
async function handleContact(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string
): Promise<EntityResult> {
  const d = normalizeFields(raw);

  const email = sanitizeString(d['email'] as string, 255)?.toLowerCase() ?? null;
  const firstName = sanitizeString(d['firstName'] as string, 100);
  if (!firstName) throw new Error('first_name is required');

  // Check duplicate email
  let existing: any = null;
  if (email) {
    existing = await queryOne(
      `SELECT id FROM public.contacts
       WHERE tenant_id = $1 AND email = $2 AND is_archived = false AND deleted_at IS NULL`,
      [tenantId, email]
    );
  }

  // On plain "create" with a duplicate, reject
  if (action === 'create' && existing) {
    throw new Error(`Duplicate contact with email ${email} (id: ${existing.id})`);
  }

  // On "update", require existing record
  if (action === 'update' && !existing) {
    // Try by ID if provided
    const byId = d['id'] ? await queryOne(`SELECT id FROM public.contacts WHERE id = $1 AND tenant_id = $2`, [d['id'], tenantId]) : null;
    if (!byId) throw new Error('Contact not found for update');
    const { sql, values } = buildUpdateWithTenant('contacts', {
      first_name: firstName,
      last_name: sanitizeString(d['lastName'] as string, 100) ?? '',
      email,
      phone: sanitizeString(d['phone'] as string, 50),
      company_id: d['companyId'] ?? null,
      assigned_to: d['assignedTo'] ?? userId,
      lead_status: d['leadStatus'] ?? 'new',
      lead_source: sanitizeString(d['leadSource'] as string, 100),
      notes: sanitizeString(d['notes'] as string, 5000),
      tags: Array.isArray(d['tags']) ? d['tags'] : [],
      score: typeof d['score'] === 'number' ? d['score'] : 0,
      city: sanitizeString(d['city'] as string, 100),
      country: sanitizeString(d['country'] as string, 100),
      website: sanitizeString(d['website'] as string, 500),
      linkedin_url: sanitizeString(d['linkedinUrl'] as string, 500),
      twitter_url: sanitizeString(d['twitterUrl'] as string, 500),
      custom_fields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
    }, { id: (d['id'] as string) || existing.id, tenant_id: tenantId });
    const row = await queryOne(sql, values);
    return { id: row?.id ?? null, action: 'updated' };
  }

  // Create (or upsert = create if not exists)
  if (existing) {
    // Upsert: update the existing contact
    const { sql, values } = buildUpdateWithTenant('contacts', {
      first_name: firstName,
      last_name: sanitizeString(d['lastName'] as string, 100) ?? '',
      phone: sanitizeString(d['phone'] as string, 50),
      company_id: d['companyId'] ?? null,
      lead_status: d['leadStatus'] ?? 'new',
      lead_source: sanitizeString(d['leadSource'] as string, 100),
      notes: sanitizeString(d['notes'] as string, 5000),
      tags: Array.isArray(d['tags']) ? d['tags'] : [],
      score: typeof d['score'] === 'number' ? d['score'] : 0,
      city: sanitizeString(d['city'] as string, 100),
      country: sanitizeString(d['country'] as string, 100),
      website: sanitizeString(d['website'] as string, 500),
      linkedin_url: sanitizeString(d['linkedinUrl'] as string, 500),
      twitter_url: sanitizeString(d['twitterUrl'] as string, 500),
      custom_fields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
    }, { id: existing.id, tenant_id: tenantId });
    const row = await queryOne(sql, values);
    return { id: row?.id ?? existing.id, action: 'updated' };
  }

  const { sql, values } = buildInsertWithTenant('contacts', {
    first_name: firstName,
    last_name: sanitizeString(d['lastName'] as string, 100) ?? '',
    email,
    phone: sanitizeString(d['phone'] as string, 50),
    company_id: d['companyId'] ?? null,
    assigned_to: d['assignedTo'] ?? userId,
    lead_status: d['leadStatus'] ?? 'new',
    lead_source: sanitizeString(d['leadSource'] as string, 100),
    notes: sanitizeString(d['notes'] as string, 5000),
    tags: Array.isArray(d['tags']) ? d['tags'] : [],
    score: typeof d['score'] === 'number' ? d['score'] : 0,
    city: sanitizeString(d['city'] as string, 100),
    country: sanitizeString(d['country'] as string, 100),
    website: sanitizeString(d['website'] as string, 500),
    linkedin_url: sanitizeString(d['linkedinUrl'] as string, 500),
    twitter_url: sanitizeString(d['twitterUrl'] as string, 500),
    custom_fields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
    created_by: userId,
  });
  const row = await queryOne(sql, values);
  return { id: row?.id ?? null, action: 'created' };
}

/**
 * Create or upsert a lead.
 */
async function handleLead(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string
): Promise<EntityResult> {
  const d = normalizeFields(raw);

  const email = sanitizeString(d['email'] as string, 255)?.toLowerCase();
  const firstName = sanitizeString(d['firstName'] as string, 100);
  if (!firstName) throw new Error('first_name is required for lead');

  let existing: any = null;
  if (email) {
    existing = await queryOne(
      `SELECT id FROM public.leads WHERE tenant_id = $1 AND lower(email) = $2 AND deleted_at IS NULL`,
      [tenantId, email]
    );
  }

  if (action === 'create' && existing) {
    throw new Error(`Duplicate lead with email ${email} (id: ${existing.id})`);
  }

  if (action === 'update') {
    const targetId = (d['id'] as string) || existing?.id;
    if (!targetId) throw new Error('Lead id is required for update');
    const check = await queryOne(`SELECT id FROM public.leads WHERE id = $1 AND tenant_id = $2`, [targetId, tenantId]);
    if (!check) throw new Error('Lead not found for update');
    const { sql, values } = buildUpdateWithTenant('leads', {
      first_name: firstName,
      last_name: sanitizeString(d['lastName'] as string, 100),
      email,
      phone: sanitizeString(d['phone'] as string, 50),
      mobile: sanitizeString(d['mobile'] as string, 50),
      title: sanitizeString(d['title'] as string, 200),
      company_name: sanitizeString(d['companyName'] as string, 200),
      lead_source: sanitizeString(d['leadSource'] as string, 100) ?? 'api',
      lead_status: sanitizeString(d['leadStatus'] as string, 50) ?? 'new',
      lifecycle_stage: sanitizeString(d['lifecycleStage'] as string, 50),
      assigned_to: d['assignedTo'] ?? userId,
      tags: Array.isArray(d['tags']) ? d['tags'] : [],
      notes: sanitizeString(d['notes'] as string, 5000),
      custom_fields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
    }, { id: targetId, tenant_id: tenantId });
    const row = await queryOne(sql, values);
    return { id: row?.id ?? targetId, action: 'updated' };
  }

  if (existing) {
    // Upsert — update existing
    const { sql, values } = buildUpdateWithTenant('leads', {
      first_name: firstName,
      last_name: sanitizeString(d['lastName'] as string, 100),
      phone: sanitizeString(d['phone'] as string, 50),
      mobile: sanitizeString(d['mobile'] as string, 50),
      title: sanitizeString(d['title'] as string, 200),
      company_name: sanitizeString(d['companyName'] as string, 200),
      lead_status: sanitizeString(d['leadStatus'] as string, 50) ?? 'new',
      assigned_to: d['assignedTo'] ?? userId,
      tags: Array.isArray(d['tags']) ? d['tags'] : [],
      custom_fields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
    }, { id: existing.id, tenant_id: tenantId });
    const row = await queryOne(sql, values);
    return { id: row?.id ?? existing.id, action: 'updated' };
  }

  const result = await queryOne<any>(
    `INSERT INTO public.leads (
      tenant_id, first_name, last_name, email, phone, mobile,
      title, company_name, lead_source, lead_status, lifecycle_stage,
      assigned_to, created_by, owner_id, tags, notes, custom_fields
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
    ) RETURNING *`,
    [
      tenantId,
      firstName,
      sanitizeString(d['lastName'] as string, 100) ?? null,
      email ?? null,
      sanitizeString(d['phone'] as string, 50) ?? null,
      sanitizeString(d['mobile'] as string, 50) ?? null,
      sanitizeString(d['title'] as string, 200) ?? null,
      sanitizeString(d['companyName'] as string, 200) ?? null,
      sanitizeString(d['leadSource'] as string, 100) ?? 'api',
      sanitizeString(d['leadStatus'] as string, 50) ?? 'new',
      sanitizeString(d['lifecycleStage'] as string, 50) ?? 'lead',
      d['assignedTo'] ?? userId,
      userId,
      d['ownerId'] ?? userId,
      Array.isArray(d['tags']) ? d['tags'] : [],
      sanitizeString(d['notes'] as string, 5000) ?? null,
      typeof d['customFields'] === 'object' ? d['customFields'] : {},
    ]
  );
  return { id: result?.id ?? null, action: 'created' };
}

/**
 * Create or update a deal.
 */
async function handleDeal(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string
): Promise<EntityResult> {
  const d = normalizeFields(raw);
  const title = sanitizeString(d['title'] as string, 200);
  if (!title) throw new Error('title is required for deal');

  if (action === 'update' || action === 'upsert') {
    const dealId = d['id'] as string | null;
    if (dealId) {
      const check = await queryOne(`SELECT id FROM public.deals WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [dealId, tenantId]);
      if (check) {
        const value = typeof d['value'] === 'number' ? d['value'] : (d['value'] ? parseFloat(String(d['value'])) || 0 : 0);
        const probability = typeof d['probability'] === 'number' ? d['probability'] : (d['probability'] ? parseInt(String(d['probability'])) : 10);
        const { sql, values } = buildUpdateWithTenant('deals', {
          title,
          value,
          stage: sanitizeString(d['stage'] as string, 50) ?? 'lead',
          probability,
          close_date: d['closeDate'] ?? null,
          contact_id: d['contactId'] ?? null,
          company_id: d['companyId'] ?? null,
          assigned_to: d['assignedTo'] ?? userId,
          notes: sanitizeString(d['notes'] as string, 5000),
          custom_fields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
        }, { id: dealId, tenant_id: tenantId });
        const row = await queryOne(sql, values);
        return { id: row?.id ?? dealId, action: 'updated' };
      }
      if (action === 'update') throw new Error('Deal not found for update');
    }
  }

  const value = typeof d['value'] === 'number' ? d['value'] : (d['value'] ? parseFloat(String(d['value'])) || 0 : 0);
  const probability = typeof d['probability'] === 'number' ? d['probability'] : (d['probability'] ? parseInt(String(d['probability'])) : 10);
  const { sql, values } = buildInsertWithTenant('deals', {
    title,
    value,
    stage: sanitizeString(d['stage'] as string, 50) ?? 'lead',
    probability,
    close_date: d['closeDate'] ?? null,
    contact_id: d['contactId'] ?? null,
    company_id: d['companyId'] ?? null,
    assigned_to: d['assignedTo'] ?? userId,
    notes: sanitizeString(d['notes'] as string, 5000),
    custom_fields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
    created_by: userId,
  });
  const row = await queryOne(sql, values);
  return { id: row?.id ?? null, action: 'created' };
}

/**
 * Create or update a company.
 */
async function handleCompany(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string
): Promise<EntityResult> {
  const d = normalizeFields(raw);
  const name = sanitizeString(d['name'] as string, 200);
  if (!name) throw new Error('name is required for company');

  if (action === 'update' || action === 'upsert') {
    const companyId = d['id'] as string | null;
    if (companyId) {
      const check = await queryOne(`SELECT id FROM public.companies WHERE id = $1 AND tenant_id = $2`, [companyId, tenantId]);
      if (check) {
        const { sql, values } = buildUpdateWithTenant('companies', {
          name,
          industry: sanitizeString(d['industry'] as string, 100),
          size: sanitizeString(d['size'] as string, 50),
          website: sanitizeString(d['website'] as string, 500),
          phone: sanitizeString(d['phone'] as string, 50),
          address: sanitizeString(d['address'] as string, 500),
          notes: sanitizeString(d['notes'] as string, 5000),
          custom_fields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
        }, { id: companyId, tenant_id: tenantId });
        const row = await queryOne(sql, values);
        return { id: row?.id ?? companyId, action: 'updated' };
      }
      if (action === 'update') throw new Error('Company not found for update');
    }
  }

  const { sql, values } = buildInsertWithTenant('companies', {
    name,
    industry: sanitizeString(d['industry'] as string, 100),
    size: sanitizeString(d['size'] as string, 50),
    website: sanitizeString(d['website'] as string, 500),
    phone: sanitizeString(d['phone'] as string, 50),
    address: sanitizeString(d['address'] as string, 500),
    notes: sanitizeString(d['notes'] as string, 5000),
    custom_fields: typeof d['customFields'] === 'object' ? d['customFields'] : {},
    created_by: userId,
  });
  const row = await queryOne(sql, values);
  return { id: row?.id ?? null, action: 'created' };
}

/**
 * Create or update a task.
 */
async function handleTask(
  action: string,
  raw: Record<string, unknown>,
  tenantId: string,
  userId: string
): Promise<EntityResult> {
  const d = normalizeFields(raw);
  const title = sanitizeString(d['title'] as string, 200);
  if (!title) throw new Error('title is required for task');

  if (action === 'update') {
    const taskId = d['id'] as string | null;
    if (!taskId) throw new Error('id is required to update a task');
    const check = await queryOne(`SELECT id FROM public.tasks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [taskId, tenantId]);
    if (!check) throw new Error('Task not found for update');
    const { sql, values } = buildUpdateWithTenant('tasks', {
      title,
      description: sanitizeString(d['description'] as string, 5000),
      due_date: d['dueDate'] ?? null,
      priority: sanitizeString(d['priority'] as string, 20) ?? 'medium',
      contact_id: d['contactId'] ?? null,
      deal_id: d['dealId'] ?? null,
      assigned_to: d['assignedTo'] ?? userId,
      completed: typeof d['completed'] === 'boolean' ? d['completed'] : false,
    }, { id: taskId, tenant_id: tenantId });
    const row = await queryOne(sql, values);
    return { id: row?.id ?? taskId, action: 'updated' };
  }

  const { sql, values } = buildInsertWithTenant('tasks', {
    title,
    description: sanitizeString(d['description'] as string, 5000),
    due_date: d['dueDate'] ?? null,
    priority: sanitizeString(d['priority'] as string, 20) ?? 'medium',
    contact_id: d['contactId'] ?? null,
    deal_id: d['dealId'] ?? null,
    assigned_to: d['assignedTo'] ?? userId,
    completed: typeof d['completed'] === 'boolean' ? d['completed'] : false,
    created_by: userId,
  });
  const row = await queryOne(sql, values);
  return { id: row?.id ?? null, action: 'created' };
}

// ── DB builder helpers that include tenant_id ──────────────────────────

const PROTECTED = new Set(['id', 'created_at', 'is_super_admin', 'password_hash', 'totp_secret', 'totp_backup_codes', 'totp_enabled', 'email_verified', 'role_slug']);

// Whitelist of valid table names to prevent SQL injection
const VALID_TABLES = new Set([
  'contacts', 'leads', 'deals', 'companies', 'tasks',
]);

function validateTableName(table: string): string {
  if (!VALID_TABLES.has(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  return table;
}

function buildInsertWithTenant(table: string, data: Record<string, any>) {
  const validTable = validateTableName(table);
  const keys = Object.keys(data).filter(k => !PROTECTED.has(k));
  if (!keys.length) throw new Error('No fields to insert');
  return {
    sql: `INSERT INTO public.${validTable} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    values: keys.map(k => data[k]),
  };
}

function buildUpdateWithTenant(table: string, data: Record<string, any>, where: Record<string, any>) {
  const validTable = validateTableName(table);
  const dk = Object.keys(data).filter(k => data[k] !== undefined && !PROTECTED.has(k));
  if (!dk.length) throw new Error('No fields to update');
  const wk = Object.keys(where);
  let i = 1;
  return {
    sql: `UPDATE public.${validTable} SET ${dk.map(k => `"${k}"=$${i++}`).join(',')}, updated_at=now() WHERE ${wk.map(k => `"${k}"=$${i++}`).join(' AND ')} RETURNING *`,
    values: [...dk.map(k => data[k]), ...wk.map(k => where[k])],
  };
}

// ── Single item processor ──────────────────────────────────────────────

async function processItem(
  item: { action: string; entity: string; data: Record<string, unknown> },
  tenantId: string,
  userId: string
): Promise<EntityResult> {
  const { action, entity, data } = item;

  if (!VALID_ACTIONS.has(action)) throw new Error(`Invalid action: ${action}. Must be one of: ${[...VALID_ACTIONS].join(', ')}`);
  if (!VALID_ENTITIES.has(entity)) throw new Error(`Invalid entity: ${entity}. Must be one of: ${[...VALID_ENTITIES].join(', ')}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('data must be a non-empty object');

  switch (entity) {
    case 'contact': return await handleContact(action, data, tenantId, userId);
    case 'lead':    return await handleLead(action, data, tenantId, userId);
    case 'deal':    return await handleDeal(action, data, tenantId, userId);
    case 'company': return await handleCompany(action, data, tenantId, userId);
    case 'task':    return await handleTask(action, data, tenantId, userId);
    default:        throw new Error(`Unsupported entity: ${entity}`);
  }
}

// ── Route handler ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  let apiKeyRow: Awaited<ReturnType<typeof resolveApiKey>> = null;
  let keyPrefix = 'unknown';

  try {
    // 1. Extract API key
    const authHeader = request.headers.get('x-api-key');
    const url = new URL(request.url);
    const queryKey = url.searchParams.get('api_key');
    const rawKey = authHeader || queryKey;

    if (!rawKey) {
      return NextResponse.json(
        { error: 'API key required. Provide via X-API-Key header or ?api_key= query parameter.' },
        { status: 401 }
      );
    }

    // 2. Resolve API key
    apiKeyRow = await resolveApiKey(rawKey);
    if (!apiKeyRow) {
      return NextResponse.json({ error: 'Invalid, expired, or inactive API key.' }, { status: 401 });
    }

    keyPrefix = apiKeyRow.key_prefix;

    // 3. Rate limiting (per API key)
    try {
      await inboundLimiter.enforce(`inbound:${apiKeyRow.id}`);
    } catch {
      logRequest(keyPrefix, 429, request.nextUrl.pathname);
      return NextResponse.json(
        { error: 'Rate limit exceeded. Max 100 requests per minute.' },
        { status: 429, headers: getRateLimitHeaders({ allowed: false, remaining: 0, reset: Date.now() + 60000, limit: 100 }) }
      );
    }

    // 4. Payload size check
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_PAYLOAD_SIZE) {
      logRequest(keyPrefix, 413, request.nextUrl.pathname);
      return NextResponse.json(
        { error: `Payload too large. Max ${MAX_PAYLOAD_SIZE / 1_000_000}MB.` },
        { status: 413 }
      );
    }

    // 5. Parse JSON
    let body: any;
    try {
      const text = await request.text();
      if (text.length > MAX_PAYLOAD_SIZE) {
        logRequest(keyPrefix, 413, request.nextUrl.pathname);
        return NextResponse.json(
          { error: `Payload too large. Max ${MAX_PAYLOAD_SIZE / 1_000_000}MB.` },
          { status: 413 }
        );
      }
      body = JSON.parse(text);
    } catch {
      logRequest(keyPrefix, 400, request.nextUrl.pathname);
      return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 });
    }

    // 6. Determine items to process
    const items: Array<{ action: string; entity: string; data: Record<string, unknown> }> = [];

    if (body.batch) {
      if (!Array.isArray(body.batch)) {
        logRequest(keyPrefix, 400, request.nextUrl.pathname);
        return NextResponse.json({ error: 'batch must be an array.' }, { status: 400 });
      }
      if (body.batch.length > MAX_BATCH_SIZE) {
        logRequest(keyPrefix, 400, request.nextUrl.pathname);
        return NextResponse.json(
          { error: `Batch too large. Max ${MAX_BATCH_SIZE} items per request.` },
          { status: 400 }
        );
      }
      items.push(...body.batch);
    } else if (body.action && body.entity && body.data) {
      items.push({ action: body.action, entity: body.entity, data: body.data });
    } else {
      logRequest(keyPrefix, 400, request.nextUrl.pathname);
      return NextResponse.json(
        { error: 'Invalid payload. Expected { action, entity, data } or { batch: [...] }.' },
        { status: 400 }
      );
    }

    // 7. Process each item
    const results: Array<{ entity: string; action: string; id: string | null; status: string; error?: string }> = [];
    let hasError = false;

    for (const item of items) {
      try {
        const result = await processItem(item, apiKeyRow.tenant_id, apiKeyRow.user_id);
        results.push({ entity: item.entity, action: result.action, id: result.id, status: 'ok' });

        // Fire outgoing webhooks for created records
        if (result.action === 'created') {
          const eventType = `${item.entity}.created` as WebhookEvent;
          fireWebhooks(apiKeyRow.tenant_id, eventType, { id: result.id }).catch(() => {});
        }

        // Log audit entry
        logAudit({
          tenantId: apiKeyRow.tenant_id,
          userId: apiKeyRow.user_id,
          action: result.action === 'created' ? 'create' : 'update',
          resourceType: item.entity,
          resourceId: result.id as string,
          newData: { source: 'inbound_webhook', api_key: apiKeyRow.name },
        }).catch(() => {});

        // Log delivery
        logWebhookDelivery({
          tenantId: apiKeyRow.tenant_id,
          apiKeyId: apiKeyRow.id,
          action: item.action,
          entity: item.entity,
          status: 'success',
          statusCode: 200,
          errorMessage: null,
          recordId: result.id,
          payloadSize: contentLength || 0,
        });
      } catch (err: any) {
        hasError = true;
        results.push({ entity: item.entity, action: item.action, id: null, status: 'error', error: err.message });

        logWebhookDelivery({
          tenantId: apiKeyRow.tenant_id,
          apiKeyId: apiKeyRow.id,
          action: item.action,
          entity: item.entity,
          status: 'error',
          statusCode: 400,
          errorMessage: err.message,
          recordId: null,
          payloadSize: contentLength || 0,
        });
      }
    }

    const statusCode = hasError ? 207 : 200;
    const duration = Date.now() - startTime;

    logRequest(keyPrefix, statusCode, request.nextUrl.pathname);

    // Audit log
    if (process.env.NODE_ENV === 'production') {
      await logAudit({
        tenantId: apiKeyRow.tenant_id,
        userId: apiKeyRow.user_id,
        action: 'webhook_inbound',
        resourceType: 'api',
        resourceId: 'batch',
        newData: { processed: results.length, succeeded: results.filter(r => r.status === 'ok').length, failed: results.filter(r => r.status === 'error').length, duration_ms: duration },
      }).catch(() => {});
    }

    // Dev log
    devLogger.request('POST', request.nextUrl.pathname, statusCode, duration);

    return NextResponse.json(
      {
        ok: !hasError,
        processed: results.length,
        succeeded: results.filter(r => r.status === 'ok').length,
        failed: results.filter(r => r.status === 'error').length,
        results,
        duration_ms: duration,
      },
      { status: statusCode }
    );
  } catch (err: any) {
    const duration = Date.now() - startTime;
    console.error('[inbound webhook]', err);

    if (apiKeyRow) {
      logWebhookDelivery({
        tenantId: apiKeyRow.tenant_id,
        apiKeyId: apiKeyRow.id,
        action: 'unknown',
        entity: 'unknown',
        status: 'error',
        statusCode: 500,
        errorMessage: err.message,
        recordId: null,
        payloadSize: 0,
      });
      logRequest(keyPrefix, 500, request.nextUrl.pathname);
    }

    return NextResponse.json(
      { error: 'Internal server error', duration_ms: duration },
      { status: 500 }
    );
  }
}

// ── GET endpoint for health check / stats ──────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('x-api-key');
    const url = new URL(request.url);
    const queryKey = url.searchParams.get('api_key');
    const rawKey = authHeader || queryKey;

    if (!rawKey) {
      return NextResponse.json({ error: 'API key required.' }, { status: 401 });
    }

    const apiKeyRow = await resolveApiKey(rawKey);
    if (!apiKeyRow) {
      return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 });
    }

    const logs = requestLog.get(apiKeyRow.key_prefix) ?? [];

    return NextResponse.json({
      status: 'ok',
      key_name: apiKeyRow.name,
      key_prefix: apiKeyRow.key_prefix,
      tenant_id: apiKeyRow.tenant_id,
      recent_requests: logs.length,
      recent_activity: logs.slice(-10).reverse(),
    });
  } catch (err: any) {
    console.error('[inbound webhook GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
