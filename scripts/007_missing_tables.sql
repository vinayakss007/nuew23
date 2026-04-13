-- ═══════════════════════════════════════════════════════════════
-- NuCRM Migration 007 — Missing Tables & Schema Gaps
-- These tables are referenced in code but never defined in SQL.
-- Run: psql $DATABASE_URL -f scripts/007_missing_tables.sql
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. AUTOMATION WORKFLOWS — per-tenant workflow enable/config
--    Referenced in: app/api/tenant/automation/workflows/route.ts
-- ─────────────────────────────────────────────────────────────
create table if not exists public.automation_workflows (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid references public.tenants on delete cascade not null,
  workflow_id  text not null,  -- references PREBUILT_WORKFLOWS[].id
  name         text not null,
  description  text,
  enabled      boolean default false,
  config       jsonb default '{}'::jsonb,
  run_count    integer default 0,
  last_run_at  timestamptz,
  last_error   text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (tenant_id, workflow_id)
);
create index if not exists automation_tenant_idx
  on public.automation_workflows(tenant_id, enabled);

-- ─────────────────────────────────────────────────────────────
-- 2. AUTOMATION WORKFLOW RUNS — execution log
-- ─────────────────────────────────────────────────────────────
create table if not exists public.automation_runs (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid references public.tenants on delete cascade not null,
  workflow_id  text not null,
  trigger_data jsonb default '{}'::jsonb,
  status       text default 'success' check (status in ('success','failed','skipped')),
  error        text,
  duration_ms  integer,
  created_at   timestamptz default now()
);
create index if not exists automation_runs_tenant_idx
  on public.automation_runs(tenant_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 3. INVITATIONS — referenced in invite/send + accept-invite
--    May already exist; safe with IF NOT EXISTS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.invitations (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid references public.tenants on delete cascade not null,
  email        text not null,
  role_slug    text not null default 'member',
  token        text unique not null default encode(gen_random_bytes(32), 'hex'),
  invited_by   uuid references public.users on delete set null,
  accepted_at  timestamptz,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  created_at   timestamptz default now(),
  unique (tenant_id, email)
);
create index if not exists invitations_token_idx
  on public.invitations(token) where accepted_at is null;
create index if not exists invitations_tenant_idx
  on public.invitations(tenant_id, expires_at desc);

-- ─────────────────────────────────────────────────────────────
-- 4. PLATFORM_SETTINGS — referenced in superadmin settings
-- ─────────────────────────────────────────────────────────────
create table if not exists public.platform_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────
-- 5. MEETINGS — referenced throughout but may not exist yet
-- ─────────────────────────────────────────────────────────────
create table if not exists public.meetings (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid references public.tenants on delete cascade not null,
  user_id      uuid references public.users on delete set null,
  contact_id   uuid references public.contacts on delete set null,
  deal_id      uuid references public.deals on delete set null,
  title        text not null,
  description  text,
  start_time   timestamptz not null,
  end_time     timestamptz,
  location     text,
  meeting_url  text,
  status       text default 'scheduled'
               check (status in ('scheduled','completed','cancelled','no_show')),
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists meetings_tenant_time_idx
  on public.meetings(tenant_id, start_time asc);
create index if not exists meetings_contact_idx
  on public.meetings(contact_id) where contact_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 6. NOTIFICATIONS — ensure tenant_id column exists
--    Referenced in notifications routes; must be tenant-scoped
-- ─────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id         uuid primary key default uuid_generate_v4(),
  tenant_id  uuid references public.tenants on delete cascade not null,
  user_id    uuid references public.users on delete cascade not null,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  is_read    boolean default false,
  created_at timestamptz default now()
);
create index if not exists notif_user_tenant_idx
  on public.notifications(user_id, tenant_id, created_at desc);
create index if not exists notif_unread_idx
  on public.notifications(user_id, tenant_id) where is_read = false;

-- Add tenant_id to notifications if it was created without it
do $$ begin
  alter table public.notifications add column if not exists tenant_id uuid
    references public.tenants on delete cascade;
exception when others then null;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 7. AUDIT_LOGS — ensure exists with all needed columns
-- ─────────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade,
  user_id       uuid references public.users on delete set null,
  action        text not null,
  resource_type text not null,
  resource_id   uuid,
  old_data      jsonb,
  new_data      jsonb,
  ip_address    text,
  user_agent    text,
  metadata      jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);
