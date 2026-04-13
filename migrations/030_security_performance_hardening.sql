-- ═══════════════════════════════════════════════════════════
-- Migration 026: Security & Performance Hardening
-- Date: 2026-04-03
-- Purpose: Add missing indexes, fix RLS policies, security hardening
-- ═══════════════════════════════════════════════════════════

-- ── 1. CRITICAL INDEXES FOR AUTH & SESSIONS ──────────────
-- Ensure fast lookups for authentication (already indexed but verify)
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON public.sessions(token_hash) WHERE expires_at > now();
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON public.sessions(expires_at) WHERE expires_at < now();

-- ── 2. CRITICAL INDEXES FOR RATE LIMITING ────────────────
CREATE INDEX IF NOT EXISTS idx_rate_limits_action_ip ON public.rate_limits(action, ip_address);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON public.rate_limits(window_start, window_end);

-- ── 3. CRITICAL INDEXES FOR TENANT ISOLATION ─────────────
CREATE INDEX IF NOT EXISTS idx_tenant_members_user_tenant ON public.tenant_members(user_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_status ON public.tenant_members(status);
CREATE INDEX IF NOT EXISTS idx_roles_tenant_id ON public.roles(tenant_id);

-- ── 4. CRM CORE TABLE INDEXES ────────────────────────────
-- Contacts
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_id ON public.contacts(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_email ON public.contacts(tenant_id, email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle ON public.contacts(tenant_id, lifecycle_stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_score ON public.contacts(tenant_id, score DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_lead_status ON public.contacts(tenant_id, lead_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON public.contacts(tenant_id, assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON public.contacts(tenant_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_deleted_at ON public.contacts(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON public.contacts USING GIN(tenant_id, tags) WHERE deleted_at IS NULL;

-- Companies
CREATE INDEX IF NOT EXISTS idx_companies_tenant_id ON public.companies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_companies_name ON public.companies(tenant_id, name);

-- Deals
CREATE INDEX IF NOT EXISTS idx_deals_tenant_id ON public.deals(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_stage ON public.deals(tenant_id, stage) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_close_date ON public.deals(tenant_id, close_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_contact ON public.deals(tenant_id, contact_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_company ON public.deals(tenant_id, company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_owner ON public.deals(tenant_id, assigned_to) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deals_created_at ON public.deals(tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- Tasks
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_id ON public.tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks(tenant_id, assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON public.tasks(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON public.tasks(tenant_id, deal_id);

-- Activities
CREATE INDEX IF NOT EXISTS idx_activities_tenant_id ON public.activities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON public.activities(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_activities_deal ON public.activities(tenant_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_activities_type ON public.activities(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_activities_created_at ON public.activities(tenant_id, created_at DESC);

-- ── 5. AUTOMATION & SEQUENCES INDEXES ────────────────────
CREATE INDEX IF NOT EXISTS idx_automations_tenant_active ON public.automations(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_automations_trigger ON public.automations(tenant_id, trigger_type) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_automation_workflows_tenant ON public.automation_workflows(tenant_id, enabled);

CREATE INDEX IF NOT EXISTS idx_sequences_tenant_active ON public.sequences(tenant_id, active);

-- ── 6. NOTIFICATIONS INDEXES ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON public.notifications(user_id, tenant_id, created_at DESC);

-- ── 7. BACKUP & AUDIT INDEXES ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_backup_records_status ON public.backup_records(status, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_time ON public.audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_level_time ON public.error_logs(level, created_at DESC);

-- ── 8. EMAIL & WEBHOOK INDEXES ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_email_tracking_contact ON public.email_tracking(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_email_tracking_status ON public.email_tracking(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status_retry ON public.webhook_deliveries(status, next_retry_at);

-- ── 9. API KEYS INDEXES ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_active ON public.api_keys(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash);

-- ── 10. FORM INDEXES ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_forms_tenant_slug ON public.forms(tenant_id, slug) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON public.form_submissions(tenant_id, form_id, created_at DESC);

-- ── 11. RLS POLICY FIXES ─────────────────────────────────
-- Ensure RLS is enabled on all tenant-scoped tables
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.limit_violations ENABLE ROW LEVEL SECURITY;

-- ── 12. RLS POLICIES FOR TENANT ISOLATION ────────────────
-- Drop existing policies if they exist and recreate them properly
DO $$
BEGIN
  -- Contacts policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'contacts' AND policyname = 'tenant_isolation_contacts') THEN
    CREATE POLICY tenant_isolation_contacts ON public.contacts
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- Companies policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'companies' AND policyname = 'tenant_isolation_companies') THEN
    CREATE POLICY tenant_isolation_companies ON public.companies
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- Deals policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'deals' AND policyname = 'tenant_isolation_deals') THEN
    CREATE POLICY tenant_isolation_deals ON public.deals
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- Tasks policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tasks' AND policyname = 'tenant_isolation_tasks') THEN
    CREATE POLICY tenant_isolation_tasks ON public.tasks
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- Activities policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'activities' AND policyname = 'tenant_isolation_activities') THEN
    CREATE POLICY tenant_isolation_activities ON public.activities
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- Leads policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'leads' AND policyname = 'tenant_isolation_leads') THEN
    CREATE POLICY tenant_isolation_leads ON public.leads
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- Meetings policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'meetings' AND policyname = 'tenant_isolation_meetings') THEN
    CREATE POLICY tenant_isolation_meetings ON public.meetings
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- Notes policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notes' AND policyname = 'tenant_isolation_notes') THEN
    CREATE POLICY tenant_isolation_notes ON public.notes
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- Automations policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'automations' AND policyname = 'tenant_isolation_automations') THEN
    CREATE POLICY tenant_isolation_automations ON public.automations
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- Sequences policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'sequences' AND policyname = 'tenant_isolation_sequences') THEN
    CREATE POLICY tenant_isolation_sequences ON public.sequences
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- Forms policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'forms' AND policyname = 'tenant_isolation_forms') THEN
    CREATE POLICY tenant_isolation_forms ON public.forms
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- API keys policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'api_keys' AND policyname = 'tenant_isolation_api_keys') THEN
    CREATE POLICY tenant_isolation_api_keys ON public.api_keys
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;

  -- Notifications policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'tenant_isolation_notifications') THEN
    CREATE POLICY tenant_isolation_notifications ON public.notifications
      USING (user_id = current_setting('app.current_user', true)::uuid);
  END IF;

  -- Roles policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'roles' AND policyname = 'tenant_isolation_roles') THEN
    CREATE POLICY tenant_isolation_roles ON public.roles
      USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
  END IF;
END $$;

-- ── 13. PROTECT SENSITIVE COLUMNS FROM UPDATES ──────────
-- Create a trigger to prevent accidental updates to sensitive columns
CREATE OR REPLACE FUNCTION public.protect_sensitive_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- Protect password_hash from being updated directly
  IF TG_TABLE_NAME = 'users' AND NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    RAISE EXCEPTION 'password_hash cannot be updated directly. Use the password change API.';
  END IF;
  
  -- Protect is_super_admin from being changed without super admin privileges
  IF TG_TABLE_NAME = 'users' AND NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    RAISE EXCEPTION 'is_super_admin cannot be changed directly.';
  END IF;
  
  -- Protect totp_secret from direct updates
  IF TG_TABLE_NAME = 'users' AND NEW.totp_secret IS DISTINCT FROM OLD.totp_secret THEN
    RAISE EXCEPTION 'totp_secret cannot be updated directly. Use the 2FA API.';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply the trigger to users table
DROP TRIGGER IF EXISTS protect_sensitive_columns_trigger ON public.users;
CREATE TRIGGER protect_sensitive_columns_trigger
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_sensitive_columns();

-- ── 14. ANALYZE TABLES FOR QUERY PLANNER ─────────────────
ANALYZE public.users;
ANALYZE public.sessions;
ANALYZE public.tenants;
ANALYZE public.tenant_members;
ANALYZE public.contacts;
ANALYZE public.companies;
ANALYZE public.deals;
ANALYZE public.tasks;
ANALYZE public.activities;
ANALYZE public.roles;
ANALYZE public.notifications;
ANALYZE public.automations;
ANALYZE public.sequences;
ANALYZE public.forms;
ANALYZE public.api_keys;
ANALYZE public.backup_records;
ANALYZE public.error_logs;
ANALYZE public.audit_logs;

-- ── 15. VACUUM ANALYZE ALL TABLES ────────────────────────
-- This ensures the query planner has up-to-date statistics
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE 'ANALYZE public.' || quote_ident(r.tablename);
  END LOOP;
END $$;
