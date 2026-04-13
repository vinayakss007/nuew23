-- ═══════════════════════════════════════════════════════════════
-- Migration 004: Schema Enhancement
-- What top CRMs (HubSpot, Salesforce, Pipedrive, Close.io) have
-- that we were missing — all in one migration
-- Run: psql $DATABASE_URL -f scripts/004_schema_enhancement.sql
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- 1. CONTACTS: 20 missing fields every serious CRM has
-- ─────────────────────────────────────────────────────────────
alter table public.contacts
  -- Professional
  add column if not exists job_title        text,
  add column if not exists department       text,
  -- Additional contact
  add column if not exists secondary_email  text,
  add column if not exists mobile_phone     text,
  add column if not exists work_phone       text,
  add column if not exists address_line1    text,
  add column if not exists address_line2    text,
  add column if not exists state            text,
  add column if not exists postal_code      text,
  -- Personal
  add column if not exists birthday         date,
  add column if not exists gender           text check (gender in ('male','female','other','prefer_not_to_say') or gender is null),
  -- Lifecycle & scoring
  add column if not exists lifecycle_stage  text default 'subscriber'
    check (lifecycle_stage in ('subscriber','lead','mql','sql','opportunity','customer','evangelist','other') or lifecycle_stage is null),
  add column if not exists last_activity_at timestamptz,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists times_contacted  integer default 0,
  add column if not exists do_not_contact  boolean default false,
  add column if not exists unsubscribed     boolean default false,
  -- Social
  add column if not exists facebook_url     text,
  add column if not exists instagram_url    text,
  -- Internal
  add column if not exists owner_notes      text;  -- private notes only visible to owner

create index if not exists contacts_lifecycle_idx on public.contacts(tenant_id, lifecycle_stage) where deleted_at is null;
create index if not exists contacts_last_activity_idx on public.contacts(tenant_id, last_activity_at desc) where deleted_at is null;

-- ─────────────────────────────────────────────────────────────
-- 2. COMPANIES: missing fields
-- ─────────────────────────────────────────────────────────────
alter table public.companies
  add column if not exists domain           text,
  add column if not exists industry         text,
  add column if not exists company_size     text check (company_size in ('1-10','11-50','51-200','201-500','501-1000','1001-5000','5000+') or company_size is null),
  add column if not exists annual_revenue   numeric(15,2),
  add column if not exists founded_year     integer,
  add column if not exists headquarters     text,
  add column if not exists description      text,
  add column if not exists linkedin_url     text,
  add column if not exists twitter_url      text,
  add column if not exists facebook_url     text,
  add column if not exists address_line1    text,
  add column if not exists city             text,
  add column if not exists state            text,
  add column if not exists country          text,
  add column if not exists postal_code      text,
  add column if not exists timezone         text,
  add column if not exists is_customer      boolean default false,
  add column if not exists last_activity_at timestamptz,
  add column if not exists tags             text[] default '{}',
  add column if not exists custom_fields    jsonb default '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────
-- 3. DEALS: missing fields
-- ─────────────────────────────────────────────────────────────
alter table public.deals
  add column if not exists description      text,
  add column if not exists lost_reason      text,
  add column if not exists pipeline_id      text default 'default',
  add column if not exists expected_revenue numeric(15,2),
  add column if not exists actual_revenue   numeric(15,2),
  add column if not exists currency         text default 'USD',
  add column if not exists tags             text[] default '{}';

-- ─────────────────────────────────────────────────────────────
-- 4. PRODUCTS (line items on deals — like Pipedrive/HubSpot)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.products (
  id            uuid primary key default uuid_generate_v4(),
  tenant_id     uuid references public.tenants on delete cascade not null,
  name          text not null,
  description   text,
  sku           text,
  price         numeric(15,2) default 0,
  currency      text default 'USD',
  unit          text default 'unit',   -- 'seat', 'month', 'license', etc.
  is_active     boolean default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists products_tenant_idx on public.products(tenant_id);

-- Deal line items
create table if not exists public.deal_products (
  id         uuid primary key default uuid_generate_v4(),
  deal_id    uuid references public.deals on delete cascade not null,
  product_id uuid references public.products on delete set null,
  name       text not null,           -- snapshot at time of adding
  price      numeric(15,2) not null,
  quantity   integer default 1,
  discount   numeric(5,2) default 0,  -- percent
  total      numeric(15,2) generated always as (price * quantity * (1 - discount/100)) stored,
  created_at timestamptz default now()
);
create index if not exists deal_products_deal_idx on public.deal_products(deal_id);

-- ─────────────────────────────────────────────────────────────
-- 5. PIPELINES (named pipelines — Pipedrive has these)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.pipelines (
  id         uuid primary key default uuid_generate_v4(),
  tenant_id  uuid references public.tenants on delete cascade not null,
  name       text not null,
  stages     jsonb not null default '[
    {"id":"lead","label":"Lead","order":0,"probability":10},
    {"id":"qualified","label":"Qualified","order":1,"probability":30},
    {"id":"proposal","label":"Proposal","order":2,"probability":60},
    {"id":"negotiation","label":"Negotiation","order":3,"probability":80},
    {"id":"won","label":"Won","order":4,"probability":100},
    {"id":"lost","label":"Lost","order":5,"probability":0}
  ]'::jsonb,
  is_default boolean default false,
  created_at timestamptz default now()
);
insert into public.pipelines (tenant_id, name, is_default)
  select id, 'Sales Pipeline', true from public.tenants on conflict do nothing;

