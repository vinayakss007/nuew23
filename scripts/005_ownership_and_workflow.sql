-- ═══════════════════════════════════════════════════════════════
-- Migration 005: Ownership, User Departure, Subdomain Support
-- Run: psql $DATABASE_URL -f scripts/005_ownership_and_workflow.sql
-- ═══════════════════════════════════════════════════════════════

-- ── 1. CONTACTS: add re-assignment + ownership tracking ────────
alter table public.contacts
  add column if not exists original_owner_id uuid references public.users on delete set null,
  add column if not exists last_assigned_at   timestamptz;

-- When a contact is created, original_owner = assigned_to
update public.contacts
  set original_owner_id = assigned_to
  where original_owner_id is null and assigned_to is not null;

-- ── 2. LEADS OWNERSHIP: explicit lead visibility rules ─────────
-- lead_access: 'owner_only' | 'team' | 'tenant'
alter table public.contacts
  add column if not exists lead_access text default 'team'
    check (lead_access in ('owner_only','team','tenant') or lead_access is null);

-- ── 3. USER DEPARTURE LOG ──────────────────────────────────────
create table if not exists public.user_departures (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid references public.tenants on delete cascade not null,
  user_id      uuid references public.users on delete set null,
  user_email   text not null,
  user_name    text,
  departed_at  timestamptz default now(),
  departed_by  uuid references public.users on delete set null, -- admin who removed them
  reason       text,
  -- What happened to their data
  contacts_reassigned_to uuid references public.users on delete set null,
  contacts_count integer default 0,
  deals_count    integer default 0,
  tasks_count    integer default 0,
  -- Account remains but role is 'removed'
  data_retained  boolean default true  -- contacts/deals stay in system
);
create index if not exists departures_tenant_idx on public.user_departures(tenant_id, departed_at desc);

-- ── 4. SUBDOMAIN / CUSTOM DOMAIN ──────────────────────────────
-- subdomain: mycompany.yourcrm.com
-- custom_domain: crm.mycompany.com (with DNS CNAME)
alter table public.tenants
  add column if not exists subdomain      text unique,  -- e.g. 'acme' → acme.nucrm.io
  add column if not exists domain_verified boolean default false,
  add column if not exists domain_verified_at timestamptz;

create index if not exists tenants_subdomain_idx on public.tenants(subdomain) where subdomain is not null;
create index if not exists tenants_domain_idx    on public.tenants(custom_domain) where custom_domain is not null;

-- ── 5. TENANT MULTI-WORKSPACE for users ───────────────────────
-- Users can belong to multiple orgs — already supported by tenant_members
-- Add: default_tenant for users who belong to multiple
alter table public.users
  add column if not exists default_tenant_id uuid references public.tenants on delete set null;

-- ── 6. ROLE: add 'lead_manager' system role ───────────────────
-- Lead manager: can assign/revoke leads from reps, cannot delete
-- This runs per-tenant via a function call
create or replace function public.ensure_lead_manager_role(p_tenant_id uuid)
returns void language plpgsql security definer as $$
begin
  insert into public.roles (tenant_id, name, slug, description, is_system, permissions, sort_order)
  values (
    p_tenant_id, 'Lead Manager', 'lead_manager',
    'Assigns and revokes leads. Cannot delete data.',
    true,
    '{
      "contacts.view_all":true,"contacts.create":true,"contacts.edit":true,
      "contacts.delete":false,"contacts.assign":true,"contacts.import":true,"contacts.export":true,
      "companies.view_all":true,"companies.create":true,"companies.edit":true,"companies.delete":false,
      "deals.view_all":true,"deals.create":true,"deals.edit":true,"deals.delete":false,
      "deals.assign":true,"deals.view_value":true,
      "tasks.view_all":true,"tasks.create":true,"tasks.edit":true,"tasks.delete":false,"tasks.assign":true,
      "reports.view":true,"team.view":true
    }'::jsonb,
    1
  )
  on conflict (tenant_id, slug) do nothing;
