-- ═══════════════════════════════════════════════════════════════
-- NuCRM SaaS — Migration 003: Soft Deletes + Auto-backup improvements
-- Run: psql $DATABASE_URL -f scripts/003_soft_deletes.sql
-- ═══════════════════════════════════════════════════════════════

-- ── Add soft delete columns to users (for super admin management) ─
alter table public.users
  add column if not exists deleted_at   timestamptz,
  add column if not exists deleted_by   uuid references public.users on delete set null;

-- ── Add soft delete columns to all CRM tables ─────────────────
alter table public.contacts
  add column if not exists deleted_at   timestamptz,
  add column if not exists deleted_by   uuid references public.users on delete set null;

alter table public.deals
  add column if not exists deleted_at   timestamptz,
  add column if not exists deleted_by   uuid references public.users on delete set null;

alter table public.tasks
  add column if not exists deleted_at   timestamptz,
  add column if not exists deleted_by   uuid references public.users on delete set null;

alter table public.companies
  add column if not exists deleted_at   timestamptz,
  add column if not exists deleted_by   uuid references public.users on delete set null;

alter table public.activities
  add column if not exists deleted_at   timestamptz;

alter table public.meetings
  add column if not exists deleted_at   timestamptz,
  add column if not exists deleted_by   uuid references public.users on delete set null;

-- ── Index: fast trash queries ──────────────────────────────────
create index if not exists contacts_deleted_idx  on public.contacts(tenant_id, deleted_at) where deleted_at is not null;
create index if not exists deals_deleted_idx     on public.deals(tenant_id, deleted_at)    where deleted_at is not null;
create index if not exists tasks_deleted_idx     on public.tasks(tenant_id, deleted_at)    where deleted_at is not null;
create index if not exists companies_deleted_idx on public.companies(tenant_id, deleted_at) where deleted_at is not null;

-- ── Update existing queries: treat deleted_at IS NULL as "active" ──
-- All SELECT queries must add: AND deleted_at IS NULL
-- All existing is_archived contacts: mark as deleted too
update public.contacts set deleted_at = updated_at, is_archived = true
  where is_archived = true and deleted_at is null;

-- ── Trash bin: view of all soft-deleted records ────────────────
create or replace view public.trash_bin as
  select 'contact'  as resource_type, id, tenant_id, deleted_at, deleted_by,
         first_name || ' ' || last_name as name, null::text as extra
  from public.contacts where deleted_at is not null
  union all
  select 'deal', id, tenant_id, deleted_at, deleted_by,
         title, stage
  from public.deals where deleted_at is not null
  union all
  select 'task', id, tenant_id, deleted_at, deleted_by,
         title, priority
  from public.tasks where deleted_at is not null
  union all
  select 'company', id, tenant_id, deleted_at, deleted_by,
         name, null
  from public.companies where deleted_at is not null;

-- ── Auto-purge: permanently delete items in trash > 30 days ───
create or replace function public.purge_trash()
returns integer language plpgsql security definer as $$
declare v_count integer := 0; n integer;
begin
  delete from public.contacts  where deleted_at < now() - interval '30 days';
  get diagnostics n = row_count; v_count := v_count + n;
  delete from public.deals     where deleted_at < now() - interval '30 days';
  get diagnostics n = row_count; v_count := v_count + n;
  delete from public.tasks     where deleted_at < now() - interval '30 days';
  get diagnostics n = row_count; v_count := v_count + n;
  delete from public.companies where deleted_at < now() - interval '30 days';
  get diagnostics n = row_count; v_count := v_count + n;
  return v_count;
end; $$;

-- ── Backup health check: alert if no backup in 25 hours ───────
create table if not exists public.backup_alerts (
  id           uuid primary key default uuid_generate_v4(),
  alert_type   text not null,
  message      text not null,
  resolved     boolean default false,
  created_at   timestamptz default now()
);

-- ── Auto-restart log: track process crashes ───────────────────
create table if not exists public.process_restarts (
  id           uuid primary key default uuid_generate_v4(),
  reason       text,
  pid_before   integer,
  pid_after    integer,
  created_at   timestamptz default now()
);

commit;
