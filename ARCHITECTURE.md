# NuCRM — System Architecture

## Table of Contents

- [Overview](#overview)
- [Three-Level Hierarchy](#three-level-hierarchy)
- [Data Isolation](#data-isolation)
- [Authentication Flow](#authentication-flow)
- [Database Schema](#database-schema)
- [Module System](#module-system)
- [Permissions](#36-permissions-enforced-per-api-call)
- [Automation Engine](#automation-engine)
- [Cron Jobs](#cron-jobs-7-scheduled)
- [Technology Stack](#technology-stack)
- [Two-Factor Authentication (2FA)](#two-factor-authentication-2fa)
- [Error Handling Architecture](#error-handling-architecture)
- [Caching Strategy](#caching-strategy)
- [Database Connection Pooling](#database-connection-pooling)
- [API Key Authentication](#api-key-authentication)
- [Security Considerations](#security-considerations)
- [Performance Optimization](#performance-optimization)
- [Monitoring & Observability](#monitoring--observability)
- [Deployment Topology](#deployment-topology)
- [Disaster Recovery](#disaster-recovery)
- [Automation Action Types](#complete-automation-action-types)
- [Trigger Types](#complete-trigger-types)
- [API Reference](#api-reference)
- [Development Workflow](#development-workflow)
- [File Structure](#file-structure)
- [Glossary](#glossary)

---

## Overview

NuCRM is a production-ready multi-tenant SaaS CRM. One deployment serves unlimited organisations (tenants), each fully isolated. No Supabase, no external auth services — raw PostgreSQL via the `pg` driver and JWT sessions.

**Key Design Principles:**
- **Zero-trust isolation** — Every query scoped to `tenant_id`
- **Defense in depth** — Middleware + route-level permission checks
- **Non-blocking automation** — Automation failures never break CRM operations
- **Graceful degradation** — Optional features (email, AI) fail silently
- **Connection resilience** — Automatic retry on transient DB errors

---

## Three-Level Hierarchy

```
┌─────────────────────────────────────────────┐
│  SUPER ADMIN  (users.is_super_admin = true)  │  Dark amber theme
│  /superadmin/*                               │  Sees ALL orgs
│  Manages: plans, modules, billing, errors    │
└───────────────┬─────────────────────────────┘
                │  owns / manages
┌───────────────▼─────────────────────────────┐
│  ORG ADMIN  (role_slug = 'admin')            │  One org only
│  /tenant/*  + /tenant/settings/*             │
│  Manages: team, billing, modules, webhooks   │
└───────────────┬─────────────────────────────┘
                │  member of
┌───────────────▼─────────────────────────────┐
│  ORG USER  (role_slug = one of 5 roles)      │  Permission-gated
│  /tenant/*  (read/write per permissions)     │
│  manager · sales_rep · lead_manager · viewer │
└─────────────────────────────────────────────┘
```

### Super Admin
- `users.is_super_admin = true`
- Route prefix: `/superadmin/*`
- Capabilities: all org data, revenue dashboard, platform health, error logs, module marketplace, plans editor, announcements, support tickets, impersonation
- Impersonation: POST `/api/superadmin/impersonate` sets `last_tenant_id` — all impersonated actions logged to `audit_logs.impersonated_by`

### Org Admin
- `tenant_members.role_slug = 'admin'`
- Route prefix: `/tenant/*`
- Capabilities: their org only — team, billing, custom pipelines, webhooks, API keys, audit log, modules, custom fields

### Org User
- One of 5 system roles (auto-seeded on signup)
- Permissions checked per-request via `requirePerm(ctx, 'resource.action')`
- Can belong to multiple orgs (different `tenant_members` rows per org)

---

## Data Isolation

Every table has `tenant_id NOT NULL`. Every query in every API route is scoped:

```typescript
// In requireAuth() — resolves tenantId from JWT → DB member lookup
ctx.tenantId = member.tenant_id;

// In every route:
WHERE tenant_id = $1  -- always first param
```

Rules enforced:
- Suspended orgs → `403 TENANT_NOT_FOUND` at middleware
- Trial-expired orgs → `402 TRIAL_EXPIRED` on non-GET mutations
- API key auth → scoped to one tenant, no cross-tenant access
- buildUpdate() PROTECTED columns: `id, tenant_id, created_by, created_at, is_super_admin, password_hash, totp_secret, totp_backup_codes, totp_enabled, email_verified, role_slug`

---

## Authentication Flow

```
POST /api/auth/login
  │
  ├─ Rate limit (5/min per IP)
  ├─ Verify password (SHA-256 + salt)
  ├─ Check email verified
  ├─ 2FA? → return { requires_2fa: true }
  │    └─ Client sends totp_token → verifyTOTP()
  ├─ Create session row + JWT (30-day expiry)
  └─ Set httpOnly cookie: nucrm_session
```

Session validation on every request:
1. Extract JWT from cookie or `Authorization: Bearer` header
2. Verify JWT signature
3. Look up `sessions` table (token_hash) — allows server-side revocation
4. Resolve `tenant_members` row → permissions map
5. Check tenant status (suspended/trial_expired)

API Key auth (external integrations):
- Header: `Authorization: Bearer ak_live_...`
- Scopes enforced: `contacts:read`, `contacts:write`, `deals:all`, etc.
- Keys stored as SHA-256 hash; never retrievable after creation

---

## Database Schema

### 54 Tables across 9 migrations

**Core auth & tenancy**
| Table | Purpose |
|-------|---------|
| `users` | All users across all orgs. `is_super_admin` flag |
| `sessions` | DB-backed sessions for server-side revocation |
| `plans` | Subscription tiers with limits |
| `tenants` | Organizations. Status: trialing/active/suspended/cancelled/past_due/trial_expired |
| `tenant_members` | User↔org membership with role, notification_prefs |
| `roles` | Custom roles per org with permissions jsonb |
| `permission_overrides` | Per-user permission exceptions |
| `invitations` | Email invites with 7-day expiry tokens |

**CRM records**
| Table | Purpose |
|-------|---------|
| `contacts` | People. Tags[], do_not_contact, lifecycle_stage, score |
| `companies` | Organizations linked to contacts/deals |
| `deals` | Opportunities with stage, value, probability |
| `tasks` | Follow-ups with priority, due date, last_notified_at |
| `activities` | Timeline events (calls, emails, notes, meetings) |
| `notes` | Long-form notes on contacts/deals |
| `meetings` | Scheduled meetings with start/end time |
| `tags` | Reusable tags per tenant |
| `products` | Product catalogue linked to deals |
| `deal_products` | Many-to-many deals↔products |
| `pipelines` | Custom deal stages per tenant (default seeded on signup) |
| `custom_field_defs` | Org-defined fields for contacts/deals |
| `lead_assignments` | Assignment history log |

**Automation & modules**
| Table | Purpose |
|-------|---------|
| `modules` | Platform module registry (8 built-in) |
| `tenant_modules` | Per-org module installs, status, settings |
| `automations` | Custom automation rules (trigger → actions) |
| `automation_runs` | Execution log per automation |
| `automation_workflows` | Prebuilt workflow toggle state per tenant |
| `sequences` | Multi-step drip campaigns |
| `sequence_enrollments` | Contact↔sequence enrollment with progress |
| `forms` | Lead capture forms |
| `form_submissions` | Raw form submission data |
| `email_tracking` | Open/click tracking per sent email |

**Integrations & files**
| Table | Purpose |
|-------|---------|
| `integrations` | Connected webhooks/slack/resend/zapier configs |
| `webhook_deliveries` | Outgoing webhook log with retry state |
| `api_keys` | API keys (hash stored, prefix shown) |
| `file_attachments` | Attached files with storage_path, storage_type |
| `email_templates` | Reusable email templates |
| `email_log` | Sent email log |

**Notifications & user**
| Table | Purpose |
|-------|---------|
| `notifications` | In-app notifications per user+tenant |
| `audit_logs` | All admin actions with impersonated_by |
| `onboarding_progress` | Checklist completion per org |
| `rate_limits` | Per-IP/per-tenant rate limit windows |

**Platform ops (superadmin)**
| Table | Purpose |
|-------|---------|
| `billing_events` | Stripe event log |
| `usage_snapshots` | Daily contact/deal/user counts per org |
| `error_logs` | Application errors (level, stack, context jsonb) |
| `health_checks` | Service health history |
| `backup_records` | Backup run log |
| `support_tickets` | In-app support tickets |
| `announcements` | Platform-wide announcements |
| `limit_violations` | Plan limit hit events |
| `platform_settings` | Key-value platform config |

---

## Module System

8 built-in modules. Orgs install from `/tenant/modules` marketplace.

| Module | Tier | Price |
|--------|------|-------|
| Core CRM | All | Free |
| Basic Automation | All | Free |
| Automation Pro | Starter+ | $29/mo |
| WhatsApp Automation | Starter+ | $19/mo |
| Email Sync | Starter+ | $15/mo |
| Forms Builder | Starter+ | $10/mo |
| Analytics Pro | Pro+ | $15/mo |
| AI Assistant | Pro+ | $25/mo |

Module state stored in `tenant_modules` (status: active/disabled/error, settings jsonb for API keys/credentials).

---

## 35 Permissions (enforced per API call)

```
contacts.*    view_all · create · edit · delete · import · export · merge · assign
companies.*   view_all · create · edit · delete
deals.*       view_all · view_value · create · edit · delete · assign
tasks.*       view_all · create · edit · delete · assign
reports.*     view · export
settings.*    view · manage
team.*        view · invite · remove · manage_roles
automations.* view · manage
billing.*     view · manage
```

### 5 System Roles (auto-seeded per org)

| Role | Key permissions |
|------|----------------|
| `admin` | All permissions |
| `manager` | View all + create/edit + can invite |
| `sales_rep` | Own records only, no view_all |
| `lead_manager` | View all + assign contacts |
| `viewer` | Read-only everything |

---

## Automation Engine

Events fired after every CRM mutation:

| Entity | Events |
|--------|--------|
| Contact | `contact.created` · `contact.updated` · `contact.status_changed` |
| Deal | `deal.created` · `deal.stage_changed` · `deal.won` · `deal.lost` |
| Task | `task.created` · `task.completed` |
| Company | `company.created` |
| Form | `form.submitted` |

Each event:
1. Queries `automations` table for matching `trigger_type`
2. Executes actions: `send_email` · `send_notification` · `create_task` · `update_contact` · `add_tag` · `remove_tag` · `assign_contact` · `fire_webhook` · `wait`
3. Logs to `automation_runs`
4. Calls `fireWebhooks()` to all active integrations

Engine is non-blocking — all automation wrapped in `.catch(() => {})` so CRM mutations never fail due to automation errors.

---

## Cron Jobs (7 scheduled)

| Job | Schedule | Purpose |
|-----|----------|---------|
| `task-reminders` | Daily 9AM | Email/notify for due + overdue tasks |
| `trial-check` | Daily 9AM | Expire trials, send warning emails |
| `cleanup` | Daily 9AM | Purge sessions, invites, rate limits, 30-day trash |
| `usage-snapshot` | Daily 9AM | Record daily org counts |
| `backup` | Daily 9AM | pg_dump → S3/R2 or local |
| `retry-webhooks` | Every 15min | Exponential backoff retry for failed webhooks |
| `process-sequences` | Every hour | Execute due drip campaign steps |

All protected by `x-cron-secret` header. Defined in `.github/workflows/cron.yml`.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 App Router (Turbopack) |
| Runtime | Node.js 22+ |
| Database | PostgreSQL (raw `pg` driver) |
| Auth | JWT (jose) + httpOnly cookies |
| UI | Tailwind CSS + shadcn/ui components |
| Charts | Recharts |
| Drag-drop | @dnd-kit |
| Email | Resend API or SMTP (nodemailer fallback) |
| Queue | BullMQ (Redis) or pg-boss (Postgres fallback) |
| AI | Anthropic Claude (claude-haiku-4-5) |
| Payments | Stripe (checkout + customer portal + webhooks) |
| Storage | Local disk (dev) / AWS S3 or Cloudflare R2 (prod) |

---

## Two-Factor Authentication (2FA)

TOTP-based 2FA using authenticator apps (Google Authenticator, Authy, etc.).

### Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. User enables 2FA in /tenant/settings/security        │
│    ├─ Generate TOTP secret (32-char base32)             │
│    ├─ Create QR code → user scans                       │
│    └─ Store: totp_secret (encrypted), totp_enabled=true │
└─────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│ 2. Subsequent logins (if 2FA enabled)                    │
│    ├─ Login → { requires_2fa: true, totp_session }       │
│    ├─ User enters 6-digit code                           │
│    ├─ POST /api/auth/2fa/verify with code                │
│    └─ Verify → create session → JWT cookie               │
└─────────────────────────────────────────────────────────┘
```

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/2fa/setup` | POST | Generate TOTP secret + QR code |
| `/api/auth/2fa/verify` | POST | Verify TOTP code during login |
| `/api/auth/2fa/disable` | POST | Disable 2FA (requires password) |
| `/api/tenant/2fa/setup` | POST | Tenant-scoped 2FA setup |
| `/api/tenant/2fa/verify` | POST | Tenant-scoped 2FA verify |
| `/api/tenant/2fa/disable` | POST | Tenant-scoped 2FA disable |

### Database Fields

```sql
-- users table
totp_secret        TEXT NULL      -- encrypted 32-char base32 secret
totp_enabled       BOOLEAN FALSE  -- 2FA active flag
totp_backup_codes  TEXT[] NULL    -- 8 one-time recovery codes (hashed)
```

---

## Error Handling Architecture

### Error Logging

All errors logged to `error_logs` table with context:

```typescript
import { logError } from '@/lib/errors';

try {
  // ... operation
} catch (err) {
  await logError({
    error: err,
    context: 'contact.create',
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    level: 'error',  // 'warning' | 'error' | 'fatal'
    metadata: { recordId, action }
  });
}
```

### Error Categories

| Level | Description | Example |
|-------|-------------|---------|
| `warning` | Recoverable, user-facing | Validation error, rate limit |
| `error` | Operation failed, needs investigation | DB constraint violation, API timeout |
| `fatal` | System-wide failure | DB connection lost, out of memory |

### Retry Strategy

Database queries automatically retry on transient errors:

```typescript
// lib/db/client.ts
const RETRYABLE = ['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','40001','40P01','08006','08001'];
// Retries: 2 times with exponential backoff (150ms, 300ms)
```

### Graceful Degradation

Optional services fail silently without breaking core functionality:

- **Email failures** → Log error, continue execution
- **AI failures** → Return empty response, log error
- **Webhook failures** → Queue for retry, don't block response
- **Automation failures** → Log to `automation_runs`, CRM mutation succeeds

---

## Caching Strategy

### Multi-Layer Caching

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: In-Memory LRU Cache (lib/cache.ts)             │
│ - Hot read-only data (permissions, module state)        │
│ - TTL: 5-60 minutes                                     │
│ - Max entries: 500                                      │
└─────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│ Layer 2: Database Query Cache (dbCache())                │
│ - Frequently accessed tenant config                      │
│ - TTL: configurable per query                            │
│ - Auto-invalidate on write                               │
└─────────────────────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│ Layer 3: HTTP Cache (Next.js)                            │
│ - Static assets, public pages                            │
│ - ETag-based validation                                  │
└─────────────────────────────────────────────────────────┘
```

### Cache Keys

```typescript
// Pattern: entity:id:tenantId:field
const key = `permissions:${userId}:${tenantId}`;
const key = `module:status:${tenantId}`;
const key = `tenant:config:${tenantId}`;
```

### Invalidation

```typescript
import { invalidateCache } from '@/lib/db/client';

// After updating permissions
await query('UPDATE roles SET permissions = $1...', [perms]);
invalidateCache(`permissions:${userId}`);

// After module state change
await query('UPDATE tenant_modules SET status = $1...', [status]);
invalidateCache(`module:status:${tenantId}`);
```

---

## Database Connection Pooling

### Pool Configuration

```typescript
// lib/db/client.ts
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.DATABASE_POOL_SIZE ?? '10'),     // Max connections
  idleTimeoutMillis: 30_000,   // Close idle after 30s
  connectionTimeoutMillis: 5_000,  // Fail after 5s wait
  allowExitOnIdle: false,      // Keep pool alive
});
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_POOL_SIZE` | `10` | Max connections per Node process |
| `DATABASE_SSL` | `false` | Enable SSL for cloud databases |

### Best Practices

- **Global singleton** — Single pool shared across all requests (`global.__pgPool`)
- **Connection release** — Always release connections after use (`client.release()`)
- **Transaction handling** — Use `withTransaction()` for atomic operations
- **Error handling** — Pool-wide error listener logs connection issues

---

## API Key Authentication

### Scopes

API keys are scoped to specific operations:

| Scope | Read | Write | Delete |
|-------|------|-------|--------|
| `contacts:read` | ✅ | ❌ | ❌ |
| `contacts:write` | ✅ | ✅ | ❌ |
| `contacts:all` | ✅ | ✅ | ✅ |
| `deals:read` | ✅ | ❌ | ❌ |
| `deals:write` | ✅ | ✅ | ❌ |
| `deals:all` | ✅ | ✅ | ✅ |
| `companies:read` | ✅ | ❌ | ❌ |
| `companies:write` | ✅ | ✅ | ❌ |
| `companies:all` | ✅ | ✅ | ✅ |
| `tasks:read` | ✅ | ❌ | ❌ |
| `tasks:write` | ✅ | ✅ | ❌ |
| `tasks:all` | ✅ | ✅ | ✅ |

### Usage

```http
GET /api/tenant/contacts
Authorization: Bearer ak_live_abc123...
```

### Security

- Keys stored as SHA-256 hash (never retrievable)
- Prefix shown only once at creation (`ak_live_abc...`)
- Scoped to single tenant (no cross-tenant access)
- Revocable at any time (immediate effect)

---

## Security Considerations

### Authentication

- **Password hashing** — SHA-256 + random salt (16 bytes)
- **JWT expiry** — 30 days, server-side revocation via `sessions` table
- **Session invalidation** — Delete from `sessions` → immediate logout
- **2FA** — TOTP with backup codes

### Authorization

- **Middleware guard** — Every route requires valid JWT
- **Permission checks** — `requirePerm(ctx, 'resource.action')` per operation
- **Tenant isolation** — All queries include `tenant_id = $1`
- **Protected fields** — `buildUpdate()` blocks updates to sensitive columns

### Data Protection

- **SQL injection** — Parameterized queries only (`$1, $2, ...`)
- **XSS prevention** — React auto-escapes, no `dangerouslySetInnerHTML`
- **CSRF protection** — httpOnly cookies, same-site=lax
- **Rate limiting** — Per-IP and per-tenant windows in `rate_limits` table

### Audit Trail

- All admin actions logged to `audit_logs`
- Impersonation tracked via `impersonated_by` field
- API key usage logged with key prefix

---

## Performance Optimization

### Database Indexes

Key indexes for common queries:

```sql
-- Tenant isolation (every table)
CREATE INDEX idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX idx_deals_tenant ON deals(tenant_id);
CREATE INDEX idx_companies_tenant ON companies(tenant_id);

-- Auth lookups
CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_tenant_members_user ON tenant_members(user_id, status);

-- CRM queries
CREATE INDEX idx_contacts_assigned ON contacts(assigned_to, tenant_id);
CREATE INDEX idx_deals_stage ON deals(stage, tenant_id);
CREATE INDEX idx_tasks_due ON tasks(due_date, tenant_id, completed);

-- Automation
CREATE INDEX idx_automations_trigger ON automations(tenant_id, trigger_type, is_active);
```

### Query Optimization

- **Selective columns** — `SELECT id, name` not `SELECT *`
- **Limit + offset** — Pagination on all list endpoints
- **Covering indexes** — Include frequently filtered columns
- **Connection pooling** — Reuse connections, avoid connection storm

### Frontend Optimization

- **React Server Components** — Data fetching on server
- **Streaming** — Progressive HTML rendering
- **Client caching** — `lib/client-cache.ts` for API responses
- **Lazy loading** — Dynamic imports for heavy components

---

## Monitoring & Observability

### Health Checks

```typescript
// GET /api/health
{
  status: 'ok',
  database: 'connected',
  timestamp: '2024-01-15T10:30:00Z'
}
```

### Cron Monitoring

All cron jobs log to `health_checks` table:

| Job | Success Condition | Failure Alert |
|-----|-------------------|---------------|
| `backup` | Exit code 0, file created | Superadmin notification |
| `retry-webhooks` | Processed pending queue | Log to `error_logs` |
| `task-reminders` | Sent emails/notifications | Silent retry next day |

### Error Tracking

- **Application errors** — `error_logs` table with stack traces
- **Automation failures** — `automation_runs` with `last_error`
- **Webhook failures** — `webhook_deliveries` with retry count
- **DB errors** — Console + `error_logs` with context

### Usage Metrics

Daily snapshots in `usage_snapshots`:

| Metric | Purpose |
|--------|---------|
| `contact_count` | Plan limit enforcement |
| `deal_count` | Analytics, plan limits |
| `user_count` | Seat billing |
| `storage_bytes` | Storage quota |

---

## Deployment Topology

### Single-Region Deployment

```
                    ┌─────────────────┐
                    │   Vercel Edge   │
                    │   (Next.js)     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
    ┌─────────▼────────┐    │    ┌─────────▼────────┐
    │  Neon Postgres   │    │    │   Resend SMTP    │
    │  (Primary DB)    │    │    │   (Email)        │
    └──────────────────┘    │    └──────────────────┘
                            │
              ┌─────────────▼──────────────┐
              │   Cloudflare R2 / S3       │
              │   (File Storage)           │
              └────────────────────────────┘
```

### Multi-Tenant Isolation

```
Tenant A                    Tenant B                    Tenant C
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│  /api/contacts  │        │  /api/contacts  │        │  /api/contacts  │
│  WHERE tenant_  │        │  WHERE tenant_  │        │  WHERE tenant_  │
│  id = 'uuid-a'  │        │  id = 'uuid-b'  │        │  id = 'uuid-c'  │
└────────┬────────┘        └────────┬────────┘        └────────┬────────┘
         │                          │                          │
         └──────────────────────────┼──────────────────────────┘
                                    │
                          ┌─────────▼─────────┐
                          │  Shared Database  │
                          │  (logical隔离)    │
                          └───────────────────┘
```

---

## Disaster Recovery

### Backup Strategy

| Type | Frequency | Retention | Storage |
|------|-----------|-----------|---------|
| Full pg_dump | Daily | 30 days | S3/R2 + local |
| WAL archiving | Continuous | 7 days | S3/R2 |
| Config backup | On change | Forever | Database |

### Recovery Procedures

1. **Database failure** — Restore from latest backup + WAL replay
2. **Tenant data loss** — Point-in-time restore from `backup_records`
3. **Session compromise** — Truncate `sessions` table → force re-login
4. **API key leak** — Revoke key, generate new, rotate in integration

### Business Continuity

- **RTO (Recovery Time Objective)** — 4 hours
- **RPO (Recovery Point Objective)** — 24 hours (daily backups)
- **Failover** — Manual DNS switch to backup region

---

## Complete Automation Action Types

| Action | Description | Config Fields |
|--------|-------------|---------------|
| `send_email` | Send email via Resend/SMTP | `to`, `subject`, `body` |
| `send_notification` | In-app notification | `user_id`, `title`, `body`, `link` |
| `create_task` | Create follow-up task | `title`, `description`, `due_days`, `priority`, `assigned_to` |
| `update_contact` | Update contact fields | `fields` object with allowed columns |
| `add_tag` | Add tag to contact | `tag` string |
| `remove_tag` | Remove tag from contact | `tag` string |
| `assign_contact` | Reassign contact owner | `assign_to` user ID |
| `fire_webhook` | Trigger outgoing webhook | `url`, `method`, `headers` |
| `wait` | Delay before next action | `delay_minutes` |

### Allowed Contact Fields for `update_contact`

```typescript
const ALLOWED_CONTACT_FIELDS = new Set([
  'notes', 'lead_source', 'lead_status', 'score', 'lifecycle_stage',
  'do_not_contact', 'city', 'country', 'website', 'linkedin_url', 'twitter_url',
]);
```

### String Interpolation

All action configs support `{{field}}` placeholders:

```json
{
  "type": "send_email",
  "config": {
    "to": "{{email}}",
    "subject": "Welcome {{first_name}}!",
    "body": "Hi {{first_name}} {{last_name}}, thanks for signing up."
  }
}
```

---

## Complete Trigger Types

| Category | Triggers |
|----------|----------|
| Contact | `contact.created`, `contact.updated`, `contact.status_changed` |
| Deal | `deal.created`, `deal.stage_changed`, `deal.won`, `deal.lost` |
| Task | `task.created`, `task.completed`, `task.overdue` |
| Company | `company.created` |
| Form | `form.submitted` |
| Tag | `tag.added` |
| Schedule | `schedule.daily`, `schedule.weekly` |

---

## API Reference

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/signup` | Create account + workspace |
| `POST` | `/api/auth/login` | Login with email + password |
| `POST` | `/api/auth/logout` | Logout + invalidate session |
| `POST` | `/api/auth/2fa/setup` | Enable 2FA |
| `POST` | `/api/auth/2fa/verify` | Verify 2FA code |
| `POST` | `/api/auth/2fa/disable` | Disable 2FA |
| `POST` | `/api/auth/forgot-password` | Request password reset |
| `POST` | `/api/auth/reset-password` | Reset password with token |
| `POST` | `/api/auth/accept-invite` | Accept team invitation |
| `GET` | `/api/auth/invite-details` | Get invitation info |
| `POST` | `/api/auth/resend-verification` | Resend email verification |
| `POST` | `/api/auth/verify-email` | Verify email address |

### Contacts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/contacts` | List contacts (paginated) |
| `POST` | `/api/tenant/contacts` | Create contact |
| `GET` | `/api/tenant/contacts/:id` | Get contact details |
| `PATCH` | `/api/tenant/contacts/:id` | Update contact |
| `DELETE` | `/api/tenant/contacts/:id` | Delete contact (soft) |
| `PATCH` | `/api/tenant/contacts/:id/status` | Update lead status |
| `POST` | `/api/tenant/contacts/:id/enroll` | Enroll in sequence |
| `POST` | `/api/tenant/contacts/merge` | Merge duplicate contacts |
| `POST` | `/api/tenant/contacts/import` | Bulk import CSV |
| `GET` | `/api/tenant/contacts/export` | Export to CSV |
| `POST` | `/api/tenant/contacts/bulk` | Bulk operations |

### Deals

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/deals` | List deals (Kanban) |
| `POST` | `/api/tenant/deals` | Create deal |
| `GET` | `/api/tenant/deals/:id` | Get deal details |
| `PATCH` | `/api/tenant/deals/:id` | Update deal |
| `DELETE` | `/api/tenant/deals/:id` | Delete deal (soft) |

### Companies

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/companies` | List companies |
| `POST` | `/api/tenant/companies` | Create company |
| `GET` | `/api/tenant/companies/:id` | Get company details |
| `PATCH` | `/api/tenant/companies/:id` | Update company |
| `DELETE` | `/api/tenant/companies/:id` | Delete company |

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/tasks` | List tasks (filterable) |
| `POST` | `/api/tenant/tasks` | Create task |
| `PATCH` | `/api/tenant/tasks/:id` | Update task |
| `DELETE` | `/api/tenant/tasks/:id` | Delete task |

### Meetings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/meetings` | List meetings |
| `POST` | `/api/tenant/meetings` | Schedule meeting |

### Activities

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/activities` | List timeline activities |
| `POST` | `/api/tenant/activities` | Log activity |

### Team & Roles

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/members` | List team members |
| `POST` | `/api/tenant/invite/send` | Send invitation |
| `DELETE` | `/api/tenant/invite/:id` | Revoke invitation |
| `GET` | `/api/tenant/roles` | List roles |
| `POST` | `/api/tenant/roles` | Create custom role |
| `PATCH` | `/api/tenant/roles/:id` | Update role |
| `DELETE` | `/api/tenant/roles/:id` | Delete role |

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/workspace` | Get workspace settings |
| `PATCH` | `/api/tenant/workspace` | Update workspace |
| `GET` | `/api/tenant/pipelines` | List deal pipelines |
| `POST` | `/api/tenant/pipelines` | Create pipeline |
| `PATCH` | `/api/tenant/pipelines/:id` | Update pipeline |
| `DELETE` | `/api/tenant/pipelines/:id` | Delete pipeline |
| `GET` | `/api/tenant/custom-fields` | List custom fields |
| `POST` | `/api/tenant/custom-fields` | Create custom field |
| `GET` | `/api/tenant/integrations` | List integrations |
| `POST` | `/api/tenant/integrations` | Add integration |
| `PATCH` | `/api/tenant/integrations/:id` | Toggle integration |
| `DELETE` | `/api/tenant/integrations/:id` | Remove integration |
| `GET` | `/api/tenant/webhooks` | List webhooks |
| `POST` | `/api/tenant/webhooks` | Create webhook |
| `GET` | `/api/tenant/webhooks/:id/deliveries` | Get delivery logs |
| `GET` | `/api/tenant/api-keys` | List API keys |
| `POST` | `/api/tenant/api-keys` | Create API key |
| `DELETE` | `/api/tenant/api-keys/:id` | Revoke API key |

### Automations

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/automations` | List automations |
| `POST` | `/api/tenant/automations` | Create automation |
| `PATCH` | `/api/tenant/automations/:id` | Update automation |
| `DELETE` | `/api/tenant/automations/:id` | Delete automation |
| `GET` | `/api/tenant/automation/workflows` | List prebuilt workflows |
| `GET` | `/api/tenant/sequences` | List sequences |
| `POST` | `/api/tenant/sequences` | Create sequence |
| `GET` | `/api/tenant/forms` | List forms |
| `POST` | `/api/tenant/forms` | Create form |
| `GET` | `/api/tenant/forms/public/:id` | Get public form |

### Modules

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/modules` | List available modules |
| `POST` | `/api/tenant/modules` | Install module |
| `PATCH` | `/api/tenant/modules/:id` | Update module settings |
| `DELETE` | `/api/tenant/modules/:id` | Uninstall module |

### Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/notifications` | List notifications |
| `GET` | `/api/tenant/notifications/unread` | Get unread count |
| `PATCH` | `/api/tenant/notifications` | Mark as read |
| `DELETE` | `/api/tenant/notifications` | Delete notification |
| `PATCH` | `/api/tenant/notification-prefs` | Update preferences |

### Utilities

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tenant/search` | Global search |
| `GET` | `/api/tenant/reports` | Generate reports |
| `GET` | `/api/tenant/export` | Export all data |
| `POST` | `/api/tenant/permissions/check` | Check permission |
| `GET` | `/api/tenant/me` | Current user context |
| `POST` | `/api/tenant/email/test` | Test email config |
| `GET` | `/api/tenant/usage-status` | Get usage vs limits |
| `GET` | `/api/tenant/onboarding` | Get onboarding progress |
| `POST` | `/api/tenant/onboarding` | Update progress |
| `GET` | `/api/tenant/trash` | List soft-deleted items |
| `POST` | `/api/tenant/trash` | Restore deleted item |

### Super Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/superadmin/tenants` | List all tenants |
| `POST` | `/api/superadmin/tenants` | Create tenant |
| `PATCH` | `/api/superadmin/tenants/:id` | Update tenant |
| `DELETE` | `/api/superadmin/tenants/:id` | Delete tenant |
| `GET` | `/api/superadmin/users` | List all users |
| `PATCH` | `/api/superadmin/users/:id` | Update user |
| `GET` | `/api/superadmin/plans` | List pricing plans |
| `POST` | `/api/superadmin/plans` | Create plan |
| `PATCH` | `/api/superadmin/plans/:id` | Update plan |
| `POST` | `/api/superadmin/impersonate` | Impersonate user |
| `GET` | `/api/superadmin/revenue` | Revenue dashboard |
| `GET` | `/api/superadmin/monitoring` | Platform health |
| `GET` | `/api/superadmin/errors` | Error logs |
| `GET` | `/api/superadmin/health` | Health checks |
| `GET` | `/api/superadmin/announcements` | Announcements |
| `POST` | `/api/superadmin/announcements` | Create announcement |
| `GET` | `/api/superadmin/tickets` | Support tickets |
| `GET` | `/api/superadmin/usage` | Platform usage stats |
| `GET` | `/api/superadmin/modules` | Module marketplace |
| `GET` | `/api/superadmin/backups` | Backup records |
| `POST` | `/api/superadmin/restore` | Restore from backup |
| `GET` | `/api/superadmin/stats` | Platform statistics |
| `GET` | `/api/superadmin/settings` | Platform settings |
| `PATCH` | `/api/superadmin/settings` | Update settings |

### Cron Endpoints (protected by `x-cron-secret`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/cron/task-reminders` | Send task reminders |
| `POST` | `/api/cron/trial-check` | Expire trials |
| `POST` | `/api/cron/cleanup` | Purge old data |
| `POST` | `/api/cron/usage-snapshot` | Record daily metrics |
| `POST` | `/api/cron/backup` | Create backup |
| `POST` | `/api/cron/retry-webhooks` | Retry failed webhooks |
| `POST` | `/api/cron/process-sequences` | Execute sequences |
| `POST` | `/api/cron/backup-health` | Backup + health check |

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/webhooks/resend` | Resend inbound webhook |
| `GET` | `/api/tenant/forms/public/:id` | Public form page |
| `POST` | `/api/forms/public/:id/submit` | Form submission |
| `GET` | `/api/leads/public` | Lead capture endpoint |
| `GET` | `/api/track/:type` | Email tracking pixel |
| `GET` | `/api/unsubscribe` | Unsubscribe from emails |
| `POST` | `/api/setup/check` | Check if setup needed |
| `POST` | `/api/setup/create-admin` | Create first admin |
| `GET` | `/embed/form/:id` | Embedded form script |

---

## Development Workflow

### Local Development Setup

```bash
# 1. Clone and install
cd nucrm-saas
npm install

# 2. Configure environment
cp .env.local.example .env.local
# Edit: DATABASE_URL, JWT_SECRET, NEXT_PUBLIC_APP_URL

# 3. Check database
npm run db:check

# 4. Push schema (if needed)
npm run db:push

# 5. Start development (app + worker)
npm run dev:all
```

### Environment Variables

```env
# Required
DATABASE_URL=postgresql://user:pass@localhost:5432/nucrm
DATABASE_SSL=false
JWT_SECRET=<32+ random chars>
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional
RESEND_API_KEY=re_...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=user@gmail.com
SMTP_PASS=app-password
SMTP_FROM=NuCRM <noreply@yourapp.com>
ANTHROPIC_API_KEY=sk-ant-...
DATABASE_POOL_SIZE=10
SETUP_KEY=optional-setup-key
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run lint` | ESLint check |
| `npm run db:push` | Push schema to database |
| `npm run db:check` | Check database status |
| `npm run worker` | Start background worker |
| `npm run worker:dev` | Worker with hot reload |
| `npm run dev:all` | App + worker concurrently |
| `npm run start:app` | Auto-start (install + migrate + start) |

### Code Style

- **TypeScript** — Strict mode, no `any`
- **Naming** — camelCase for variables/functions, PascalCase for types/components
- **Imports** — Absolute paths with `@/` alias
- **Error handling** — Always wrap async operations with try/catch
- **Database** — Always use parameterized queries
- **Permissions** — Check at route entry with `requirePerm()`

### Testing Strategy

```bash
# Unit tests (planned)
npm run test:unit

# Integration tests (planned)
npm run test:integration

# E2E tests (planned)
npm run test:e2e
```

### Git Workflow

```bash
# Feature branch
git checkout -b feature/automation-pro

# Commit with conventional commits
git commit -m "feat: add WhatsApp automation support"
git commit -m "fix: resolve race condition in webhook retry"
git commit -m "docs: update API reference"

# PR to main
git push origin feature/automation-pro
```

---

## File Structure

```
nucrm-saas/
├── app/
│   ├── api/
│   │   ├── auth/              # Authentication endpoints
│   │   ├── tenant/            # Tenant-scoped CRM endpoints
│   │   ├── superadmin/        # Platform admin endpoints
│   │   ├── cron/              # Scheduled job endpoints
│   │   ├── forms/             # Public form endpoints
│   │   └── health/            # Health check
│   ├── auth/                  # Auth pages (login, signup)
│   ├── tenant/                # Tenant CRM pages
│   │   ├── dashboard/
│   │   ├── contacts/
│   │   ├── deals/
│   │   ├── companies/
│   │   ├── tasks/
│   │   ├── calendar/
│   │   ├── analytics/
│   │   ├── automation/
│   │   ├── modules/
│   │   └── settings/
│   ├── superadmin/            # Platform admin pages
│   │   ├── dashboard/
│   │   ├── tenants/
│   │   ├── users/
│   │   ├── plans/
│   │   ├── modules/
│   │   ├── revenue/
│   │   ├── monitoring/
│   │   └── settings/
│   ├── setup/                 # First-time setup wizard
│   ├── lead-capture/          # Public lead capture page
│   ├── embed/                 # Embedded form/widget
│   ├── layout.tsx             # Root layout
│   ├── page.tsx               # Landing page
│   ├── error.tsx              # Error boundary
│   └── not-found.tsx          # 404 page
├── components/
│   ├── ui/                    # Reusable UI components
│   ├── tenant/                # Tenant-specific components
│   └── superadmin/            # Admin components
├── lib/
│   ├── auth/
│   │   ├── middleware.ts      # Auth middleware
│   │   ├── session.ts         # JWT session handling
│   │   └── api-handlers.ts    # Auth API utilities
│   ├── db/
│   │   ├── client.ts          # PostgreSQL client
│   │   └── ensure-schema.ts   # Schema verification
│   ├── automation/
│   │   ├── engine.ts          # Automation processor
│   │   ├── workflows.ts       # Prebuilt workflows
│   │   └── types.ts           # Automation types
│   ├── email/
│   │   ├── service.ts         # Email sending
│   │   └── router.ts          # Resend/SMTP routing
│   ├── permissions/
│   │   └── definitions.ts     # Permission definitions
│   ├── tenant/
│   │   └── context.ts         # Tenant context
│   ├── integrations/
│   │   └── sdk.ts             # Integration SDK
│   ├── queue/
│   │   └── index.ts           # Job queue (pg-boss)
│   ├── audit.ts               # Audit logging
│   ├── cache.ts               # LRU cache
│   ├── client-cache.ts        # Client-side cache
│   ├── errors.ts              # Error handling
│   ├── keepalive.ts           # Connection keepalive
│   ├── modules.ts             # Module registry
│   ├── notifications.ts       # Notification service
│   ├── rate-limit.ts          # Rate limiting
│   ├── utils.ts               # Utilities
│   ├── validate.ts            # Validation helpers
│   └── webhooks.ts            # Webhook delivery
├── scripts/
│   ├── 001_schema.sql         # Core schema
│   ├── 002_saas_ops.sql       # SaaS operations
│   ├── 003_soft_deletes.sql   # Soft delete triggers
│   ├── 004_schema_enhancement.sql  # Enhanced fields
│   ├── 005_ownership_and_workflow.sql
│   ├── 006_isolation_fixes.sql
│   ├── 007_missing_tables.sql
│   ├── 008_modules_and_features.sql
│   ├── 009_session_additions.sql
│   ├── 010_performance_indexes.sql
│   └── 011_protect_super_admin.sql
├── types/
│   └── index.ts               # TypeScript definitions
├── public/
│   ├── favicon.ico
│   └── logo.svg
├── .env.local.example
├── .eslintrc.json
├── middleware.ts              # Next.js middleware
├── next.config.mjs
├── package.json
├── tailwind.config.js
├── tsconfig.json
├── worker.ts                  # Background worker
├── start.js                   # Auto-start script
├── setup-db.js                # Database setup
├── check-db.js                # Database check
├── Dockerfile
├── docker-compose.yml
└── ecosystem.config.js        # PM2 config
```

---

## Glossary

| Term | Definition |
|------|------------|
| **Tenant** | An organization/workspace in the CRM |
| **Super Admin** | Platform administrator with access to all tenants |
| **Org Admin** | Administrator within a specific tenant |
| **JWT** | JSON Web Token for session authentication |
| **TOTP** | Time-based One-Time Password for 2FA |
| **Pipeline** | Custom deal stages for a tenant |
| **Module** | Installable feature package (e.g., Automation Pro) |
| **Automation** | Trigger → Action rules for CRM events |
| **Sequence** | Multi-step email drip campaign |
| **Webhook** | HTTP callback for external integrations |
| **Soft Delete** | Mark as deleted without removing from DB |
| **Rate Limit** | Request throttling per IP/tenant |
| **Audit Log** | Record of all admin actions |
| **Impersonation** | Super admin acting as a tenant user |
