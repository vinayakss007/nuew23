-- ═══════════════════════════════════════════════════════════════
-- Migration 008: Module Framework, 2FA, Automations, Webhooks,
--                File Storage, Sequences, API Auth
-- Run: psql $DATABASE_URL -f scripts/008_modules_and_features.sql
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. TWO-FACTOR AUTHENTICATION
-- ─────────────────────────────────────────────────────────────
alter table public.users
  add column if not exists totp_enabled    boolean default false,
  add column if not exists totp_secret     text,       -- encrypted TOTP secret
  add column if not exists totp_backup_codes jsonb,    -- hashed backup codes array
  add column if not exists totp_verified_at timestamptz;

-- ─────────────────────────────────────────────────────────────
-- 2. MODULE REGISTRY (platform-level, not tenant-level)
--    Super admin manages which modules are available
-- ─────────────────────────────────────────────────────────────
create table if not exists public.modules (
  id            text primary key,          -- 'automation-pro', 'whatsapp-bot', 'ai-assistant'
  name          text not null,
  version       text not null default '1.0.0',
  description   text,
  category      text default 'utility'
                check (category in ('messaging','automation','ai','analytics','integration','utility')),
  icon          text default '🔌',
  author        text default 'NuCRM',
  manifest      jsonb not null default '{}',   -- full ModuleManifest
  is_available  boolean default true,
  is_free       boolean default false,         -- available on free plan?
  price_monthly numeric(10,2) default 0,
  sort_order    integer default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Seed built-in modules
insert into public.modules (id, name, version, description, category, icon, is_available, is_free, price_monthly, sort_order, manifest)
values
  ('core-crm',         'Core CRM',            '1.0.0', 'Contacts, deals, tasks, calendar',   'utility',      '📋', true,  true,  0,   0,  '{"features":["contacts","deals","tasks","calendar","reports"]}'::jsonb),
  ('automation-basic', 'Basic Automation',    '1.0.0', '5 pre-built workflow automations',    'automation',   '⚡', true,  true,  0,   1,  '{"features":["5 prebuilt workflows","email triggers","task triggers"]}'::jsonb),
  ('automation-pro',   'Automation Pro',      '1.0.0', 'Custom workflows, sequences, rules',  'automation',   '🚀', true,  false, 29,  2,  '{"features":["unlimited workflows","visual builder","sequences","conditions","branching"]}'::jsonb),
  ('whatsapp-bot',     'WhatsApp Automation', '1.0.0', 'WhatsApp Business API integration',   'messaging',    '💬', true,  false, 19,  3,  '{"features":["WhatsApp Business API","auto-replies","templates","campaigns"]}'::jsonb),
  ('email-sync',       'Email Sync',          '1.0.0', 'Gmail & Outlook 2-way sync',          'integration',  '📧', true,  false, 15,  4,  '{"features":["Gmail OAuth","Outlook OAuth","2-way sync","email tracking"]}'::jsonb),
  ('ai-assistant',     'AI Assistant',        '1.0.0', 'AI email drafting, lead scoring',     'ai',           '🤖', true,  false, 25,  5,  '{"features":["email drafting","lead scoring","deal predictions","contact enrichment"]}'::jsonb),
  ('forms-builder',    'Forms Builder',       '1.0.0', 'Custom lead capture forms',           'utility',      '📝', true,  false, 10,  6,  '{"features":["drag-drop builder","conditional logic","multi-step","embed anywhere"]}'::jsonb),
  ('analytics-pro',    'Analytics Pro',       '1.0.0', 'Advanced reporting and dashboards',   'analytics',    '📊', true,  false, 15,  7,  '{"features":["custom reports","PDF export","scheduled email reports","funnel charts"]}'::jsonb)
on conflict (id) do update set
  name = excluded.name, version = excluded.version,
  description = excluded.description, updated_at = now();

-- ─────────────────────────────────────────────────────────────
-- 3. TENANT MODULES (per-org module installs)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.tenant_modules (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade not null,
  module_id     text references public.modules(id) on delete cascade not null,
  status        text default 'active'
                check (status in ('active','disabled','error','installing')),
  settings      jsonb default '{}',
  installed_at  timestamptz default now(),
  installed_by  uuid references public.users on delete set null,
  last_used_at  timestamptz,
  error_message text,
  unique (tenant_id, module_id)
);
create index if not exists tenant_modules_tenant_idx on public.tenant_modules(tenant_id, status);

-- Auto-install core modules for all existing tenants
insert into public.tenant_modules (tenant_id, module_id, status)
select t.id, 'core-crm', 'active'
from public.tenants t
where not exists (
  select 1 from public.tenant_modules tm
  where tm.tenant_id = t.id and tm.module_id = 'core-crm'
)
on conflict do nothing;

insert into public.tenant_modules (tenant_id, module_id, status)
select t.id, 'automation-basic', 'active'
from public.tenants t
where not exists (
  select 1 from public.tenant_modules tm
  where tm.tenant_id = t.id and tm.module_id = 'automation-basic'
)
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────
-- 4. AUTOMATIONS (custom, per-tenant — replaces basic pre-builts)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.automations (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade not null,
  name          text not null,
  description   text,
  is_active     boolean default true,
  trigger_type  text not null,
  trigger_config jsonb default '{}',
  actions       jsonb not null default '[]',   -- AutomationAction[]
  conditions    jsonb default '[]',             -- filter conditions
  run_count     integer default 0,
  last_run_at   timestamptz,
  last_error    text,
  created_by    uuid references public.users on delete set null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists automations_tenant_active_idx
  on public.automations(tenant_id, is_active, trigger_type);

create table if not exists public.automation_runs (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid references public.tenants on delete cascade not null,
  automation_id   uuid references public.automations on delete set null,
  trigger_type    text not null,
  trigger_data    jsonb default '{}',
  status          text default 'success' check (status in ('success','failed','skipped')),
  actions_run     integer default 0,
  error           text,
  duration_ms     integer,
  created_at      timestamptz default now()
);
create index if not exists auto_runs_tenant_idx
  on public.automation_runs(tenant_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 5. SEQUENCES (drip campaigns / follow-up chains)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sequences (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade not null,
  name          text not null,
  description   text,
  is_active     boolean default true,
  steps         jsonb not null default '[]',  -- [{delay_days, action_type, template_id, content}]
  enroll_count  integer default 0,
  created_by    uuid references public.users on delete set null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists public.sequence_enrollments (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade not null,
  sequence_id   uuid references public.sequences on delete cascade not null,
  contact_id    uuid references public.contacts on delete cascade not null,
  current_step  integer default 0,
  status        text default 'active' check (status in ('active','paused','completed','cancelled')),
  next_run_at   timestamptz,
  enrolled_at   timestamptz default now(),
  completed_at  timestamptz,
  unique (sequence_id, contact_id)
);
create index if not exists seq_enroll_next_idx
  on public.sequence_enrollments(next_run_at, status) where status = 'active';

-- ─────────────────────────────────────────────────────────────
-- 6. WEBHOOK DELIVERIES (audit trail for outgoing webhooks)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.webhook_deliveries (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid references public.tenants on delete cascade not null,
  integration_id  uuid references public.integrations on delete cascade not null,
  event           text not null,
  payload         jsonb not null default '{}',
  status          text default 'pending' check (status in ('pending','delivered','failed')),
  response_code   integer,
  response_body   text,
  attempts        integer default 0,
  next_retry_at   timestamptz,
  delivered_at    timestamptz,
  created_at      timestamptz default now()
);
create index if not exists webhook_del_tenant_idx
  on public.webhook_deliveries(tenant_id, created_at desc);
create index if not exists webhook_del_retry_idx
  on public.webhook_deliveries(next_retry_at)
  where status = 'failed' and next_retry_at is not null;

-- ─────────────────────────────────────────────────────────────
-- 7. FILE ATTACHMENTS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.file_attachments (
  id              uuid primary key default uuid_generate_v4(),
  tenant_id       uuid references public.tenants on delete cascade not null,
  uploaded_by     uuid references public.users on delete set null,
  resource_type   text not null check (resource_type in ('contact','deal','company','task','note')),
  resource_id     uuid not null,
  filename        text not null,
  original_name   text not null,
  mime_type       text not null,
  size_bytes      bigint not null,
  storage_path    text not null,   -- S3 key or local path
  storage_type    text default 'local' check (storage_type in ('local','s3','r2')),
  is_public       boolean default false,
  created_at      timestamptz default now()
);
create index if not exists files_resource_idx
  on public.file_attachments(tenant_id, resource_type, resource_id);

-- ─────────────────────────────────────────────────────────────
-- 8. API KEY AUTHENTICATION MIDDLEWARE TABLE
--    Track which tenant/user an API key belongs to for middleware
-- ─────────────────────────────────────────────────────────────
alter table public.api_keys
  add column if not exists call_count bigint default 0,
  add column if not exists last_ip    text;

-- ─────────────────────────────────────────────────────────────
-- 9. FORMS (custom lead capture forms)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.forms (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade not null,
  name          text not null,
  slug          text not null,             -- URL slug for embed
  description   text,
  fields        jsonb not null default '[]',  -- [{type,label,key,required,options}]
  settings      jsonb default '{}',           -- {redirect_url, success_message, notify_email}
  is_active     boolean default true,
  submission_count integer default 0,
  created_by    uuid references public.users on delete set null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (tenant_id, slug)
);

create table if not exists public.form_submissions (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade not null,
  form_id       uuid references public.forms on delete cascade not null,
  contact_id    uuid references public.contacts on delete set null,
  data          jsonb not null default '{}',
  ip_address    text,
  user_agent    text,
  created_at    timestamptz default now()
);
create index if not exists form_sub_form_idx
  on public.form_submissions(form_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 10. GLOBAL SEARCH INDEX (denormalized for fast search)
-- ─────────────────────────────────────────────────────────────
create index if not exists contacts_search_idx
  on public.contacts using gin(
    to_tsvector('simple',
      coalesce(first_name,'') || ' ' ||
      coalesce(last_name,'') || ' ' ||
      coalesce(email,'') || ' ' ||
      coalesce(phone,'')
    )
  ) where deleted_at is null;

create index if not exists deals_search_idx
  on public.deals using gin(to_tsvector('simple', coalesce(title,'')))
  where deleted_at is null;

create index if not exists companies_search_idx
  on public.companies using gin(to_tsvector('simple', coalesce(name,'')))
  where deleted_at is null;

-- ─────────────────────────────────────────────────────────────
-- 11. SYSTEM ROLE SEEDS for every tenant
-- ─────────────────────────────────────────────────────────────
-- Insert default roles for tenants that don't have them
insert into public.roles (tenant_id, name, slug, is_system, permissions, sort_order)
select
  t.id,
  r.name,
  r.slug,
  true,
  r.perms::jsonb,
  r.sort_order
from public.tenants t
cross join (
  values
    ('Admin',        'admin',        '{"all":true}',                                                                                             0),
    ('Manager',      'manager',      '{"contacts.view_all":true,"contacts.create":true,"contacts.edit":true,"deals.view_all":true,"deals.create":true,"deals.edit":true,"tasks.create":true,"tasks.edit":true,"tasks.view_all":true,"companies.create":true,"companies.edit":true,"reports.view":true,"team.view":true}', 1),
    ('Sales Rep',    'sales_rep',    '{"contacts.create":true,"contacts.edit":true,"deals.create":true,"deals.edit":true,"deals.view_value":true,"tasks.create":true,"tasks.edit":true,"companies.create":true,"companies.edit":true,"team.view":true}', 2),
    ('Lead Manager', 'lead_manager', '{"contacts.view_all":true,"contacts.assign":true,"contacts.edit":true,"deals.view_all":true,"team.view":true,"reports.view":true}', 3),
    ('Viewer',       'viewer',       '{"contacts.view_all":true,"deals.view_all":true,"tasks.view_all":true,"companies.view_all":true,"team.view":true,"reports.view":true}', 4)
) as r(name, slug, perms, sort_order)
where not exists (
  select 1 from public.roles
  where tenant_id = t.id and slug = r.slug
)
on conflict do nothing;

select 'Migration 008 complete.' as result;

-- ─────────────────────────────────────────────────────────────
-- 11. STRIPE CUSTOMER ID on tenants
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
CREATE INDEX IF NOT EXISTS tenants_stripe_customer_idx ON public.tenants(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 12. IMPERSONATION AUDIT
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS impersonated_by uuid REFERENCES public.users ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS audit_logs_impersonated_idx
  ON public.audit_logs(impersonated_by) WHERE impersonated_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 13. TASK NOTIFICATION IDEMPOTENCY
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

-- ─────────────────────────────────────────────────────────────
-- 14. EMAIL TRACKING (open pixel + click proxy)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_tracking (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     uuid REFERENCES public.tenants ON DELETE CASCADE NOT NULL,
  contact_id    uuid REFERENCES public.contacts ON DELETE CASCADE,
  sequence_enrollment_id uuid REFERENCES public.sequence_enrollments ON DELETE SET NULL,
  message_id    text,          -- Resend message ID or internal ID
  recipient     text NOT NULL,
  subject       text,
  opened_at     timestamptz,
  open_count    integer DEFAULT 0,
  clicked_at    timestamptz,
  click_count   integer DEFAULT 0,
  clicks        jsonb DEFAULT '[]'::jsonb,  -- [{url, clicked_at}]
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_tracking_tenant_idx ON public.email_tracking(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_tracking_contact_idx ON public.email_tracking(contact_id);
