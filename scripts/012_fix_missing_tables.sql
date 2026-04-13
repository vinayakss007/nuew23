-- Fix all missing tables referenced in active app code
-- Run this after existing migrations

-- ==========================================
-- contact_emails table (referenced in API v1 routes but no migration exists)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.contact_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  email_type text NOT NULL DEFAULT 'primary',
  is_primary boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT contact_emails_type_check CHECK (email_type IN ('primary', 'personal', 'work', 'billing', 'other'))
);
CREATE INDEX idx_contact_emails_contact ON public.contact_emails(tenant_id, contact_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_contact_emails_email ON public.contact_emails(tenant_id, email) WHERE deleted_at IS NULL;

-- ==========================================
-- failed_webhooks table (referenced in lib/webhooks.ts but no migration exists)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.failed_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  url text NOT NULL,
  method text NOT NULL DEFAULT 'POST',
  status_code integer,
  error_message text,
  response_body text,
  retry_count integer NOT NULL DEFAULT 0,
  max_retries integer NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_failed_webhooks_tenant ON public.failed_webhooks(tenant_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_failed_webhooks_retry ON public.failed_webhooks(next_retry_at) WHERE next_retry_at IS NOT NULL AND resolved_at IS NULL;

-- ==========================================
-- Fix webhook_deliveries table to match code expectations
-- ==========================================
ALTER TABLE public.webhook_deliveries 
  ADD COLUMN IF NOT EXISTS webhook_id uuid REFERENCES public.integrations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'POST',
  ADD COLUMN IF NOT EXISTS headers jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_idx ON public.webhook_deliveries(webhook_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx ON public.webhook_deliveries(status, next_retry_at) WHERE status = 'pending';

-- ==========================================
-- leads table was a view - create proper table instead
-- ==========================================
-- First drop the view we created earlier
DROP VIEW IF EXISTS public.leads CASCADE;

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  first_name text NOT NULL,
  last_name text NOT NULL DEFAULT '',
  email text,
  phone text,
  title text,
  company_name text,
  website text,
  address text,
  city text,
  state text,
  country text,
  postal_code text,
  lead_source text,
  lead_status text NOT NULL DEFAULT 'new',
  score integer NOT NULL DEFAULT 0,
  notes text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  tags text[] NOT NULL DEFAULT '{}',
  is_archived boolean NOT NULL DEFAULT false,
  is_converted boolean NOT NULL DEFAULT false,
  converted_at timestamptz,
  converted_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT leads_lead_status_check CHECK (lead_status IN ('new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost'))
);
CREATE INDEX idx_leads_tenant ON public.leads(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_tenant_status ON public.leads(tenant_id, lead_status) WHERE deleted_at IS NULL AND is_archived = false;
CREATE INDEX idx_leads_email ON public.leads(tenant_id, email) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_assigned ON public.leads(tenant_id, assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_created ON public.leads(tenant_id, created_at DESC) WHERE deleted_at IS NULL AND is_archived = false;
CREATE TRIGGER set_updated_at_leads BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- lead_scoring_rules table (referenced in active code)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.lead_scoring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  field text NOT NULL,
  operator text NOT NULL,
  value text,
  score integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_scoring_rules_operator_check CHECK (operator IN ('equals', 'contains', 'starts_with', 'ends_with', 'gt', 'lt', 'gte', 'lte', 'is_empty', 'is_not_empty'))
);
CREATE INDEX idx_lead_scoring_rules_tenant ON public.lead_scoring_rules(tenant_id) WHERE is_active = true;

-- ==========================================
-- lead_activities table (referenced in active code)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  activity_type text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lead_activities_lead ON public.lead_activities(tenant_id, lead_id);
CREATE INDEX idx_lead_activities_type ON public.lead_activities(tenant_id, activity_type);

-- ==========================================
-- api_key_usage table (referenced in migrations but not applied)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.api_key_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ip_address inet,
  user_agent text,
  method text,
  path text,
  status_code integer,
  response_time_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_api_key_usage_key ON public.api_key_usage(api_key_id, created_at DESC);
CREATE INDEX idx_api_key_usage_tenant ON public.api_key_usage(tenant_id, created_at DESC);

-- ==========================================
-- sequence_steps table (email sequences)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.sequences(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  step_number integer NOT NULL,
  step_type text NOT NULL DEFAULT 'email',
  subject text,
  body text,
  delay_hours integer NOT NULL DEFAULT 0,
  delay_minutes integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sequence_steps_type_check CHECK (step_type IN ('email', 'task', 'wait'))
);
CREATE INDEX idx_sequence_steps_sequence ON public.sequence_steps(sequence_id, step_number);

-- ==========================================
-- sequence_step_logs table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.sequence_step_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL REFERENCES public.sequence_enrollments(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz,
  executed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sequence_step_logs_status_check CHECK (status IN ('pending', 'sent', 'skipped', 'failed', 'cancelled'))
);
CREATE INDEX idx_sequence_step_logs_enrollment ON public.sequence_step_logs(enrollment_id);
CREATE INDEX idx_sequence_step_logs_scheduled ON public.sequence_step_logs(scheduled_at) WHERE status = 'pending';

-- ==========================================
-- workflows table (workflow builder)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL DEFAULT 'manual',
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT workflows_trigger_type_check CHECK (trigger_type IN ('manual', 'schedule', 'event', 'webhook'))
);
CREATE INDEX idx_workflows_tenant ON public.workflows(tenant_id) WHERE deleted_at IS NULL AND is_active = true;
CREATE TRIGGER set_updated_at_workflows BEFORE UPDATE ON public.workflows FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- workflow_actions table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.workflow_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  condition_config jsonb,
  order_index integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_workflow_actions_workflow ON public.workflow_actions(workflow_id, order_index);

-- ==========================================
-- workflow_execution_logs table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.workflow_execution_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'running',
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_execution_logs_status_check CHECK (status IN ('running', 'completed', 'failed', 'cancelled'))
);
CREATE INDEX idx_workflow_execution_workflow ON public.workflow_execution_logs(workflow_id, started_at DESC);

-- ==========================================
-- workflow_action_logs table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.workflow_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.workflow_execution_logs(id) ON DELETE CASCADE,
  action_id uuid REFERENCES public.workflow_actions(id) ON DELETE SET NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  error_message text,
  result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_action_logs_status_check CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped'))
);
CREATE INDEX idx_workflow_action_logs_execution ON public.workflow_action_logs(execution_id);