create index if not exists audit_tenant_idx
  on public.audit_logs(tenant_id, created_at desc);
create index if not exists audit_user_idx
  on public.audit_logs(user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 8. PURGE_TRASH FUNCTION — called by trash DELETE route
-- ─────────────────────────────────────────────────────────────
create or replace function public.purge_trash()
returns integer language plpgsql security definer as $$
declare
  purged integer := 0;
  n      integer;
begin
  delete from public.contacts
    where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics n = row_count; purged := purged + n;

  delete from public.deals
    where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics n = row_count; purged := purged + n;

  delete from public.tasks
    where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics n = row_count; purged := purged + n;

  delete from public.companies
    where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics n = row_count; purged := purged + n;

  return purged;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 9. PRODUCTS table — referenced in 004 updated_at trigger list
-- ─────────────────────────────────────────────────────────────
create table if not exists public.products (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid references public.tenants on delete cascade not null,
  name         text not null,
  description  text,
  price        numeric(12,2) default 0,
  currency     text default 'USD',
  sku          text,
  is_active    boolean default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists products_tenant_idx on public.products(tenant_id);

-- ─────────────────────────────────────────────────────────────
-- 10. INDEX for fast last_tenant_id lookups
-- ─────────────────────────────────────────────────────────────
create index if not exists users_last_tenant_idx
  on public.users(last_tenant_id) where last_tenant_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 11. Add missing metadata column to audit_logs if needed
-- ─────────────────────────────────────────────────────────────
alter table public.audit_logs
  add column if not exists metadata jsonb default '{}'::jsonb;

select 'Migration 007 complete — all missing tables and functions created.' as result;

-- ─────────────────────────────────────────────────────────────
-- 12. RATE_LIMITS — used by rate-limit.ts
-- ─────────────────────────────────────────────────────────────
create table if not exists public.rate_limits (
  key          text not null,
  action       text not null,
  count        integer default 1,
  window_start timestamptz not null,
  primary key (key, action, window_start)
);
create index if not exists rate_limits_window_idx
  on public.rate_limits(window_start);

-- ─────────────────────────────────────────────────────────────
-- 13. PLATFORM_STATS function — called by superadmin dashboard
-- ─────────────────────────────────────────────────────────────
create or replace function public.platform_stats()
returns jsonb language sql security definer as $$
  select jsonb_build_object(
    'total_tenants',     (select count(*) from public.tenants),
    'active_tenants',    (select count(*) from public.tenants where status = 'active'),
    'trialing_tenants',  (select count(*) from public.tenants where status = 'trialing'),
    'total_users',       (select count(*) from public.users),
    'total_contacts',    (select count(*) from public.contacts where deleted_at is null),
    'unresolved_errors', (select count(*) from public.error_logs where resolved = false),
    'mrr',               (
      select coalesce(sum(p.price_monthly), 0)
      from public.tenants t
      join public.plans p on p.id = t.plan_id
      where t.status = 'active' and p.price_monthly > 0
    )
  );
$$;

-- ─────────────────────────────────────────────────────────────
-- 14. PASSWORD_RESETS — used by forgot/reset password routes
-- ─────────────────────────────────────────────────────────────
create table if not exists public.password_resets (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.users on delete cascade not null,
  token_hash  text not null unique,
  expires_at  timestamptz not null default (now() + interval '1 hour'),
  used_at     timestamptz,
  created_at  timestamptz default now()
);
create index if not exists pwd_reset_token_idx
  on public.password_resets(token_hash) where used_at is null;
