-- 001_base_schema.sql
-- Core NuCRM database schema — all essential tables
-- Safe to run multiple times (IF EXISTS/IF NOT EXISTS)

BEGIN;

-- ── Plans ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  price_cents int NOT NULL DEFAULT 0,
  max_users   int,
  max_contacts int,
  max_storage_mb int,
  features    jsonb DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.plans (name, slug, price_cents, max_users, max_contacts, features) VALUES
  ('Free',        'free',         0,  1,  100,  '["basic-crm","email-signatures"]'),
  ('Pro',         'pro',         2900, 5,  5000, '["basic-crm","pipelines","automations","email-signatures","reports"]'),
  ('Business',    'business',    7900, 15, 25000,'["basic-crm","pipelines","automations","email-signatures","reports","ai-insights","api-access"]'),
  ('Enterprise',  'enterprise', 19900, null, null,'["basic-crm","pipelines","automations","email-signatures","reports","ai-insights","api-access","sso","dedicated-support"]')
ON CONFLICT (slug) DO NOTHING;

-- ── Users ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  full_name       text NOT NULL DEFAULT '',
  avatar_url      text,
  is_super_admin  boolean NOT NULL DEFAULT false,
  email_verified  boolean NOT NULL DEFAULT false,
  totp_enabled    boolean NOT NULL DEFAULT false,
  totp_secret     text,
  totp_backup_codes jsonb DEFAULT '[]',
  last_tenant_id  uuid,
  phone           text,
  timezone        text DEFAULT 'UTC',
  locale          text DEFAULT 'en',
  theme           text DEFAULT 'light',
  telegram_bot_token text,
  telegram_chat_id text,
  telegram_enabled boolean DEFAULT false,
  telegram_notify_login boolean DEFAULT true,
  telegram_notify_signup boolean DEFAULT true,
  telegram_notify_password_change boolean DEFAULT true,
  telegram_notify_2fa_change boolean DEFAULT true,
  telegram_notify_security_alerts boolean DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- ── Tenants (Organizations/Workspaces) ─────────────────
CREATE TABLE IF NOT EXISTS public.tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  owner_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id     uuid REFERENCES public.plans(id),
  status      text NOT NULL DEFAULT 'trialing',
  trial_ends_at timestamptz,
  primary_color text DEFAULT '#7c3aed',
  logo_url    text,
  settings    jsonb DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- ── Roles ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  description text,
  permissions jsonb DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, slug)
);

-- Default roles for each tenant
CREATE OR REPLACE FUNCTION public.create_default_roles()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.roles (tenant_id, name, slug, description, permissions) VALUES
    (NEW.id, 'Admin',     'admin',  'Full access',           '{"all": true}'),
    (NEW.id, 'Manager',   'manager','Manage team & reports', '{"reports.view":true,"contacts.manage":true,"leads.manage":true,"deals.manage":true}'),
    (NEW.id, 'Sales Rep', 'sales',  'Manage own deals',      '{"contacts.view":true,"leads.view":true,"deals.own":true}'),
    (NEW.id, 'Viewer',    'viewer', 'Read only',             '{"reports.view":true}');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_create_default_roles ON public.tenants;
CREATE TRIGGER trg_create_default_roles
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.create_default_roles();

-- ── Tenant Members ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_slug   text NOT NULL DEFAULT 'viewer',
  role_id     uuid REFERENCES public.roles(id),
  status      text NOT NULL DEFAULT 'active',
  joined_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);

-- ── Sessions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,
  ip_address  text,
  user_agent  text,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_token ON public.sessions(token_hash);
CREATE INDEX idx_sessions_user ON public.sessions(user_id);

-- ── Password Resets ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Email Verifications ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Invitations ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role_slug   text NOT NULL DEFAULT 'viewer',
  token       text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  invited_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Contacts ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  first_name  text NOT NULL DEFAULT '',
  last_name   text NOT NULL DEFAULT '',
  email       text,
  phone       text,
  mobile      text,
  title       text,
  company_id  uuid,
  assigned_to uuid REFERENCES public.users(id),
  lead_status text DEFAULT 'new',
  lead_source text,
  lifecycle_stage text DEFAULT 'contact',
  notes       text,
  tags        jsonb DEFAULT '[]',
  score       int DEFAULT 0,
  city        text,
  country     text,
  website     text,
  linkedin_url text,
  twitter_url text,
  custom_fields jsonb DEFAULT '{}',
  is_archived boolean DEFAULT false,
  created_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX idx_contacts_tenant ON public.contacts(tenant_id);
CREATE INDEX idx_contacts_email ON public.contacts(email);
CREATE UNIQUE INDEX idx_contacts_tenant_email_unique ON public.contacts(tenant_id, email)
  WHERE email IS NOT NULL AND deleted_at IS NULL AND is_archived = false;

-- ── Leads ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  first_name  text NOT NULL DEFAULT '',
  last_name   text,
  email       text,
  phone       text,
  mobile      text,
  title       text,
  company_name text,
  lead_source text DEFAULT 'api',
  lead_status text DEFAULT 'new',
  lifecycle_stage text DEFAULT 'lead',
  assigned_to uuid REFERENCES public.users(id),
  owner_id    uuid REFERENCES public.users(id),
  created_by  uuid REFERENCES public.users(id),
  tags        jsonb DEFAULT '[]',
  notes       text,
  custom_fields jsonb DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX idx_leads_tenant ON public.leads(tenant_id);
