# 🔒 NuCRM — Immutable Database Schema Policy

## The Problem
Every time a new feature is added, `ALTER TABLE` statements modify core tables, causing:
- Migration conflicts between branches
- Column type mismatches
- Production downtime during ALTER
- Data corruption from failed migrations
- "Works on my machine" database states

## The Solution: IMMUTABLE CORE + APPEND-ONLY EXTENSIONS

---

## 🏛️ CORE TABLES — NEVER ALTER

These tables are **IMMUTABLE** after creation. No `ALTER TABLE`, no `DROP COLUMN`, no type changes.

| Core Table | Purpose |
|-----------|---------|
| `users` | Platform users (auth) |
| `tenants` | Multi-tenant workspaces |
| `tenant_members` | User ↔ Tenant membership |
| `roles` | Role definitions |
| `contacts` | CRM contacts |
| `companies` | Company records |
| `deals` | Deal/opportunity records |
| `deal_stages` | Pipeline stages |
| `leads` | Lead records |
| `tasks` | Task management |
| `activities` | Activity log |
| `notifications` | User notifications |
| `tags` | Tag definitions |
| `audit_logs` | Audit trail |
| `sessions` | Auth sessions |
| `password_resets` | Password reset tokens |
| `email_verifications` | Email verification tokens |
| `invitations` | Team invitations |
| `api_keys` | API key management |
| `subscriptions` | Billing subscriptions |
| `webhooks` | Outbound webhook endpoints |

### Rules for Core Tables:
1. **NEVER** `ALTER TABLE core_table`
2. **NEVER** `DROP COLUMN` from core table
3. **NEVER** change column types on core table
4. **NEVER** `DROP TABLE core_table`
5. **ONLY** `CREATE INDEX` on core table (safe, no data impact)

---

## 🧩 EXTENSION TABLES — The Safe Way to Add Features

Every new feature creates its **OWN** table(s) that reference core tables via foreign keys.

### Pattern 1: Feature-Specific Table

```sql
-- ✅ GOOD: Create a new table for your feature
CREATE TABLE IF NOT EXISTS ai_insights (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    contact_id  UUID REFERENCES contacts(id),  -- Link to core, don't modify it
    insight_type TEXT NOT NULL,
    score       NUMERIC(5,2),
    data        JSONB,                          -- Flexible: add any fields here
    created_at  TIMESTAMP DEFAULT NOW()
);
```

### Pattern 2: JSONB Extension Column (One-Time Only)

If you MUST add data to a core table, add ONE JSONB column once:

```sql
-- ✅ GOOD: Add ONE flexible column (do this ONCE per core table)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Then store ALL feature-specific data in it:
-- {
--   "ai_score": 85,
--   "conversation_intelligence": { "sentiment": "positive" },
--   "predictive_analytics": { "churn_risk": 0.12 }
-- }
```

### Pattern 3: Key-Value Extension Table

For maximum flexibility without touching core tables:

```sql
-- ✅ GOOD: Generic key-value store for any feature
CREATE TABLE IF NOT EXISTS entity_metadata (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    entity_type TEXT NOT NULL,     -- 'contact', 'deal', 'lead', etc.
    entity_id   UUID NOT NULL,     -- ID of the core record
    key         TEXT NOT NULL,     -- feature-specific key
    value       JSONB,             -- any data
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(entity_type, entity_id, key)
);

-- Usage:
INSERT INTO entity_metadata (tenant_id, entity_type, entity_id, key, value)
VALUES ($1, 'contact', $2, 'ai_sentiment', '{"score": 0.85, "label": "positive"}');
```

---

## 📋 MIGRATION RULES

### ✅ ALLOWED (Safe — Always Run)

```sql
CREATE TABLE IF NOT EXISTS ...
CREATE INDEX IF NOT EXISTS ...
CREATE UNIQUE INDEX IF NOT EXISTS ...
ALTER TABLE my_new_feature_table ADD COLUMN IF NOT EXISTS ...
COMMENT ON TABLE ... IS ...
GRANT ...
```

### ⚠️ ALLOWED WITH GUARDS (Run Once, Idempotent)

```sql
-- Add column (safe — IF NOT EXISTS protects it)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_extension TEXT;

-- Add constraint (safe — CONFLICT DO NOTHING)
ALTER TABLE deals ADD CONSTRAINT deals_value_check
    CHECK (value >= 0) NOT VALID;

-- Enable RLS (safe — idempotent)
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
```

### ❌ NEVER ALLOWED (Will Break Production)

