-- Migration: 025_leads_management.sql
-- Purpose: Create dedicated leads table with international standard CRM features
-- Date: April 2, 2026

-- ─────────────────────────────────────────────────────────────────────
-- 1. CREATE DEDICATED LEADS TABLE
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  
  -- Basic Information
  first_name text NOT NULL,
  last_name text,
  full_name text GENERATED ALWAYS AS (trim(first_name || ' ' || last_name)) STORED,
  email text,
  phone text,
  mobile text,
  title text, -- Job title
  department text,
  
  -- Company Information (for leads without a company record)
  company_name text,
  company_size text, -- '1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'
  company_industry text,
  company_website text,
  company_annual_revenue numeric,
  
  -- Lead Specific Fields
  lead_source text DEFAULT 'website',
  lead_status text DEFAULT 'new' CHECK (lead_status IN (
    'new', 'contacted', 'qualified', 'unqualified', 
    'converted', 'lost', 'nurturing'
  )),
  lead_status_changed_at timestamptz DEFAULT now(),
  
  -- Lead Scoring (0-100)
  score integer DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  score_previous integer DEFAULT 0,
  
  -- Qualification (BANT Framework)
  budget numeric,
  budget_currency text DEFAULT 'USD',
  authority_level text CHECK (authority_level IN ('decision_maker', 'influencer', 'user', 'unknown')),
  need_description text,
  timeline text, -- 'immediate', '1-3 months', '3-6 months', '6-12 months', '12+ months'
  timeline_target_date date,
  
  -- Lifecycle Stage (broader than lead_status)
  lifecycle_stage text DEFAULT 'lead' CHECK (lifecycle_stage IN (
    'visitor', 'lead', 'marketing_qualified_lead', 'sales_qualified_lead',
    'opportunity', 'customer', 'evangelist'
  )),
  
  -- Assignment & Ownership
  assigned_to uuid REFERENCES public.users(id),
  created_by uuid REFERENCES public.users(id),
  owner_id uuid REFERENCES public.users(id),
  
  -- Geographic Information
  country text,
  state text,
  city text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  timezone text,
  
  -- Social Media & Online Presence
  linkedin_url text,
  twitter_handle text,
  facebook_url text,
  website text,
  
  -- Lead Origin & Tracking
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referring_url text,
  landing_page text,
  form_id text,
  
  -- Engagement Tracking
  last_activity_at timestamptz,
  last_contacted_at timestamptz,
  email_opened_count integer DEFAULT 0,
  email_clicked_count integer DEFAULT 0,
  page_views_count integer DEFAULT 0,
  form_submissions_count integer DEFAULT 0,
  
  -- Conversion Information
  converted_at timestamptz,
  converted_to_contact_id uuid REFERENCES public.contacts(id),
  conversion_source text,
  
  -- Loss Information (for lost leads)
  lost_reason text,
  lost_at timestamptz,
  lost_to_competitor text,
  
  -- Additional Fields
  tags text[] DEFAULT '{}',
  custom_fields jsonb DEFAULT '{}',
  notes text,
  internal_notes text,
  
  -- Soft Delete
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  
  -- Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────
-- 2. CREATE INDEXES FOR PERFORMANCE
-- ─────────────────────────────────────────────────────────────────────

-- Tenant isolation
CREATE INDEX IF NOT EXISTS leads_tenant_idx ON public.leads(tenant_id) WHERE deleted_at IS NULL;

-- Lead status for pipeline views
CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads(tenant_id, lead_status) WHERE deleted_at IS NULL;

-- Assignment for team members
CREATE INDEX IF NOT EXISTS leads_assigned_idx ON public.leads(tenant_id, assigned_to) WHERE deleted_at IS NULL;

-- Lead scoring for prioritization
CREATE INDEX IF NOT EXISTS leads_score_idx ON public.leads(tenant_id, score DESC) WHERE deleted_at IS NULL;

-- Lifecycle stage
CREATE INDEX IF NOT EXISTS leads_lifecycle_idx ON public.leads(tenant_id, lifecycle_stage) WHERE deleted_at IS NULL;

