-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Complete PostgreSQL Schema
-- Works with: Supabase, Railway, Neon, Render, self-hosted Postgres
-- Run: psql $DATABASE_URL -f 001_schema.sql
-- ═══════════════════════════════════════════════════════════════════

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ─────────────────────────────────────────────────────────────
-- 1. USERS  (replaces auth.users — works everywhere)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.users (
  id          uuid primary key default uuid_generate_v4(),
  email       text unique not null,
  password_hash text,                       -- null when using OAuth
  full_name   text,
  avatar_url  text,
  phone       text,
  timezone    text default 'UTC',
  is_super_admin boolean default false,
  last_tenant_id uuid,
  email_verified boolean default false,
  email_verify_token text,
  reset_token text,
  reset_token_expires timestamptz,
  oauth_provider text,                      -- 'google', 'github', etc.
  oauth_id    text,
  deleted_at  timestamptz,                  -- soft delete
  deleted_by  uuid references public.users on delete set null,
  created_at  timestamptz default now() not null,
  updated_at  timestamptz default now() not null
);

create index if not exists users_email_idx on public.users(email);

-- ─────────────────────────────────────────────────────────────
-- 2. SESSIONS  (JWT-based auth sessions)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sessions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.users on delete cascade not null,
  token_hash  text unique not null,
  expires_at  timestamptz not null,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz default now() not null
);

create index if not exists sessions_token_idx on public.sessions(token_hash);
create index if not exists sessions_user_idx  on public.sessions(user_id);

-- ─────────────────────────────────────────────────────────────
-- 3. PLANS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.plans (
  id                 text primary key,
  name               text not null,
  price_monthly      numeric(10,2) default 0,
  price_yearly       numeric(10,2) default 0,
  max_users          integer default 5,
  max_contacts       integer default 1000,
  max_deals          integer default 500,
  max_storage_gb     numeric(6,2) default 1,
  max_automations    integer default 5,
  max_forms          integer default 3,
  max_api_calls_day  integer default 1000,
  features           jsonb default '[]'::jsonb,
  is_active          boolean default true,
  sort_order         integer default 0
);

insert into public.plans
  (id, name, price_monthly, price_yearly, max_users, max_contacts, max_deals,
   max_storage_gb, max_automations, max_forms, max_api_calls_day, features, sort_order)
values
  ('free',       'Free',       0,    0,     1,  500,    100,   0.5, 2,  1,  100,
   '["contacts","deals","tasks"]'::jsonb, 0),
  ('starter',    'Starter',    29,   290,   5,  2500,   1000,  2,   10, 5,  5000,
   '["contacts","deals","tasks","automations","forms","reports"]'::jsonb, 1),
  ('pro',        'Pro',        79,   790,   25, 15000,  5000,  10,  50, 25, 25000,
   '["contacts","deals","tasks","automations","forms","reports","sequences","products","quotes","ai"]'::jsonb, 2),
  ('enterprise', 'Enterprise', 199,  1990,  -1, -1,     -1,    -1,  -1, -1, -1,
   '["all","custom_domain","sso","dedicated_support","audit_logs","custom_roles"]'::jsonb, 3)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 4. TENANTS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.tenants (
  id               uuid primary key default uuid_generate_v4(),
  name             text not null,
  slug             text unique not null,
  plan_id          text references public.plans(id) default 'free',
  owner_id         uuid references public.users on delete set null,

  -- Branding
  logo_url         text,
  primary_color    text default '#7c3aed',
  favicon_url      text,
  custom_domain    text unique,

  -- Status
  status           text default 'trialing'
                     check (status in ('trialing','active','suspended','cancelled','past_due','trial_expired')),
  trial_ends_at    timestamptz default (now() + interval '14 days'),
  subscription_id  text,
  billing_email    text,

  -- Usage counters
  current_users    integer default 0,
  current_contacts integer default 0,
  current_deals    integer default 0,
  storage_used_bytes bigint default 0,

  -- Settings
  settings jsonb default '{
    "timezone": "UTC",
    "date_format": "MMM DD, YYYY",
    "currency": "USD",
    "language": "en",
    "allow_signups": false,
    "require_2fa": false,
    "email_notifications": true,
    "data_retention_days": 365
  }'::jsonb,

  industry         text,
  company_size     text,
  country          text,
  created_at       timestamptz default now() not null,
  updated_at       timestamptz default now() not null
);