end; $$;

-- Add lead_manager to all existing tenants
do $$ declare tid uuid; begin
  for tid in select id from public.tenants loop
    perform public.ensure_lead_manager_role(tid);
  end loop;
end; $$;

-- Update on_tenant_created to include lead_manager
create or replace function public.create_default_roles(p_tenant_id uuid)
returns void language plpgsql security definer as $$
begin
  insert into public.roles (tenant_id, name, slug, description, is_system, permissions, sort_order)
  values
  (p_tenant_id, 'Admin', 'admin', 'Full access to everything', true, '{"all": true}'::jsonb, 0),
  (p_tenant_id, 'Lead Manager', 'lead_manager', 'Assign/revoke leads. Cannot delete.', true,
   '{"contacts.view_all":true,"contacts.create":true,"contacts.edit":true,"contacts.delete":false,
     "contacts.assign":true,"contacts.import":true,"contacts.export":true,
     "companies.view_all":true,"companies.create":true,"companies.edit":true,"companies.delete":false,
     "deals.view_all":true,"deals.create":true,"deals.edit":true,"deals.delete":false,
     "deals.assign":true,"deals.view_value":true,
     "tasks.view_all":true,"tasks.create":true,"tasks.edit":true,"tasks.delete":false,"tasks.assign":true,
     "reports.view":true,"team.view":true}'::jsonb, 1),
  (p_tenant_id, 'Manager', 'manager', 'Manage team and all records, cannot delete', true,
   '{"contacts.view_all":true,"contacts.create":true,"contacts.edit":true,"contacts.delete":false,
     "contacts.import":true,"contacts.export":true,"contacts.assign":true,
     "companies.view_all":true,"companies.create":true,"companies.edit":true,"companies.delete":false,
     "deals.view_all":true,"deals.create":true,"deals.edit":true,"deals.delete":false,
     "deals.view_value":true,"deals.assign":true,
     "tasks.view_all":true,"tasks.create":true,"tasks.edit":true,"tasks.delete":false,"tasks.assign":true,
     "reports.view":true,"reports.export":true,"settings.view":true,"team.view":true,"team.invite":true}'::jsonb, 2),
  (p_tenant_id, 'Sales Rep', 'sales_rep', 'Own records only. Cannot delete or view others.', true,
   '{"contacts.create":true,"contacts.edit":true,"contacts.view_all":false,
     "companies.create":true,"companies.edit":true,
     "deals.create":true,"deals.edit":true,"deals.view_all":false,"deals.view_value":true,
     "tasks.create":true,"tasks.edit":true,"team.view":true}'::jsonb, 3),
  (p_tenant_id, 'Viewer', 'viewer', 'Read-only access to all records', true,
   '{"contacts.view_all":true,"companies.view_all":true,"deals.view_all":true,
     "deals.view_value":true,"tasks.view_all":true,"reports.view":true,"team.view":true}'::jsonb, 4)
  on conflict (tenant_id, slug) do nothing;
end; $$;

-- ── 7. LEAD ASSIGNMENT TABLE ────────────────────────────────────
-- Track who leads are formally assigned to (separate from contacts.assigned_to)
-- This lets managers see assignment history
create table if not exists public.lead_assignments (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid references public.tenants on delete cascade not null,
  contact_id   uuid references public.contacts on delete cascade not null,
  assigned_to  uuid references public.users on delete set null,
  assigned_by  uuid references public.users on delete set null,
  assigned_at  timestamptz default now(),
  unassigned_at timestamptz,
  reason       text
);
create index if not exists lead_assignments_contact_idx on public.lead_assignments(contact_id, assigned_at desc);
create index if not exists lead_assignments_user_idx    on public.lead_assignments(tenant_id, assigned_to) where unassigned_at is null;

commit;
