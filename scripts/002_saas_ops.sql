-- ═══════════════════════════════════════════════════════════════
-- NuCRM SaaS Ops Schema — Migration 002
-- Adds: monitoring, billing events, backups, error logs,
--       system health, usage snapshots, support tickets
-- Run: psql $DATABASE_URL -f scripts/002_saas_ops.sql
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- BILLING EVENTS  (Stripe webhooks / manual upgrades / invoices)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.billing_events (
  id             uuid primary key default uuid_generate_v4(),
  tenant_id      uuid references public.tenants on delete cascade,
  event_type     text not null,  -- 'subscription.created','invoice.paid','upgrade','downgrade','cancelled','trial_ended'
  plan_from      text,
  plan_to        text,
  amount         numeric(10,2) default 0,
  currency       text default 'USD',
  stripe_event_id text unique,
  invoice_url    text,
  metadata       jsonb default '{}'::jsonb,
  created_at     timestamptz default now() not null
);
create index if not exists billing_tenant_idx on public.billing_events(tenant_id, created_at desc);
create index if not exists billing_type_idx   on public.billing_events(event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- USAGE SNAPSHOTS  (daily snapshot of tenant usage for billing)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.usage_snapshots (
  id             uuid primary key default uuid_generate_v4(),
  tenant_id      uuid references public.tenants on delete cascade not null,
  snapshot_date  date not null default current_date,
  contacts_count integer default 0,
  deals_count    integer default 0,
  users_count    integer default 0,
  api_calls      integer default 0,
  storage_bytes  bigint default 0,
  emails_sent    integer default 0,
  created_at     timestamptz default now(),
  unique (tenant_id, snapshot_date)
);
create index if not exists usage_tenant_date on public.usage_snapshots(tenant_id, snapshot_date desc);
create index if not exists usage_date_idx    on public.usage_snapshots(snapshot_date desc);

-- ─────────────────────────────────────────────────────────────
-- ERROR LOGS  (application errors, API errors, job failures)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.error_logs (
  id             uuid primary key default uuid_generate_v4(),
  tenant_id      uuid references public.tenants on delete cascade,
  user_id        uuid references public.users on delete set null,
  level          text default 'error' check (level in ('debug','info','warn','error','fatal')),
  code           text,           -- 'DB_CONNECTION_FAILED', 'EMAIL_DELIVERY_FAILED', etc.
  message        text not null,
  stack          text,
  context        jsonb,          -- request path, params, etc.
  resolved       boolean default false,
  resolved_at    timestamptz,
  created_at     timestamptz default now() not null
);
create index if not exists err_level_idx     on public.error_logs(level, created_at desc);
create index if not exists err_tenant_idx    on public.error_logs(tenant_id, created_at desc);
create index if not exists err_resolved_idx  on public.error_logs(resolved, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- SYSTEM HEALTH CHECKS  (ping results, DB checks, external deps)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.health_checks (
  id             uuid primary key default uuid_generate_v4(),
  service        text not null,  -- 'database','email','stripe','app'
  status         text not null check (status in ('up','degraded','down')),
  latency_ms     integer,
  message        text,
  checked_at     timestamptz default now() not null
);
create index if not exists health_service_idx on public.health_checks(service, checked_at desc);
-- Keep only 7 days of checks (purge older via job)
create index if not exists health_date_idx    on public.health_checks(checked_at desc);

-- ─────────────────────────────────────────────────────────────
-- BACKUP RECORDS  (log of DB dumps, S3 uploads)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.backup_records (
  id             uuid primary key default uuid_generate_v4(),
  backup_type    text not null check (backup_type in ('full','incremental','schema')),
  status         text not null default 'pending' check (status in ('pending','running','completed','failed')),
  size_bytes     bigint,
  storage_path   text,           -- S3 key or file path
  storage_type   text default 'local' check (storage_type in ('local','s3','gcs','azure')),
  duration_ms    integer,
  error_message  text,
  initiated_by   uuid references public.users on delete set null,
  initiated_auto boolean default false,
  metadata       jsonb default '{}'::jsonb,
  expires_at     timestamptz,
  created_at     timestamptz default now() not null,
  completed_at   timestamptz
);
create index if not exists backup_status_idx on public.backup_records(status, created_at desc);
create index if not exists backup_type_idx   on public.backup_records(backup_type, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- SUPPORT TICKETS  (in-app support from tenants)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.support_tickets (
  id             uuid primary key default uuid_generate_v4(),
  tenant_id      uuid references public.tenants on delete cascade not null,
  created_by     uuid references public.users on delete set null,
  assigned_to    uuid references public.users on delete set null,
  subject        text not null,
  body           text not null,
  status         text default 'open' check (status in ('open','in_progress','resolved','closed')),
  priority       text default 'normal' check (priority in ('low','normal','high','critical')),
  category       text default 'general',
  resolution     text,
  created_at     timestamptz default now() not null,
  updated_at     timestamptz default now() not null,
  resolved_at    timestamptz
);
create index if not exists ticket_status_idx  on public.support_tickets(status, created_at desc);
create index if not exists ticket_tenant_idx  on public.support_tickets(tenant_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- ANNOUNCEMENTS  (platform-wide banners for super admin)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.announcements (
  id             uuid primary key default uuid_generate_v4(),
  title          text not null,
  body           text not null,
  type           text default 'info' check (type in ('info','warning','maintenance','critical')),
  target         text default 'all' check (target in ('all','free','paid','specific')),
  target_plan    text,
  is_active      boolean default true,
  starts_at      timestamptz default now(),
  ends_at        timestamptz,
  created_by     uuid references public.users on delete set null,
  created_at     timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────
-- PLAN LIMIT VIOLATIONS  (log when tenants hit limits)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.limit_violations (
  id             uuid primary key default uuid_generate_v4(),
  tenant_id      uuid references public.tenants on delete cascade not null,
  resource       text not null, -- 'contacts','users','deals','storage','api_calls'
  limit_value    integer not null,
  actual_value   integer not null,
  action_taken   text, -- 'blocked','warned','allowed'
  created_at     timestamptz default now()
);
create index if not exists limit_tenant_idx on public.limit_violations(tenant_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: Take daily usage snapshot for all tenants
-- ─────────────────────────────────────────────────────────────
create or replace function public.snapshot_tenant_usage()
returns integer language plpgsql security definer as $$
declare
  v_count integer := 0;
begin
  insert into public.usage_snapshots
    (tenant_id, snapshot_date, contacts_count, deals_count, users_count)
  select
    t.id,
    current_date,
    (select count(*)::int from public.contacts where tenant_id=t.id and is_archived=false),
    (select count(*)::int from public.deals    where tenant_id=t.id),
    (select count(*)::int from public.tenant_members where tenant_id=t.id and status='active')
  from public.tenants t
  on conflict (tenant_id, snapshot_date) do update set
    contacts_count = excluded.contacts_count,
    deals_count    = excluded.deals_count,
    users_count    = excluded.users_count;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- FUNCTION: Platform-wide stats for super admin dashboard
-- ─────────────────────────────────────────────────────────────
create or replace function public.platform_stats()
returns jsonb language sql stable security definer as $$
  select jsonb_build_object(
    'total_tenants',   (select count(*) from public.tenants),
    'active_tenants',  (select count(*) from public.tenants where status='active'),
    'trialing',        (select count(*) from public.tenants where status='trialing'),
    'total_users',     (select count(*) from public.users),
    'total_contacts',  (select count(*) from public.contacts where is_archived=false),
    'total_deals',     (select count(*) from public.deals),
    'mrr',             (select coalesce(sum(p.price_monthly),0)
                        from public.tenants t join public.plans p on p.id=t.plan_id
                        where t.status='active'),
    'open_tickets',    (select count(*) from public.support_tickets where status in ('open','in_progress')),
    'unresolved_errors',(select count(*) from public.error_logs where resolved=false and level in ('error','fatal') and created_at > now()-interval '24 hours'),
    'db_size_bytes',   (select pg_database_size(current_database()))
  );
$$;

-- Apply updated_at trigger to new tables
select (select public.set_updated_at()) where false; -- ensure fn exists
do $$
declare tbl text;
begin
  foreach tbl in array array['support_tickets'] loop
    execute format('
      drop trigger if exists trg_updated_at on public.%I;
      create trigger trg_updated_at before update on public.%I
        for each row execute function public.set_updated_at();
    ', tbl, tbl);
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- RATE LIMITING  (login attempts, API abuse)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.rate_limits (
  id         uuid primary key default uuid_generate_v4(),
  key        text not null,        -- 'login:ip:1.2.3.4' or 'api:user_id'
  action     text not null,
  count      integer default 1,
  window_start timestamptz default now() not null,
  created_at   timestamptz default now()
);
create unique index if not exists rate_limits_key_action on public.rate_limits(key, action, window_start);
create index if not exists rate_limits_window on public.rate_limits(window_start);

-- PASSWORD RESET TOKENS
create table if not exists public.password_resets (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references public.users on delete cascade not null,
  token_hash text unique not null,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  used_at    timestamptz,
  created_at timestamptz default now()
);
create index if not exists pwd_reset_token on public.password_resets(token_hash);

-- ONBOARDING PROGRESS
create table if not exists public.onboarding_progress (
  tenant_id    uuid references public.tenants on delete cascade primary key,
  steps_done   text[] default '{}',
  completed    boolean default false,
  completed_at timestamptz,
  created_at   timestamptz default now()
);

-- EMAIL VERIFICATION TOKENS
create table if not exists public.email_verifications (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid references public.users on delete cascade not null,
  token_hash text unique not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  verified_at timestamptz,
  created_at  timestamptz default now()
);
create index if not exists email_ver_token on public.email_verifications(token_hash);
