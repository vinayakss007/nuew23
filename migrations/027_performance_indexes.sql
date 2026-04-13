-- =====================================================
-- NuCRM SaaS v2 — Performance Index Migration
-- Fixes: PERF-001 (CRITICAL — No Database Indexes)
-- Run: psql $DATABASE_URL -f migrations/027_performance_indexes.sql
-- =====================================================

-- Contacts: lookup by email within tenant
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_email
  ON public.contacts (tenant_id, email) WHERE deleted_at IS NULL;

-- Contacts: listing by creation date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_created
  ON public.contacts (tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- Contacts: by assigned user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_assigned_to
  ON public.contacts (tenant_id, assigned_to) WHERE deleted_at IS NULL;

-- Contacts: by company
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_company
  ON public.contacts (tenant_id, company_id) WHERE deleted_at IS NULL;

-- Contacts: lifecycle stage filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_lifecycle
  ON public.contacts (tenant_id, lifecycle_stage) WHERE deleted_at IS NULL;

-- Leads: listing and filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_tenant_created
  ON public.leads (tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- Leads: by email (dedup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_tenant_email
  ON public.leads (tenant_id, email) WHERE deleted_at IS NULL;

-- Leads: by assigned user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_assigned_to
  ON public.leads (tenant_id, assigned_to) WHERE deleted_at IS NULL;

-- Leads: by status
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_status
  ON public.leads (tenant_id, lead_status) WHERE deleted_at IS NULL;

-- Deals: pipeline queries by stage
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_tenant_stage
  ON public.deals (tenant_id, stage) WHERE deleted_at IS NULL;

-- Deals: by close date (forecast)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_close_date
  ON public.deals (tenant_id, close_date) WHERE deleted_at IS NULL;

-- Deals: by assigned user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_assigned_to
  ON public.deals (tenant_id, assigned_to) WHERE deleted_at IS NULL;

-- Deals: by company
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_company
  ON public.deals (tenant_id, company_id) WHERE deleted_at IS NULL;

-- Deals: by contact
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deals_contact
  ON public.deals (tenant_id, contact_id) WHERE deleted_at IS NULL;

-- Tasks: dashboard and task list queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_tenant_due
  ON public.tasks (tenant_id, due_date, completed) WHERE deleted_at IS NULL;

-- Tasks: by assigned user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_assigned_to
  ON public.tasks (tenant_id, assigned_to, completed) WHERE deleted_at IS NULL;

-- Tasks: by contact
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_contact
  ON public.tasks (tenant_id, contact_id) WHERE deleted_at IS NULL;

-- Tasks: by deal
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_deal
  ON public.tasks (tenant_id, deal_id) WHERE deleted_at IS NULL;

-- Companies: listing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_tenant_created
  ON public.companies (tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- Companies: by industry
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_companies_industry
  ON public.companies (tenant_id, industry) WHERE deleted_at IS NULL;

-- Activities: timeline queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_contact
  ON public.activities (tenant_id, contact_id, created_at DESC);

-- Activities: by deal
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_deal
  ON public.activities (tenant_id, deal_id, created_at DESC);

-- Activities: by user
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_user
  ON public.activities (tenant_id, user_id, created_at DESC);

-- Sessions: auth lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_token_hash
  ON public.sessions (token_hash, expires_at DESC);

-- Sessions: by user (session listing)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_user
  ON public.sessions (user_id, created_at DESC);

-- API Keys: auth lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_hash
  ON public.api_keys (key_hash, is_active, expires_at);

-- API Keys: by tenant
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_tenant
  ON public.api_keys (tenant_id, is_active);

-- Tenant Members: membership checks
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_members_tenant_user
  ON public.tenant_members (tenant_id, user_id, status);

-- Tenant Members: by user (which tenants am I in?)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tenant_members_user
  ON public.tenant_members (user_id, status);

-- Notifications: notification bell
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_read
  ON public.notifications (user_id, is_read, created_at DESC);

-- Notifications: unread count
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_unread
  ON public.notifications (user_id, is_read) WHERE is_read = false;

-- Webhooks: by tenant
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhooks_tenant
  ON public.webhooks (tenant_id, is_active);

-- Webhook Deliveries: by webhook
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_deliveries_webhook
  ON public.webhook_deliveries (webhook_id, created_at DESC);

-- Automations: by tenant
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_automations_tenant
  ON public.automations (tenant_id, is_active);

-- Sequences: by tenant
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sequences_tenant
  ON public.sequences (tenant_id, status);

-- Sequence Enrollments: by contact
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sequence_enrollments_contact
  ON public.sequence_enrollments (contact_id, status);

-- Forms: by tenant
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_forms_tenant
  ON public.forms (tenant_id, is_active);

-- Password Resets: by token
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_password_resets_token
  ON public.password_resets (token, expires_at DESC);

-- Email Tracking: by contact
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_tracking_contact
  ON public.email_tracking (contact_id, created_at DESC);

-- Error Logs: by level and resolved
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_errors_level_resolved
  ON public.errors (level, resolved, created_at DESC);

-- Error Logs: by tenant
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_errors_tenant
  ON public.errors (tenant_id, created_at DESC);

-- Full-text search index (if search_vector exists)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_search
  ON public.contacts USING gin(to_tsvector('english', coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || coalesce(email,'')))
  WHERE deleted_at IS NULL;

-- Verify indexes created
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as scans
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