-- ─────────────────────────────────────────────────────────────
-- 6. CUSTOM FIELD DEFINITIONS (like HubSpot's custom properties)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.custom_field_defs (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid references public.tenants on delete cascade not null,
  entity_type  text not null check (entity_type in ('contact','deal','company','task')),
  field_key    text not null,
  label        text not null,
  field_type   text not null check (field_type in ('text','number','date','boolean','select','multi_select','url','email','phone')),
  options      jsonb,              -- for select/multi_select
  is_required  boolean default false,
  sort_order   integer default 0,
  created_at   timestamptz default now(),
  unique (tenant_id, entity_type, field_key)
);
create index if not exists custom_field_defs_tenant_idx on public.custom_field_defs(tenant_id, entity_type);

-- ─────────────────────────────────────────────────────────────
-- 7. TAGS (centralised tag management)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.tags (
  id         uuid primary key default uuid_generate_v4(),
  tenant_id  uuid references public.tenants on delete cascade not null,
  name       text not null,
  color      text default '#7c3aed',
  entity_type text default 'contact',
  created_at timestamptz default now(),
  unique (tenant_id, name, entity_type)
);

-- ─────────────────────────────────────────────────────────────
-- 8. NOTES table (separate from activities — Salesforce model)
-- Currently notes live in activities. Add a dedicated table for
-- private/shared notes with pinning and rich-text support.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.notes (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid references public.tenants on delete cascade not null,
  user_id      uuid references public.users on delete set null,
  contact_id   uuid references public.contacts on delete cascade,
  deal_id      uuid references public.deals on delete cascade,
  company_id   uuid references public.companies on delete cascade,
  title        text,
  content      text not null,
  is_pinned    boolean default false,
  is_private   boolean default false,   -- only visible to note author
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
create index if not exists notes_contact_idx on public.notes(contact_id) where contact_id is not null;
create index if not exists notes_deal_idx    on public.notes(deal_id)    where deal_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 9. EMAIL LOG (track sent emails — HubSpot/Outreach style)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.email_log (
  id           uuid primary key default uuid_generate_v4(),
  tenant_id    uuid references public.tenants on delete cascade not null,
  user_id      uuid references public.users on delete set null,
  contact_id   uuid references public.contacts on delete set null,
  direction    text default 'outbound' check (direction in ('inbound','outbound')),
  subject      text,
  body_preview text,
  status       text default 'sent' check (status in ('queued','sent','delivered','opened','clicked','bounced','failed')),
  opened_at    timestamptz,
  clicked_at   timestamptz,
  sent_at      timestamptz default now(),
  metadata     jsonb default '{}'::jsonb
);
create index if not exists email_log_contact_idx on public.email_log(contact_id, sent_at desc);
create index if not exists email_log_tenant_idx  on public.email_log(tenant_id, sent_at desc);

-- ─────────────────────────────────────────────────────────────
-- 10. DB COUNTERS — triggers to keep current_contacts accurate
-- ─────────────────────────────────────────────────────────────
create or replace function public.update_tenant_contact_count()
returns trigger language plpgsql security definer as $$
begin
  if (TG_OP = 'INSERT' and NEW.deleted_at is null) then
    update public.tenants set current_contacts = current_contacts + 1 where id = NEW.tenant_id;
  elsif (TG_OP = 'UPDATE') then
    if (OLD.deleted_at is null and NEW.deleted_at is not null) then
      update public.tenants set current_contacts = greatest(0, current_contacts - 1) where id = NEW.tenant_id;
    elsif (OLD.deleted_at is not null and NEW.deleted_at is null) then
      update public.tenants set current_contacts = current_contacts + 1 where id = NEW.tenant_id;
    end if;
  elsif (TG_OP = 'DELETE') then
    if OLD.deleted_at is null then
      update public.tenants set current_contacts = greatest(0, current_contacts - 1) where id = OLD.tenant_id;
    end if;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists contacts_count_trigger on public.contacts;
create trigger contacts_count_trigger
  after insert or update or delete on public.contacts
  for each row execute function public.update_tenant_contact_count();

-- Same for deals
create or replace function public.update_tenant_deal_count()
returns trigger language plpgsql security definer as $$
begin
  if (TG_OP = 'INSERT' and NEW.deleted_at is null) then
    update public.tenants set current_deals = current_deals + 1 where id = NEW.tenant_id;
  elsif (TG_OP = 'UPDATE') then
    if (OLD.deleted_at is null and NEW.deleted_at is not null) then
      update public.tenants set current_deals = greatest(0, current_deals - 1) where id = NEW.tenant_id;
    elsif (OLD.deleted_at is not null and NEW.deleted_at is null) then
      update public.tenants set current_deals = current_deals + 1 where id = NEW.tenant_id;
    end if;
  end if;
  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists deals_count_trigger on public.deals;
create trigger deals_count_trigger
  after insert or update on public.deals
  for each row execute function public.update_tenant_deal_count();

-- Sync existing counts
update public.tenants t set
  current_contacts = (select count(*) from public.contacts c where c.tenant_id=t.id and c.deleted_at is null),
  current_deals    = (select count(*) from public.deals d where d.tenant_id=t.id and d.deleted_at is null);

-- ─────────────────────────────────────────────────────────────
-- 11. update_at trigger for all tables
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin NEW.updated_at = now(); return NEW; end; $$;

do $$ declare tbl text; begin
  foreach tbl in array array['contacts','deals','tasks','companies','meetings','notes','products'] loop
    execute format('drop trigger if exists set_updated_at_%I on public.%I', tbl, tbl);
    execute format('create trigger set_updated_at_%I before update on public.%I for each row execute function public.set_updated_at()', tbl, tbl);
  end loop;
end; $$;

commit;