create index if not exists tenants_slug_idx on public.tenants(slug);
create index if not exists tenants_owner_idx on public.tenants(owner_id);

-- ─────────────────────────────────────────────────────────────
-- 5. ROLES
-- ─────────────────────────────────────────────────────────────
create table if not exists public.roles (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid references public.tenants on delete cascade not null,
  name        text not null,
  slug        text not null,
  description text,
  is_system   boolean default false,
  permissions jsonb not null default '{}'::jsonb,
  sort_order  integer default 0,
  created_at  timestamptz default now(),
  unique (tenant_id, slug)
);

create index if not exists roles_tenant_idx on public.roles(tenant_id);

-- ─────────────────────────────────────────────────────────────
-- 6. TENANT MEMBERS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.tenant_members (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid references public.tenants on delete cascade not null,
  user_id     uuid references public.users on delete cascade not null,
  role_id     uuid references public.roles on delete set null,
  role_slug   text not null default 'member',
  status      text default 'active'
                check (status in ('invited','active','suspended','removed')),
  invited_by  uuid references public.users on delete set null,
  invited_at  timestamptz default now(),
  joined_at   timestamptz,
  last_seen_at timestamptz,
  settings    jsonb default '{}'::jsonb,
  notification_prefs jsonb default '{
    "email_task_due": true,
    "email_deal_won": true,
    "email_mention": true,
    "push_enabled": false
  }'::jsonb,
  created_at  timestamptz default now() not null,
  unique (tenant_id, user_id)
);

create index if not exists members_tenant_idx on public.tenant_members(tenant_id);
create index if not exists members_user_idx   on public.tenant_members(user_id);

-- ─────────────────────────────────────────────────────────────
-- 7. PERMISSION OVERRIDES  (per-member overrides on top of role)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.permission_overrides (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid references public.tenants on delete cascade not null,
  member_id   uuid references public.tenant_members on delete cascade not null,
  permission  text not null,
  granted     boolean not null,
  granted_by  uuid references public.users on delete set null,
  created_at  timestamptz default now(),
  unique (member_id, permission)
);

-- ─────────────────────────────────────────────────────────────
-- 8. INVITATIONS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.invitations (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid references public.tenants on delete cascade not null,
  email       text not null,
  role_slug   text not null default 'member',
  token       text unique not null default encode(gen_random_bytes(32), 'hex'),
  invited_by  uuid references public.users on delete cascade not null,
  accepted_at timestamptz,
  expires_at  timestamptz default (now() + interval '7 days'),
  created_at  timestamptz default now(),
  unique (tenant_id, email)
);

create index if not exists invitations_token_idx     on public.invitations(token);
create index if not exists invitations_tenant_email  on public.invitations(tenant_id, email);

-- ─────────────────────────────────────────────────────────────
-- 9. CRM — COMPANIES
-- ─────────────────────────────────────────────────────────────
create table if not exists public.companies (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade not null,
  created_by    uuid references public.users on delete set null,
  name          text not null,
  industry      text,
  size          text,
  website       text,
  logo_url      text,
  phone         text,
  address       text,
  notes         text,
  custom_fields jsonb default '{}'::jsonb,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);