CREATE INDEX idx_leads_status ON public.leads(lead_status);
CREATE UNIQUE INDEX idx_leads_tenant_email_unique ON public.leads(tenant_id, lower(email))
  WHERE email IS NOT NULL AND deleted_at IS NULL;

-- ── Companies ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  industry    text,
  size        text,
  website     text,
  phone       text,
  address     text,
  notes       text,
  custom_fields jsonb DEFAULT '{}',
  created_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_companies_tenant ON public.companies(tenant_id);

-- ── Deals / Pipelines ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deal_stages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  stage_order int NOT NULL DEFAULT 0,
  probability int NOT NULL DEFAULT 10,
  color       text DEFAULT '#6b7280',
  UNIQUE(tenant_id, name)
);

CREATE OR REPLACE FUNCTION public.create_default_deal_stages()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.deal_stages (tenant_id, name, stage_order, probability) VALUES
    (NEW.id, 'Lead',     0, 10),
    (NEW.id, 'Qualified', 1, 20),
    (NEW.id, 'Proposal',  2, 50),
    (NEW.id, 'Negotiation', 3, 75),
    (NEW.id, 'Won',       4, 100),
    (NEW.id, 'Lost',      5, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_create_default_stages ON public.tenants;
CREATE TRIGGER trg_create_default_stages
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.create_default_deal_stages();

CREATE TABLE IF NOT EXISTS public.deals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title       text NOT NULL,
  value       numeric(12,2) DEFAULT 0,
  stage       text DEFAULT 'lead',
  stage_id    uuid REFERENCES public.deal_stages(id),
  probability int DEFAULT 10,
  close_date  date,
  contact_id  uuid REFERENCES public.contacts(id),
  company_id  uuid REFERENCES public.companies(id),
  assigned_to uuid REFERENCES public.users(id),
  notes       text,
  custom_fields jsonb DEFAULT '{}',
  created_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX idx_deals_tenant ON public.deals(tenant_id);
CREATE INDEX idx_deals_stage ON public.deals(stage);

-- ── Tasks ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  due_date    timestamptz,
  priority    text DEFAULT 'medium',
  contact_id  uuid REFERENCES public.contacts(id),
  deal_id     uuid REFERENCES public.deals(id),
  assigned_to uuid REFERENCES public.users(id),
  completed   boolean DEFAULT false,
  completed_at timestamptz,
  created_by  uuid REFERENCES public.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);
CREATE INDEX idx_tasks_tenant ON public.tasks(tenant_id);
CREATE INDEX idx_tasks_assigned ON public.tasks(assigned_to);

-- ── Activities / Timeline ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.activities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES public.users(id),
  entity_type text NOT NULL,
  entity_id   uuid NOT NULL,
  action      text NOT NULL,
  details     jsonb DEFAULT '{}',
  ip_address  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_activities_tenant ON public.activities(tenant_id);
CREATE INDEX idx_activities_entity ON public.activities(entity_type, entity_id);
CREATE INDEX idx_activities_created ON public.activities(created_at DESC);

-- ── Notifications ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  metadata    jsonb DEFAULT '{}',
  is_read     boolean DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON public.notifications(user_id, is_read);
CREATE INDEX idx_notifications_tenant ON public.notifications(tenant_id);

-- ── Tags ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text DEFAULT '#6b7280',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

-- ── Audit Log ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid,
  user_id     uuid,
  action      text NOT NULL,
  entity_type text,
  entity_id   uuid,
  details     jsonb DEFAULT '{}',
  ip_address  text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant ON public.audit_logs(tenant_id);
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);

-- ── Webhooks ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.webhooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  url         text NOT NULL,
  secret      text,
  events      jsonb NOT NULL DEFAULT '[]',
  is_active   boolean DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.webhook_inbound_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  api_key_id  uuid,
  action      text,
  entity      text,
  status      text,
  status_code int,
  error_message text,
  record_id   uuid,
  payload_size int,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── API Keys ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  key_hash    text NOT NULL UNIQUE,
  key_prefix  text NOT NULL,
  name        text NOT NULL DEFAULT '',
  scopes      jsonb NOT NULL DEFAULT '[]',
  is_active   boolean DEFAULT true,
  expires_at  timestamptz,
  last_used_at timestamptz,
  last_used_ip text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_keys_tenant ON public.api_keys(tenant_id);

-- ── Onboarding Progress ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  steps_done  jsonb DEFAULT '{}',
  completed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Subscriptions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  plan_id     uuid NOT NULL REFERENCES public.plans(id),
  stripe_subscription_id text,
  stripe_customer_id text,
  status      text NOT NULL DEFAULT 'trialing',
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── Email Tracking ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_tracking (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id  uuid,
  recipient   text NOT NULL,
  subject     text,
  sequence_enrollment_id uuid,
  opened_at   timestamptz,
  clicked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;