-- ==========================================
-- ai_insights table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.ai_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  insight_type text NOT NULL,
  insight jsonb NOT NULL,
  confidence_score numeric(5,4),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_insights_entity ON public.ai_insights(tenant_id, entity_type, entity_id);
CREATE INDEX idx_ai_insights_expires ON public.ai_insights(expires_at) WHERE expires_at IS NOT NULL;

-- ==========================================
-- ai_usage_logs table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  feature text NOT NULL,
  tokens_used integer,
  cost_cents numeric(10,4),
  response_time_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_usage_logs_tenant ON public.ai_usage_logs(tenant_id, created_at DESC);
CREATE INDEX idx_ai_usage_logs_feature ON public.ai_usage_logs(tenant_id, feature, created_at DESC);

-- ==========================================
-- ai_email_drafts table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.ai_email_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  subject text,
  body text,
  model_used text,
  tokens_used integer,
  is_sent boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_email_drafts_user ON public.ai_email_drafts(tenant_id, user_id, created_at DESC);

-- ==========================================
-- contact_scores table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.contact_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  score_type text NOT NULL DEFAULT 'engagement',
  score integer NOT NULL DEFAULT 0,
  max_score integer NOT NULL DEFAULT 100,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_scores_type_check CHECK (score_type IN ('engagement', 'fit', 'predictive', 'custom'))
);
CREATE INDEX idx_contact_scores_contact ON public.contact_scores(contact_id, score_type);
CREATE INDEX idx_contact_scores_tenant ON public.contact_scores(tenant_id, score DESC);

-- ==========================================
-- contact_lifecycle_history table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.contact_lifecycle_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contact_lifecycle_contact ON public.contact_lifecycle_history(contact_id, created_at DESC);
CREATE INDEX idx_contact_lifecycle_tenant ON public.contact_lifecycle_history(tenant_id, created_at DESC);

-- ==========================================
-- contact_merge_history table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.contact_merge_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  primary_contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  merged_contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
  merged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  merge_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contact_merge_primary ON public.contact_merge_history(tenant_id, primary_contact_id);
