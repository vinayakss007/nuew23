# NuCRM Database Schema Standards

> **RULE: This document is the SINGLE source of truth for column names.**
> Never invent new names. Never use synonyms. Always look here first.

---

## Column Naming Convention

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| **contacts** | `id` | uuid | Primary key |
| | `tenant_id` | uuid | NOT NULL |
| | `first_name` | text | NOT NULL |
| | `last_name` | text | NOT NULL |
| | `email` | text | |
| | `phone` | text | |
| | `mobile` | text | |
| | `title` | text | |
| | `company_id` | uuid | FK → companies.id |
| | `company_name` | text | ⚠️ NOT `company` |
| | `assigned_to` | uuid | FK → users.id |
| | `owner_id` | uuid | FK → users.id |
| | `lead_status` | text | ⚠️ NOT `status` |
| | `lead_source` | text | ⚠️ NOT `source` |
| | `lifecycle_stage` | text | |
| | `notes` | text | |
| | `tags` | jsonb | |
| | `score` | integer | |
| | `city` | text | |
| | `country` | text | |
| | `website` | text | |
| | `linkedin_url` | text | |
| | `twitter_url` | text | |
| | `custom_fields` | jsonb | |
| | `is_archived` | boolean | |
| | `do_not_contact` | boolean | |
| | `deleted_at` | timestamptz | |
| | `deleted_by` | uuid | FK → users.id |
| | `last_activity_at` | timestamptz | |
| | `last_assigned_at` | timestamptz | |
| | `last_contacted_at` | timestamptz | |
| | `avatar_url` | text | |
| | `source` | text | Alias for lead_source (read-only) |
| | `status` | text | Alias for lead_status (read-only) |
| | `search_vector` | tsvector | Full-text search |
| | `metadata` | jsonb | |
| | `created_by` | uuid | |
| | `created_at` | timestamptz | |
| | `updated_at` | timestamptz | |

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| **leads** | `id` | uuid | Primary key |
| | `tenant_id` | uuid | NOT NULL |
| | `first_name` | text | NOT NULL |
| | `last_name` | text | |
| | `full_name` | text | Generated: first + last |
| | `email` | text | |
| | `phone` | text | |
| | `mobile` | text | |
| | `title` | text | |
| | `company_name` | text | |
| | `company_size` | text | |
| | `company_industry` | text | |
| | `company_website` | text | |
| | `company_annual_revenue` | numeric | |
| | `lead_status` | text | ⚠️ NOT `status` |
| | `lead_source` | text | |
| | `lifecycle_stage` | text | |
| | `assigned_to` | uuid | FK → users.id |
| | `owner_id` | uuid | FK → users.id |
| | `created_by` | uuid | |
| | `tags` | jsonb | |
| | `notes` | text | |
| | `internal_notes` | text | |
| | `custom_fields` | jsonb | |
| | `score` | integer | |
| | `score_previous` | integer | |
| | `budget` | numeric | |
| | `budget_currency` | text | |
| | `authority_level` | text | |
| | `need_description` | text | |
| | `timeline` | text | |
| | `timeline_target_date` | date | |
| | `country` | text | |
| | `state` | text | |
| | `city` | text | |
| | `address_line1` | text | |
| | `postal_code` | text | |
| | `linkedin_url` | text | |
| | `twitter_handle` | text | |
| | `website` | text | |
| | `utm_source` | text | |
| | `utm_medium` | text | |
| | `utm_campaign` | text | |
| | `department` | text | |
| | `deleted_at` | timestamptz | |
| | `deleted_by` | uuid | FK → users.id |
| | `last_activity_at` | timestamptz | |
| | `converted_at` | timestamptz | |
| | `converted_to_contact_id` | uuid | FK → contacts.id |
| | `form_submissions_count` | integer | |
| | `form_id` | uuid | |
| | `do_not_contact` | boolean | |
| | `search_vector` | tsvector | |
| | `metadata` | jsonb | |
| | `created_at` | timestamptz | |
| | `updated_at` | timestamptz | |

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| **deals** | `id` | uuid | Primary key |
| | `tenant_id` | uuid | NOT NULL |
| | `title` | text | ⚠️ NOT `name` |
| | `name` | text | Alias for title (read-only) |
| | `value` | numeric(12,2) | |
| | `stage` | text | |
| | `stage_id` | uuid | FK → deal_stages.id |
| | `probability` | integer | |
| | `close_date` | date | |
| | `contact_id` | uuid | |
| | `company_id` | uuid | |
| | `assigned_to` | uuid | FK → users.id |
| | `owner_id` | uuid | FK → users.id |
| | `description` | text | |
| | `notes` | text | |
| | `custom_fields` | jsonb | |
| | `deleted_at` | timestamptz | |
| | `deleted_by` | uuid | FK → users.id |
| | `won_at` | timestamptz | |
| | `pipeline_id` | uuid | |
| | `created_by` | uuid | |
| | `created_at` | timestamptz | |
| | `updated_at` | timestamptz | |

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| **tasks** | `id` | uuid | Primary key |
| | `tenant_id` | uuid | NOT NULL |
| | `title` | text | NOT NULL |
| | `description` | text | |
| | `due_date` | timestamptz | |
| | `priority` | text | |
| | `status` | text | |
| | `contact_id` | uuid | |
| | `deal_id` | uuid | |
| | `company_id` | uuid | |
| | `assigned_to` | uuid | |
| | `completed` | boolean | |
| | `completed_at` | timestamptz | |
| | `deleted_at` | timestamptz | |
| | `deleted_by` | uuid | FK → users.id |
| | `created_by` | uuid | |
| | `created_at` | timestamptz | |
| | `updated_at` | timestamptz | |

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| **companies** | `id` | uuid | Primary key |
| | `tenant_id` | uuid | NOT NULL |
| | `name` | text | NOT NULL |
| | `website` | text | |
| | `industry` | text | |
| | `size` | text | |
| | `description` | text | |
| | `phone` | text | |
| | `address` | text | |
| | `city` | text | |
| | `state` | text | |
| | `country` | text | |
| | `custom_fields` | jsonb | |
| | `status` | text | |
| | `assigned_to` | uuid | |
| | `deleted_at` | timestamptz | |
| | `deleted_by` | uuid | FK → users.id |
| | `created_by` | uuid | |
| | `created_at` | timestamptz | |
| | `updated_at` | timestamptz | |

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| **activities** | `id` | uuid | Primary key |
| | `tenant_id` | uuid | NOT NULL |
| | `user_id` | uuid | |
| | `entity_type` | text | NOT NULL |
| | `entity_id` | uuid | NOT NULL |
| | `action` | text | NOT NULL |
| | `type` | text | ⚠️ Alias for `action` (auto-synced) |
| | `contact_id` | uuid | |
| | `deal_id` | uuid | |
| | `event_type` | text | |
| | `description` | text | |
| | `details` | jsonb | |
| | `metadata` | jsonb | |
| | `ip_address` | text | |
| | `created_at` | timestamptz | |