create index if not exists companies_tenant_idx on public.companies(tenant_id);
create index if not exists companies_name_idx   on public.companies using gin(name gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────
-- 10. CRM — CONTACTS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.contacts (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade not null,
  created_by    uuid references public.users on delete set null,
  assigned_to   uuid references public.users on delete set null,
  company_id    uuid references public.companies on delete set null,
  first_name    text not null,
  last_name     text default '',
  email         text,
  phone         text,
  address       text,
  city          text,
  country       text,
  tags          text[] default '{}',
  notes         text,
  avatar_url    text,
  linkedin_url  text,
  twitter_url   text,
  website       text,
  lead_source   text,
  lead_status   text default 'new'
                  check (lead_status in ('new','contacted','qualified','unqualified','converted','lost')),
  score         integer default 0,
  custom_fields jsonb default '{}'::jsonb,
  is_archived   boolean default false,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);

create index if not exists contacts_tenant_idx    on public.contacts(tenant_id);
create index if not exists contacts_assigned_idx  on public.contacts(tenant_id, assigned_to);
create index if not exists contacts_email_idx     on public.contacts(tenant_id, email);
create index if not exists contacts_name_idx      on public.contacts using gin((first_name || ' ' || last_name) gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────
-- 11. CRM — DEALS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.deals (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade not null,
  created_by    uuid references public.users on delete set null,
  assigned_to   uuid references public.users on delete set null,
  contact_id    uuid references public.contacts on delete set null,
  company_id    uuid references public.companies on delete set null,
  title         text not null,
  value         numeric(15,2) default 0,
  stage         text default 'lead'
                  check (stage in ('lead','qualified','proposal','negotiation','won','lost')),
  probability   integer default 10 check (probability between 0 and 100),
  close_date    date,
  notes         text,
  custom_fields jsonb default '{}'::jsonb,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);

create index if not exists deals_tenant_idx   on public.deals(tenant_id);
create index if not exists deals_assigned_idx on public.deals(tenant_id, assigned_to);
create index if not exists deals_stage_idx    on public.deals(tenant_id, stage);

-- ─────────────────────────────────────────────────────────────
-- 12. CRM — TASKS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade not null,
  created_by    uuid references public.users on delete set null,
  assigned_to   uuid references public.users on delete set null,
  contact_id    uuid references public.contacts on delete set null,
  deal_id       uuid references public.deals on delete set null,
  title         text not null,
  description   text,
  due_date      date,
  priority      text default 'medium' check (priority in ('low','medium','high')),
  completed     boolean default false,
  completed_at  timestamptz,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);

create index if not exists tasks_tenant_idx   on public.tasks(tenant_id);
create index if not exists tasks_assigned_idx on public.tasks(tenant_id, assigned_to);
create index if not exists tasks_due_idx      on public.tasks(tenant_id, due_date) where not completed;

-- ─────────────────────────────────────────────────────────────
-- 13. CRM — ACTIVITIES
-- ─────────────────────────────────────────────────────────────
create table if not exists public.activities (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid references public.tenants on delete cascade not null,
  user_id     uuid references public.users on delete set null,
  contact_id  uuid references public.contacts on delete cascade,
  deal_id     uuid references public.deals on delete cascade,
  type        text not null
                check (type in ('note','call','email','meeting','task','deal_update','contact_created')),
  description text not null,
  metadata    jsonb,
  created_at  timestamptz default now() not null
);

create index if not exists activities_tenant_idx  on public.activities(tenant_id, created_at desc);
create index if not exists activities_contact_idx on public.activities(contact_id);
create index if not exists activities_deal_idx    on public.activities(deal_id);

-- ─────────────────────────────────────────────────────────────
-- 14. NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.notifications (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid references public.tenants on delete cascade,
  user_id     uuid references public.users on delete cascade not null,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  is_read     boolean default false,
  metadata    jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

create index if not exists notif_user_unread on public.notifications(user_id, is_read, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 15. AUDIT LOGS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade,
  user_id       uuid references public.users on delete set null,
  action        text not null,
  resource_type text not null,
  resource_id   text,
  old_data      jsonb,
  new_data      jsonb,
  ip_address    text,
  user_agent    text,
  created_at    timestamptz default now() not null
);

create index if not exists audit_tenant_idx on public.audit_logs(tenant_id, created_at desc);
create index if not exists audit_user_idx   on public.audit_logs(user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 16. INTEGRATIONS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.integrations (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid references public.tenants on delete cascade not null,
  user_id     uuid references public.users on delete cascade not null,
  type        text not null,
  name        text not null,
  config      jsonb default '{}'::jsonb,
  is_active   boolean default true,
  last_used_at timestamptz,
  created_at  timestamptz default now()
);

create index if not exists integrations_tenant_idx on public.integrations(tenant_id);

-- ─────────────────────────────────────────────────────────────
-- 17. API KEYS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.api_keys (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid references public.tenants on delete cascade not null,
  user_id      uuid references public.users on delete cascade not null,
  name         text not null,
  key_hash     text unique not null,
  key_prefix   text not null,
  scopes       text[] default '{"read"}'::text[],
  is_active    boolean default true,
  last_used_at timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz default now()
);

create index if not exists api_keys_hash_idx   on public.api_keys(key_hash);
create index if not exists api_keys_tenant_idx on public.api_keys(tenant_id);

-- ─────────────────────────────────────────────────────────────
-- 18. EMAIL TEMPLATES
-- ─────────────────────────────────────────────────────────────
create table if not exists public.email_templates (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid references public.tenants on delete cascade not null,
  user_id     uuid references public.users on delete cascade not null,
  name        text not null,
  subject     text not null,
  html_body   text not null,
  text_body   text,
  category    text default 'transactional',
  variables   jsonb default '[]'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists email_tmpl_tenant_idx on public.email_templates(tenant_id);

-- ─────────────────────────────────────────────────────────────
-- 19. MEETINGS
-- ─────────────────────────────────────────────────────────────
create table if not exists public.meetings (
  id          uuid primary key default uuid_generate_v4(),
  tenant_id   uuid references public.tenants on delete cascade not null,
  user_id     uuid references public.users on delete cascade not null,
  contact_id  uuid references public.contacts on delete set null,
  deal_id     uuid references public.deals on delete set null,
  title       text not null,
  description text,
  start_time  timestamptz not null,
  end_time    timestamptz not null,
  location    text,
  meeting_url text,
  status      text default 'scheduled'
                check (status in ('scheduled','completed','cancelled','no_show')),
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists meetings_tenant_idx on public.meetings(tenant_id, start_time);

-- ─────────────────────────────────────────────────────────────
-- 20. HELPER FUNCTIONS
-- ─────────────────────────────────────────────────────────────

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Apply updated_at to relevant tables
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'users','tenants','companies','contacts','deals','tasks','meetings','email_templates'
  ] loop
    execute format('
      drop trigger if exists trg_updated_at on public.%I;
      create trigger trg_updated_at
        before update on public.%I
        for each row execute function public.set_updated_at();
    ', tbl, tbl);
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 21. PERMISSION CHECKING FUNCTION
-- ─────────────────────────────────────────────────────────────
create or replace function public.user_has_permission(
  p_user_id   uuid,
  p_tenant_id uuid,
  p_perm      text
) returns boolean language plpgsql stable security definer as $$
declare
  v_super     boolean;
  v_member_id uuid;
  v_role_slug text;
  v_override  boolean;
  v_perms     jsonb;
begin
  -- Super admin has all permissions
  select is_super_admin into v_super from public.users where id = p_user_id;
  if v_super then return true; end if;

  -- Get member record
  select id, role_slug into v_member_id, v_role_slug
  from public.tenant_members
  where tenant_id = p_tenant_id and user_id = p_user_id and status = 'active'
  limit 1;

  if v_member_id is null then return false; end if;

  -- Admin role has all tenant permissions
  if v_role_slug = 'admin' then return true; end if;

  -- Check per-member override first
  select granted into v_override
  from public.permission_overrides
  where member_id = v_member_id and permission = p_perm;
  if found then return v_override; end if;

  -- Check role permissions
  select permissions into v_perms
  from public.roles
  where tenant_id = p_tenant_id and slug = v_role_slug;

  if v_perms is null then return false; end if;

  return coalesce((v_perms->>'all')::boolean, false)
      or coalesce((v_perms->>p_perm)::boolean, false);
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 22. AUTO-CREATE DEFAULT ROLES FOR NEW TENANT
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_default_roles(p_tenant_id uuid)
returns void language plpgsql security definer as $$
begin
  insert into public.roles (tenant_id, name, slug, description, is_system, permissions, sort_order)
  values
  (p_tenant_id, 'Admin', 'admin',
   'Full access to everything in the workspace', true,
   '{"all": true}'::jsonb, 0),

  (p_tenant_id, 'Manager', 'manager',
   'Manage team and all records, cannot delete', true,
   '{"contacts.view_all":true,"contacts.create":true,"contacts.edit":true,"contacts.delete":false,
     "contacts.import":true,"contacts.export":true,"contacts.assign":true,
     "companies.view_all":true,"companies.create":true,"companies.edit":true,"companies.delete":false,
     "deals.view_all":true,"deals.create":true,"deals.edit":true,"deals.delete":false,"deals.view_value":true,"deals.assign":true,
     "tasks.view_all":true,"tasks.create":true,"tasks.edit":true,"tasks.delete":false,"tasks.assign":true,
     "reports.view":true,"reports.export":true,
     "settings.view":true,"team.view":true,"team.invite":true}'::jsonb, 1),

  (p_tenant_id, 'Sales Rep', 'sales_rep',
   'Create and manage their own records only', true,
   '{"contacts.create":true,"contacts.edit":true,"contacts.view_all":false,
     "companies.create":true,"companies.edit":true,
     "deals.create":true,"deals.edit":true,"deals.view_all":false,"deals.view_value":true,
     "tasks.create":true,"tasks.edit":true,
     "team.view":true}'::jsonb, 2),

  (p_tenant_id, 'Viewer', 'viewer',
   'Read-only access to all records', true,
   '{"contacts.view_all":true,"companies.view_all":true,"deals.view_all":true,
     "deals.view_value":true,"tasks.view_all":true,"reports.view":true,"team.view":true}'::jsonb, 3)

  on conflict (tenant_id, slug) do nothing;
end;
$$;

-- Auto-create roles + add owner when tenant is created
create or replace function public.on_tenant_created()
returns trigger language plpgsql security definer as $$
declare
  v_admin_role_id uuid;
begin
  -- Create default roles
  perform public.create_default_roles(new.id);

  -- Add owner as admin
  if new.owner_id is not null then
    select id into v_admin_role_id
    from public.roles
    where tenant_id = new.id and slug = 'admin';

    insert into public.tenant_members
      (tenant_id, user_id, role_slug, role_id, status, joined_at)
    values
      (new.id, new.owner_id, 'admin', v_admin_role_id, 'active', now())
    on conflict (tenant_id, user_id) do nothing;

    -- Update user count
    update public.tenants set current_users = 1 where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_tenant_created on public.tenants;
create trigger trg_tenant_created
  after insert on public.tenants
  for each row execute function public.on_tenant_created();

-- Keep contact count accurate
create or replace function public.on_contact_change()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    update public.tenants set current_contacts = current_contacts + 1 where id = new.tenant_id;
  elsif tg_op = 'DELETE' then
    update public.tenants set current_contacts = greatest(0, current_contacts - 1) where id = old.tenant_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_contact_count on public.contacts;
create trigger trg_contact_count
  after insert or delete on public.contacts
  for each row execute function public.on_contact_change();

-- Keep deal count accurate
create or replace function public.on_deal_change()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    update public.tenants set current_deals = current_deals + 1 where id = new.tenant_id;
  elsif tg_op = 'DELETE' then
    update public.tenants set current_deals = greatest(0, current_deals - 1) where id = old.tenant_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_deal_count on public.deals;
create trigger trg_deal_count
  after insert or delete on public.deals
  for each row execute function public.on_deal_change();

-- ─────────────────────────────────────────────────────────────
-- 23. SEED: MAKE FIRST USER SUPER ADMIN
--     Run this manually after creating your account:
--     UPDATE public.users SET is_super_admin = true
--     WHERE email = 'you@yourcompany.com';
-- ─────────────────────────────────────────────────────────────