CREATE INDEX idx_contact_merge_merged ON public.contact_merge_history(tenant_id, merged_contact_id);

-- ==========================================
-- call_notes table (conversation intelligence)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.call_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  call_id text,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  summary text,
  notes text,
  action_items text[],
  sentiment text,
  duration_seconds integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_call_notes_contact ON public.call_notes(tenant_id, contact_id, created_at DESC);
CREATE TRIGGER set_updated_at_call_notes BEFORE UPDATE ON public.call_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- call_recordings table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.call_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  recording_id text,
  call_sid text,
  recording_url text,
  transcription text,
  duration_seconds integer,
  direction text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_call_recordings_contact ON public.call_recordings(tenant_id, contact_id, created_at DESC);

-- ==========================================
-- conversation_metrics table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.conversation_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  total_calls integer NOT NULL DEFAULT 0,
  total_duration_seconds integer NOT NULL DEFAULT 0,
  avg_duration_seconds numeric(10,2) NOT NULL DEFAULT 0,
  last_call_at timestamptz,
  sentiment_score numeric(5,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversation_metrics_contact ON public.conversation_metrics(contact_id);
CREATE TRIGGER set_updated_at_conversation_metrics BEFORE UPDATE ON public.conversation_metrics FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- conversation_keywords table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.conversation_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  keyword text NOT NULL,
  category text,
  count integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversation_keywords_tenant ON public.conversation_keywords(tenant_id, count DESC);
CREATE TRIGGER set_updated_at_conversation_keywords BEFORE UPDATE ON public.conversation_keywords FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- churn_predictions table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.churn_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  churn_score numeric(5,4) NOT NULL,
  risk_level text NOT NULL DEFAULT 'low',
  factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  predicted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT churn_predictions_risk_level_check CHECK (risk_level IN ('low', 'medium', 'high', 'critical'))
);
CREATE INDEX idx_churn_predictions_contact ON public.churn_predictions(contact_id, predicted_at DESC);
CREATE INDEX idx_churn_predictions_risk ON public.churn_predictions(tenant_id, risk_level);

-- ==========================================
-- deal_forecasts table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.deal_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  predicted_amount numeric(15,2),
  predicted_close_date date,
  confidence_score numeric(5,4),
  model_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deal_forecasts_deal ON public.deal_forecasts(deal_id);
CREATE TRIGGER set_updated_at_deal_forecasts BEFORE UPDATE ON public.deal_forecasts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- revenue_projections table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.revenue_projections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  projected_amount numeric(15,2) NOT NULL,
  actual_amount numeric(15,2) DEFAULT 0,
  confidence_score numeric(5,4),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_revenue_projections_tenant_period ON public.revenue_projections(tenant_id, period_start, period_end);
CREATE TRIGGER set_updated_at_revenue_projections BEFORE UPDATE ON public.revenue_projections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- pipeline_health_metrics table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.pipeline_health_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  total_deals integer NOT NULL DEFAULT 0,
  total_value numeric(15,2) NOT NULL DEFAULT 0,
  avg_deal_size numeric(15,2),
  win_rate numeric(5,4),
  avg_cycle_days integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_pipeline_health_pipeline_date ON public.pipeline_health_metrics(pipeline_id, metric_date);

-- ==========================================
-- impersonation_sessions table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  impersonator_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_impersonation_sessions_active ON public.impersonation_sessions(impersonator_id, started_at DESC) WHERE ended_at IS NULL;

-- ==========================================
-- dashboards table (advanced reporting)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dashboards_tenant ON public.dashboards(tenant_id) WHERE is_system = false;
CREATE TRIGGER set_updated_at_dashboards BEFORE UPDATE ON public.dashboards FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- dashboard_templates table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.dashboard_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  category text,
  layout jsonb NOT NULL DEFAULT '{}'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at_dashboard_templates BEFORE UPDATE ON public.dashboard_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- saved_reports table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  report_type text NOT NULL,
  query_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  chart_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  schedule text,
  is_public boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_reports_report_type_check CHECK (report_type IN ('contacts', 'deals', 'activities', 'revenue', 'pipeline', 'custom'))
);
CREATE INDEX idx_saved_reports_tenant ON public.saved_reports(tenant_id);
CREATE TRIGGER set_updated_at_saved_reports BEFORE UPDATE ON public.saved_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- report_templates table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  report_type text NOT NULL,
  query_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  chart_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER set_updated_at_report_templates BEFORE UPDATE ON public.report_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- report_executions table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.report_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.saved_reports(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  result jsonb,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_executions_status_check CHECK (status IN ('running', 'completed', 'failed', 'cancelled'))
);
CREATE INDEX idx_report_executions_report ON public.report_executions(report_id, started_at DESC);