-- Created date for sorting
CREATE INDEX IF NOT EXISTS leads_created_idx ON public.leads(tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- Last activity for engagement tracking
CREATE INDEX IF NOT EXISTS leads_activity_idx ON public.leads(tenant_id, last_activity_at DESC NULLS LAST) WHERE deleted_at IS NULL;

-- Email lookup (case-insensitive)
CREATE INDEX IF NOT EXISTS leads_email_idx ON public.leads(tenant_id, lower(email)) WHERE deleted_at IS NULL AND email IS NOT NULL;

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS leads_pipeline_idx ON public.leads(tenant_id, lead_status, score DESC, created_at DESC) WHERE deleted_at IS NULL;

-- Full-text search index
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS leads_search_idx ON public.leads USING GIN(search_vector) WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3. CREATE TRIGGERS FOR AUTO-UPDATES
-- ─────────────────────────────────────────────────────────────────────

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at_trigger
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION update_leads_updated_at();

-- Auto-update search vector
CREATE OR REPLACE FUNCTION update_leads_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := 
    setweight(to_tsvector('english', coalesce(NEW.first_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.last_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.email, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.company_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.city, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.country, '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_search_vector_trigger
  BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION update_leads_search_vector();

-- Auto-update lead_status_changed_at when status changes
CREATE OR REPLACE FUNCTION update_lead_status_changed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.lead_status IS DISTINCT FROM NEW.lead_status THEN
    NEW.lead_status_changed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_status_changed_at_trigger
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION update_lead_status_changed_at();

-- ─────────────────────────────────────────────────────────────────────
-- 4. CREATE LEAD SCORING RULES TABLE
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lead_scoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  rule_type text NOT NULL CHECK (rule_type IN (
    'demographic', 'behavioral', 'engagement', 'qualification', 'custom'
  )),
  field_name text NOT NULL,
  operator text NOT NULL CHECK (operator IN (
    'equals', 'not_equals', 'contains', 'starts_with', 'ends_with',
    'greater_than', 'less_than', 'is_empty', 'is_not_empty', 'in'
  )),
  field_value text,
  score_change integer NOT NULL,
  active boolean DEFAULT true,
  priority integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS lead_scoring_rules_tenant_idx ON public.lead_scoring_rules(tenant_id, active);

-- ─────────────────────────────────────────────────────────────────────
-- 5. CREATE LEAD ACTIVITY TIMELINE TABLE
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id),
  
  activity_type text NOT NULL CHECK (activity_type IN (
    'email_sent', 'email_opened', 'email_clicked',
    'page_view', 'form_submission', 'file_download',
    'call', 'meeting', 'note', 'task_completed',
    'status_change', 'score_change', 'assignment_change',
    'custom'
  )),
  
  activity_data jsonb DEFAULT '{}',
  description text,
  performed_by uuid REFERENCES public.users(id),
  performed_at timestamptz DEFAULT now(),
  
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_activities_lead_idx ON public.lead_activities(lead_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS lead_activities_tenant_idx ON public.lead_activities(tenant_id, performed_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 6. ADD COMMENTS FOR DOCUMENTATION
-- ─────────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.leads IS 'Dedicated leads table for pre-contact prospect management (international CRM standard)';
COMMENT ON COLUMN public.leads.lead_status IS 'Current stage in the sales pipeline';
COMMENT ON COLUMN public.leads.lifecycle_stage IS 'Overall relationship stage with the organization';
COMMENT ON COLUMN public.leads.score IS 'Lead score (0-100) based on demographic and behavioral factors';
COMMENT ON COLUMN public.leads.budget IS 'Available budget for the solution (BANT qualification)';
COMMENT ON COLUMN public.leads.authority_level IS 'Decision-making authority level (BANT qualification)';
COMMENT ON COLUMN public.leads.need_description IS 'Description of business need or pain point (BANT qualification)';
COMMENT ON COLUMN public.leads.timeline IS 'Expected timeframe for purchase decision (BANT qualification)';
COMMENT ON COLUMN public.leads.utm_source IS 'Marketing campaign source attribution';
COMMENT ON COLUMN public.leads.converted_to_contact_id IS 'Reference to contact record after conversion';

-- ─────────────────────────────────────────────────────────────────────
-- 7. INSERT DEFAULT LEAD SCORING RULES
-- ─────────────────────────────────────────────────────────────────────

-- These will be inserted per-tenant via application logic
-- Example rules structure:
-- Demographic: Job title contains 'CEO' or 'Founder' = +20 points
-- Demographic: Company size > 200 employees = +15 points
-- Behavioral: Visited pricing page = +10 points
-- Behavioral: Downloaded whitepaper = +15 points
-- Engagement: Opened 3+ emails = +10 points
-- Engagement: Clicked email link = +5 points

-- ─────────────────────────────────────────────────────────────────────
-- 8. CREATE ROW LEVEL SECURITY POLICIES
-- ─────────────────────────────────────────────────────────────────────

-- Enable RLS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policy
CREATE POLICY leads_tenant_isolation ON public.leads
  USING (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- User assignment policy (users can see their assigned leads)
CREATE POLICY leads_user_assignment ON public.leads
  FOR SELECT
  USING (
    assigned_to = current_setting('app.current_user')::uuid
    OR created_by = current_setting('app.current_user')::uuid
    OR current_setting('app.current_role')::text IN ('admin', 'manager', 'owner')
  );

-- ─────────────────────────────────────────────────────────────────────
-- 9. CREATE VIEWS FOR COMMON QUERIES
-- ─────────────────────────────────────────────────────────────────────

-- Hot leads view (high score, recent activity)
CREATE OR REPLACE VIEW public.hot_leads AS
SELECT *
FROM public.leads
WHERE deleted_at IS NULL
  AND score >= 70
  AND (last_activity_at IS NULL OR last_activity_at > now() - interval '7 days')
ORDER BY score DESC, last_activity_at DESC NULLS LAST;

-- New leads today
CREATE OR REPLACE VIEW public.leads_today AS
SELECT *
FROM public.leads
WHERE deleted_at IS NULL
  AND created_at >= date_trunc('day', now())
ORDER BY created_at DESC;

-- Unassigned leads
CREATE OR REPLACE VIEW public.unassigned_leads AS
SELECT *
FROM public.leads
WHERE deleted_at IS NULL
  AND assigned_to IS NULL
ORDER BY created_at DESC;

-- Leads needing follow-up (contacted but no activity in 3 days)
CREATE OR REPLACE VIEW public.leads_needing_followup AS
SELECT *
FROM public.leads
WHERE deleted_at IS NULL
  AND lead_status IN ('new', 'contacted', 'qualified')
  AND (last_activity_at IS NULL OR last_activity_at < now() - interval '3 days')
ORDER BY last_activity_at ASC NULLS FIRST;

-- ─────────────────────────────────────────────────────────────────────
-- 10. MIGRATION NOTES
-- ─────────────────────────────────────────────────────────────────────

-- This migration creates a dedicated leads table following international CRM standards:
-- - Separate from contacts (leads are pre-qualification, contacts are post-qualification)
-- - BANT qualification framework (Budget, Authority, Need, Timeline)
-- - Lead scoring system (0-100 scale)
-- - Comprehensive tracking (UTM parameters, activities, engagement)
-- - Conversion path (leads convert to contacts when qualified)
-- - Soft delete support
-- - Full RLS security

-- To migrate existing data from contacts table:
-- INSERT INTO public.leads (tenant_id, first_name, last_name, email, phone, lead_status, lead_source, score, assigned_to, created_at)
-- SELECT tenant_id, first_name, last_name, email, phone, lead_status, lead_source, score, assigned_to, created_at
-- FROM public.contacts
-- WHERE lead_status IN ('new', 'contacted', 'qualified', 'unqualified', 'lost')
-- AND deleted_at IS NULL;
