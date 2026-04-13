-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — COMPLETE SYSTEM FIX: All broken tables/columns
-- Purpose: Fix ALL errors so NO page crashes
-- Date: April 2026
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. DEALS — Add ALL missing columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS won_at timestamptz,
  ADD COLUMN IF NOT EXISTS pipeline_id uuid;

-- Sync name column with title for existing rows
UPDATE public.deals SET name = title WHERE name IS NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 2. TASKS — Add missing columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════
-- 3. COMPANIES — Add missing columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════
-- 4. ACTIVITIES — Add 'type' column as alias for 'action'
--    Code uses 'type', DB has 'action'. We add 'type' as a proper column.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS type text,
  ADD COLUMN IF NOT EXISTS deal_id uuid;

-- Sync type column from action column
UPDATE public.activities SET type = action WHERE type IS NULL AND action IS NOT NULL;

-- Create trigger to keep type and action in sync
CREATE OR REPLACE FUNCTION public.sync_activities_type()
RETURNS TRIGGER AS $$
BEGIN
  NEW.type = NEW.action;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS activities_sync_type ON public.activities;
CREATE TRIGGER activities_sync_type
  BEFORE INSERT OR UPDATE ON public.activities
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_activities_type();

-- ═══════════════════════════════════════════════════════════════════
-- 5. ERROR_LOGS TABLE — Create for superadmin dashboard
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.error_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  level text NOT NULL DEFAULT 'error',
  code text,
  message text NOT NULL,
  stack text,
  context jsonb DEFAULT '{}',
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_error_logs_level ON public.error_logs(level, resolved);
CREATE INDEX IF NOT EXISTS idx_error_logs_tenant ON public.error_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_created ON public.error_logs(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- 6. CONTACT_EMAILS TABLE — Create for API v1 endpoints
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contact_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  email text NOT NULL,
  phone text,
  is_primary boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(contact_id, email)
);
CREATE INDEX IF NOT EXISTS idx_contact_emails_contact ON public.contact_emails(contact_id);

-- ═══════════════════════════════════════════════════════════════════
-- 7. HEALTH_CHECKS TABLE — Create for monitoring
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  latency_ms integer,
  message text,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_checks_service ON public.health_checks(service, checked_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- 8. SUPPORT_TICKETS TABLE — Create for superadmin
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id),
  subject text NOT NULL,
  body text,
  category text DEFAULT 'bug',
  priority text DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  assigned_to uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant ON public.support_tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);

-- ═══════════════════════════════════════════════════════════════════
-- 9. PIPELINES TABLE — Create for deal pipeline feature
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  stages jsonb DEFAULT '[]',
  is_default boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pipelines_tenant ON public.pipelines(tenant_id);

-- ═══════════════════════════════════════════════════════════════════
-- 10. platform_stats() FUNCTION — Create for superadmin
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.platform_stats()
RETURNS jsonb AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_tenants', (SELECT count(*) FROM public.tenants WHERE deleted_at IS NULL),
    'total_users', (SELECT count(*) FROM public.users WHERE deleted_at IS NULL),
    'total_contacts', (SELECT count(*) FROM public.contacts WHERE deleted_at IS NULL),
    'total_deals', (SELECT count(*) FROM public.deals WHERE deleted_at IS NULL),
    'total_activities', (SELECT count(*) FROM public.activities),
    'total_errors', (SELECT count(*) FROM public.error_logs WHERE resolved = false),
    'active_tenants', (SELECT count(*) FROM public.tenants WHERE deleted_at IS NULL AND status = 'active')
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- 11. purge_trash() FUNCTION — Create for cleanup
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.purge_trash()
RETURNS integer AS $$
DECLARE
  count integer := 0;
  deleted integer;
BEGIN
  -- Purge soft-deleted contacts older than 30 days
  DELETE FROM public.contacts WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  count := count + deleted;

  -- Purge soft-deleted leads older than 30 days
  DELETE FROM public.leads WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  count := count + deleted;

  -- Purge soft-deleted deals older than 30 days
  DELETE FROM public.deals WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  count := count + deleted;

  -- Purge soft-deleted tasks older than 30 days
  DELETE FROM public.tasks WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  count := count + deleted;

  -- Purge soft-deleted companies older than 30 days
  DELETE FROM public.companies WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
  GET DIAGNOSTICS deleted = ROW_COUNT;
  count := count + deleted;

  RETURN count;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- 12. LEADS — Add last_activity_at (in case migration didn't apply)
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- ═══════════════════════════════════════════════════════════════════
-- 13. CONTACTS — Add any remaining missing columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMIT;