```sql
DROP TABLE contacts;
DROP COLUMN contacts.email;
ALTER TABLE contacts ALTER COLUMN email TYPE INTEGER;  -- Type change!
ALTER TABLE contacts RENAME COLUMN first_name TO fname;
TRUNCATE contacts;
DELETE FROM contacts WHERE ...;
```

---

## 🛡️ ENFORCEMENT

### 1. Migration Runner Protection
The migration runner (`scripts/push-db.mts`) automatically blocks:
- `DROP DATABASE`
- `DROP SCHEMA`
- `DROP TABLE` (without IF EXISTS)
- `DELETE FROM`
- `TRUNCATE`

### 2. Migration Review Checklist
Before merging any migration file:
- [ ] Does it ALTER any core table? If yes, use extension pattern instead
- [ ] Does it use `IF NOT EXISTS` / `IF EXISTS` guards?
- [ ] Can it run multiple times safely (idempotent)?
- [ ] Does it reference existing tables via foreign keys (not assume columns exist)?

### 3. New Feature Checklist
- [ ] I created new tables for my feature (no ALTER on core)
- [ ] My tables reference core tables via foreign keys
- [ ] I use JSONB columns for flexible feature data
- [ ] My migration file uses `CREATE ... IF NOT EXISTS`
- [ ] I tested migration on a copy of production data

---

## 📐 SCHEMA DIAGRAM (Conceptual)

```
┌─────────────────────────────────────────────────────┐
│                    CORE LAYER                        │
│  (IMMUTABLE — NEVER ALTER after initial creation)   │
│                                                      │
│  users ──┬── tenants ──┬── contacts                 │
│          │             ├── companies                 │
│  sessions│             ├── deals                     │
│          │             ├── leads                     │
│  roles ──┘             ├── tasks                     │
│                        ├── activities                │
│                        └── ...                       │
└────────────────────┬────────────────────────────────┘
                     │
                     │ FK references (one-way)
                     │
┌────────────────────▼────────────────────────────────┐
│                EXTENSION LAYER                       │
│  (APPEND-ONLY — each feature owns its own tables)   │
│                                                      │
│  ai_insights │ workflows │ sequences │ reports       │
│  call_recordings │ churn_predictions │ email_drafts  │
│  entity_metadata (generic key-value store)           │
│  ... new features always add NEW tables here          │
└─────────────────────────────────────────────────────┘
```

---

## 🔄 MIGRATION NAMING

```
NNN_descriptive_name.sql

001_base_schema.sql          ← Core tables (NEVER change)
010_performance_indexes.sql  ← Indexes only
015_contact_timeline.sql     ← New tables only
020_ai_assistant.sql         ← Feature extension tables
029_tenant_backup_restore.sql ← New feature tables
030_security_hardening.sql   ← RLS + policies only
```

- **Numbers are sequential** — no gaps, no duplicates
- **Each file is idempotent** — safe to run multiple times
- **Files only ADD** — never remove or modify existing structures

---

## 🚀 MIGRATION COMMANDS

```bash
# Run all pending migrations (safe, idempotent)
npm run db:migrate
# or
npx tsx scripts/push-db.mts

# Check migration status
npm run db:check

# Auto-push (same as migrate, convenient name)
npm run db:auto
```

---

## 📝 MIGRATION FILE TEMPLATE

```sql
-- Migration: NNN_feature_name
-- Purpose: What this migration does in one sentence
-- Tables Created: list_of_new_tables
-- Tables Modified: NONE (or list with IF NOT EXISTS guards)
-- Safe to Re-run: YES

-- 1. Create new feature table
CREATE TABLE IF NOT EXISTS my_feature (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id),
    -- ... columns
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 2. Add indexes
CREATE INDEX IF NOT EXISTS idx_my_feature_tenant ON my_feature(tenant_id);

-- 3. If you MUST add a column to core table (rare, one-time only):
-- ALTER TABLE contacts ADD COLUMN IF NOT EXISTS my_feature_data JSONB DEFAULT '{}';

-- 4. Comments
COMMENT ON TABLE my_feature IS 'Description of this feature table';
```

---

## 🎯 SUMMARY

| Approach | Safety | Flexibility | Performance |
|----------|--------|-------------|-------------|
| Core tables immutable | ✅ Highest | ✅ Good (via extensions) | ✅ Best |
| Extension tables | ✅ High | ✅ Highest | ✅ Good |
| JSONB columns | ✅ High | ✅ Very High | ⚠️ Slightly slower queries |
| ALTER TABLE core | ❌ NEVER | ❌ N/A | ❌ Locks table |

**Rule of thumb:** If your feature needs new data fields, create a new table. Don't touch the core.