> ⚠️ **activities table has BOTH `action` AND `type`** — they are kept in sync by trigger.
> New code should use `type`. Old code using `action` still works.

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| **error_logs** | `id` | uuid | Primary key |
| | `tenant_id` | uuid | |
| | `user_id` | uuid | |
| | `level` | text | error, fatal, warn |
| | `code` | text | |
| | `message` | text | NOT NULL |
| | `stack` | text | |
| | `context` | jsonb | |
| | `resolved` | boolean | |
| | `resolved_at` | timestamptz | |
| | `resolved_by` | uuid | |
| | `created_at` | timestamptz | |

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| **contact_emails** | `id` | uuid | Primary key |
| | `contact_id` | uuid | FK → contacts.id |
| | `email` | text | NOT NULL |
| | `phone` | text | |
| | `is_primary` | boolean | |
| | `created_at` | timestamptz | |

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| **pipelines** | `id` | uuid | Primary key |
| | `tenant_id` | uuid | NOT NULL |
| | `name` | text | NOT NULL |
| | `stages` | jsonb | |
| | `is_default` | boolean | |
| | `created_at` | timestamptz | |
| | `updated_at` | timestamptz | |

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| **health_checks** | `id` | uuid | Primary key |
| | `service` | text | NOT NULL |
| | `status` | text | |
| | `latency_ms` | integer | |
| | `message` | text | |
| | `checked_at` | timestamptz | |

| Table | Column | Type | Notes |
|-------|--------|------|-------|
| **support_tickets** | `id` | uuid | Primary key |
| | `tenant_id` | uuid | NOT NULL |
| | `created_by` | uuid | |
| | `subject` | text | NOT NULL |
| | `body` | text | |
| | `category` | text | |
| | `priority` | text | |
| | `status` | text | |
| | `assigned_to` | uuid | |
| | `resolved_at` | timestamptz | |
| | `resolved_by` | uuid | |
| | `created_at` | timestamptz | |
| | `updated_at` | timestamptz | |

---

## COMMON MISTAKES (Never Do These)

| ❌ Wrong | ✅ Correct |
|----------|-----------|
| `contacts.company` | `contacts.company_name` |
| `contacts.source` | `contacts.lead_source` |
| `contacts.status` | `contacts.lead_status` |
| `deals.name` | `deals.title` |
| `activities.type` without `action` sync | Both columns exist, auto-synced by trigger |
| `SELECT *` and assume column exists | Explicitly list columns you need |

---

## How to Add a New Column

1. **Add to this document first** (this file)
2. **Add to the migration** (`migrations/NNN_description.sql`)
3. **Run** `docker exec nucrm-app npx tsx scripts/push-db.mts`
4. **Verify** `docker exec nucrm-postgres psql -U postgres -d nucrm -c "\d table_name"`

---

## Migration Numbering

- `001_base_schema.sql` → Core tables
- `038_fix_all_missing_columns.sql` → First big fix
- `039_complete_contacts_leads.sql` → Second big fix
- `040_fix_all_broken_queries.sql` → Third big fix
- Next: `041_...`

Each migration MUST:
- Use `IF NOT EXISTS` for tables
- Use `ADD COLUMN IF NOT EXISTS` for columns
- Never DROP anything
- Be idempotent (safe to re-run)