-- ==========================================
-- field_permissions table (enterprise RBAC)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.field_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role_id uuid REFERENCES public.roles(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  field_name text NOT NULL,
  access_level text NOT NULL DEFAULT 'none',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_permissions_access_level_check CHECK (access_level IN ('none', 'read', 'write', 'admin'))
);
CREATE UNIQUE INDEX idx_field_permissions_role_field ON public.field_permissions(tenant_id, role_id, entity_type, field_name);
CREATE TRIGGER set_updated_at_field_permissions BEFORE UPDATE ON public.field_permissions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- record_permissions table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.record_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role_id uuid REFERENCES public.roles(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  access_level text NOT NULL DEFAULT 'none',
  granted_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT record_permissions_access_level_check CHECK (access_level IN ('none', 'read', 'write', 'admin'))
);
CREATE INDEX idx_record_permissions_entity ON public.record_permissions(tenant_id, entity_type, entity_id);
CREATE INDEX idx_record_permissions_role ON public.record_permissions(tenant_id, role_id);

-- ==========================================
-- price_books table (enterprise quoting)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.price_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  currency text NOT NULL DEFAULT 'USD',
  is_active boolean NOT NULL DEFAULT true,
  valid_from date,
  valid_until date,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_price_books_tenant ON public.price_books(tenant_id) WHERE is_active = true;
CREATE TRIGGER set_updated_at_price_books BEFORE UPDATE ON public.price_books FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- price_book_entries table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.price_book_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_book_id uuid NOT NULL REFERENCES public.price_books(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_price numeric(15,2) NOT NULL,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_price_book_entries_book_product ON public.price_book_entries(price_book_id, product_id);
CREATE TRIGGER set_updated_at_price_book_entries BEFORE UPDATE ON public.price_book_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- quotes table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  quote_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  subtotal numeric(15,2) NOT NULL DEFAULT 0,
  discount numeric(15,2) NOT NULL DEFAULT 0,
  tax numeric(15,2) NOT NULL DEFAULT 0,
  total numeric(15,2) NOT NULL DEFAULT 0,
  valid_until date,
  notes text,
  terms text,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  accepted_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT quotes_status_check CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'cancelled'))
);
CREATE INDEX idx_quotes_tenant ON public.quotes(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_quotes_deal ON public.quotes(tenant_id, deal_id) WHERE deleted_at IS NULL;
CREATE TRIGGER set_updated_at_quotes BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- quote_line_items table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.quote_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  description text NOT NULL,
  quantity numeric(15,4) NOT NULL DEFAULT 1,
  unit_price numeric(15,2) NOT NULL,
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  tax_percent numeric(5,2) NOT NULL DEFAULT 0,
  total numeric(15,2) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_quote_line_items_quote ON public.quote_line_items(quote_id, sort_order);
CREATE TRIGGER set_updated_at_quote_line_items BEFORE UPDATE ON public.quote_line_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- sso_providers table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.sso_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_type text NOT NULL,
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sso_providers_provider_type_check CHECK (provider_type IN ('saml', 'oidc', 'oauth2'))
);
CREATE INDEX idx_sso_providers_tenant ON public.sso_providers(tenant_id) WHERE is_active = true;
CREATE TRIGGER set_updated_at_sso_providers BEFORE UPDATE ON public.sso_providers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================
-- sso_sessions table
-- ==========================================
CREATE TABLE IF NOT EXISTS public.sso_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_id uuid REFERENCES public.sso_providers(id) ON DELETE SET NULL,
  session_id text NOT NULL,
  saml_assertion text,
  id_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '8 hours'
);
CREATE INDEX idx_sso_sessions_user ON public.sso_sessions(user_id, created_at DESC);
CREATE INDEX idx_sso_sessions_session ON public.sso_sessions(session_id);
