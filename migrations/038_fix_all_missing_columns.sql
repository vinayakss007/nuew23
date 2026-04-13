-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — PERMANENT FIX: All Missing Columns & Tables
-- Purpose: Fix ALL contacts, leads, automations, meetings errors
-- Date: April 2026
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. CONTACTS — Add ALL missing columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS do_not_contact boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifecycle_stage text DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS search_vector tsvector,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- Update existing rows
UPDATE public.contacts SET do_not_contact = false WHERE do_not_contact IS NULL;
UPDATE public.contacts SET score = 0 WHERE score IS NULL;
UPDATE public.contacts SET lifecycle_stage = 'lead' WHERE lifecycle_stage IS NULL;
UPDATE public.contacts SET metadata = '{}'::jsonb WHERE metadata IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 2. LEADS — Add ALL missing columns  
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS company_size text,
  ADD COLUMN IF NOT EXISTS company_industry text,
  ADD COLUMN IF NOT EXISTS company_website text,
  ADD COLUMN IF NOT EXISTS company_annual_revenue numeric,
  ADD COLUMN IF NOT EXISTS lead_status_changed_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS score_previous integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget numeric,
  ADD COLUMN IF NOT EXISTS budget_currency text DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS authority_level text DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS need_description text,
  ADD COLUMN IF NOT EXISTS timeline text,
  ADD COLUMN IF NOT EXISTS timeline_target_date date,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS twitter_handle text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS internal_notes text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS search_vector tsvector,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS do_not_contact boolean DEFAULT false;

-- Update existing rows
UPDATE public.leads SET score = 0 WHERE score IS NULL;
UPDATE public.leads SET score_previous = 0 WHERE score_previous IS NULL;
UPDATE public.leads SET do_not_contact = false WHERE do_not_contact IS NULL;
UPDATE public.leads SET metadata = '{}'::jsonb WHERE metadata IS NULL;
UPDATE public.leads SET authority_level = 'unknown' WHERE authority_level IS NULL;
UPDATE public.leads SET budget_currency = 'USD' WHERE budget_currency IS NULL;
UPDATE public.leads SET lead_status_changed_at = now() WHERE lead_status_changed_at IS NULL;

-- Generate full_name for existing leads
UPDATE public.leads SET full_name = trim(first_name || ' ' || COALESCE(last_name, '')) WHERE full_name IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 3. COMPANIES — Add missing columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.users(id);

UPDATE public.companies SET status = 'active' WHERE status IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 4. TASKS — Add missing columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES public.deals(id),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

UPDATE public.tasks SET status = 'pending' WHERE status IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 5. DEALS — Add missing columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS contact_name text;

-- ═══════════════════════════════════════════════════════════════════
-- 6. PLANS — Add missing columns (for billing/tenant context)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS max_deals integer,
  ADD COLUMN IF NOT EXISTS max_automations integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS max_forms integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_api_calls_day integer DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS max_storage_gb integer,
  ADD COLUMN IF NOT EXISTS price integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_monthly integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_yearly integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description text;

UPDATE public.plans SET max_deals = 100 WHERE max_deals IS NULL;
UPDATE public.plans SET max_automations = 5 WHERE max_automations IS NULL;
UPDATE public.plans SET max_forms = 3 WHERE max_forms IS NULL;
UPDATE public.plans SET max_api_calls_day = 1000 WHERE max_api_calls_day IS NULL;
UPDATE public.plans SET is_active = true WHERE is_active IS NULL;
UPDATE public.plans SET price_monthly = price_cents WHERE price_monthly = 0 AND price_cents > 0;
UPDATE public.plans SET price = price_cents WHERE price = 0;
UPDATE public.plans SET sort_order = CASE slug WHEN 'free' THEN 0 WHEN 'pro' THEN 1 WHEN 'business' THEN 2 WHEN 'enterprise' THEN 3 ELSE 4 END WHERE sort_order = 0;

-- ═══════════════════════════════════════════════════════════════════
-- 7. TENANTS — Add missing columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS current_contacts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_data jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS domain text;

UPDATE public.tenants SET current_contacts = 0 WHERE current_contacts IS NULL;
UPDATE public.tenants SET usage_data = '{}'::jsonb WHERE usage_data IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 8. AUTOMATIONS TABLE — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  trigger_type text NOT NULL DEFAULT 'event',
  trigger_config jsonb DEFAULT '{}',
  actions jsonb NOT NULL DEFAULT '[]',
  conditions jsonb DEFAULT '{}',
  run_count integer DEFAULT 0,
  last_run_at timestamptz,
  last_error text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automations_tenant ON public.automations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_automations_active ON public.automations(tenant_id, is_active) WHERE is_active = true;

-- ═══════════════════════════════════════════════════════════════════
-- 9. AUTOMATION_WORKFLOWS TABLE — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.automation_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  workflow_id uuid,
  name text NOT NULL,
  description text,
  enabled boolean DEFAULT true,
  config jsonb DEFAULT '{}',
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automation_workflows_tenant ON public.automation_workflows(tenant_id);

-- ═══════════════════════════════════════════════════════════════════
-- 10. AUTOMATION_RUNS TABLE — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES public.automations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  trigger_event text,
  trigger_data jsonb DEFAULT '{}',
  result jsonb DEFAULT '{}',
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_automation_runs_tenant ON public.automation_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON public.automation_runs(status);

-- ═══════════════════════════════════════════════════════════════════
-- 11. MEETINGS TABLE — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  contact_id uuid REFERENCES public.contacts(id),
  deal_id uuid REFERENCES public.deals(id),
  host_id uuid NOT NULL REFERENCES public.users(id),
  attendee_emails jsonb DEFAULT '[]',
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  meeting_url text,
  meeting_provider text DEFAULT 'zoom',
  meeting_id text,
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_meetings_tenant ON public.meetings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_meetings_contact ON public.meetings(contact_id);
CREATE INDEX IF NOT EXISTS idx_meetings_host ON public.meetings(host_id);
CREATE INDEX IF NOT EXISTS idx_meetings_start ON public.meetings(start_time DESC);

-- ═══════════════════════════════════════════════════════════════════
-- 12. LEAD_ACTIVITIES TABLE — Fix tenant_id constraint
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id),
  activity_type text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_activities_tenant ON public.lead_activities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON public.lead_activities(lead_id);

-- ═══════════════════════════════════════════════════════════════════
-- 13. DASHBOARDS TABLE — Create with nullable tenant_id for system
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  layout jsonb DEFAULT '{}',
  widgets jsonb DEFAULT '[]',
  is_default boolean DEFAULT false,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dashboards_tenant ON public.dashboards(tenant_id);

-- ═══════════════════════════════════════════════════════════════════
-- 14. FORMS TABLE — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  fields jsonb NOT NULL DEFAULT '[]',
  settings jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  submissions_count integer DEFAULT 0,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_forms_tenant ON public.forms(tenant_id);

-- ═══════════════════════════════════════════════════════════════════
-- 15. CONTACT TAGS / LEAD TAGS — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contact_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contact_id, tag_id)
);

CREATE TABLE IF NOT EXISTS public.lead_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id, tag_id)
);

-- ═══════════════════════════════════════════════════════════════════
-- 16. PIPELINE STAGES — Create if missing (alias for deal_stages)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  stage_order int NOT NULL DEFAULT 0,
  probability int NOT NULL DEFAULT 10,
  color text DEFAULT '#6b7280',
  UNIQUE(tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_pipeline_stages_tenant ON public.pipeline_stages(tenant_id);

-- ═══════════════════════════════════════════════════════════════════
-- 17. REFRESH TOKENS TABLE — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON public.refresh_tokens(user_id);

-- ═══════════════════════════════════════════════════════════════════
-- 18. CUSTOM FIELDS TABLE — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  name text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  options jsonb DEFAULT '[]',
  required boolean DEFAULT false,
  sort_order int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, entity_type, name)
);
CREATE INDEX IF NOT EXISTS idx_custom_fields_tenant ON public.custom_fields(tenant_id);

COMMIT;
