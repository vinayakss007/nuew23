-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Row Level Security (RLS) Migration
-- Purpose: Database-enforced tenant isolation
-- Run: psql $DATABASE_URL -f 012_row_level_security.sql
-- ═══════════════════════════════════════════════════════════════════

-- Enable RLS on all tenant-scoped tables
-- This ensures data isolation at the database level, not just application level

-- ─────────────────────────────────────────────────────────────────────
-- 1. CONTACTS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_contacts ON public.contacts
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Super admin bypass policy
CREATE POLICY super_admin_bypass_contacts ON public.contacts
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 2. COMPANIES
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_companies ON public.companies
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY super_admin_bypass_companies ON public.companies
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 3. DEALS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_deals ON public.deals
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY super_admin_bypass_deals ON public.deals
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 4. TASKS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_tasks ON public.tasks
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY super_admin_bypass_tasks ON public.tasks
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 5. ACTIVITIES
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_activities ON public.activities
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY super_admin_bypass_activities ON public.activities
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 6. NOTES
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_notes ON public.notes
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY super_admin_bypass_notes ON public.notes
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 7. MEETINGS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_meetings ON public.meetings
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY super_admin_bypass_meetings ON public.meetings
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 8. AUTOMATIONS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_automations ON public.automations
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY super_admin_bypass_automations ON public.automations
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 9. NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_notifications ON public.notifications
  USING (
    tenant_id = current_setting('app.current_tenant', true)::uuid AND
    user_id = current_setting('app.current_user', true)::uuid
  )
  WITH CHECK (
    tenant_id = current_setting('app.current_tenant', true)::uuid AND
    user_id = current_setting('app.current_user', true)::uuid
  );

CREATE POLICY super_admin_bypass_notifications ON public.notifications
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 10. WEBHOOKS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_webhooks ON public.webhook_deliveries
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY super_admin_bypass_webhooks ON public.webhook_deliveries
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 11. API KEYS
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_api_keys ON public.api_keys
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY super_admin_bypass_api_keys ON public.api_keys
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 12. AUDIT LOGS (read-only for own tenant, super admin can see all)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_audit_logs ON public.audit_logs
  USING (
    tenant_id = current_setting('app.current_tenant', true)::uuid OR
    user_id = current_setting('app.current_user', true)::uuid
  );

CREATE POLICY super_admin_bypass_audit_logs ON public.audit_logs
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = current_setting('app.current_user', true)::uuid 
      AND is_super_admin = true
    )
  );

-- ─────────────────────────────────────────────────────────────────────
-- HELPER FUNCTION: Set tenant context
-- Call this at the start of each database session
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_tenant_context(p_tenant_id uuid, p_user_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant', p_tenant_id::text, false);
  PERFORM set_config('app.current_user', p_user_id::text, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- VERIFICATION QUERY
-- Run this to verify RLS is enabled on all tables
-- ─────────────────────────────────────────────────────────────────────
-- SELECT tablename, rowsecurity 
-- FROM pg_tables 
-- WHERE schemaname = 'public' 
-- ORDER BY tablename;

-- ─────────────────────────────────────────────────────────────────────
-- TESTING
-- ─────────────────────────────────────────────────────────────────────
-- Test RLS is working:
-- 1. Connect as regular user
-- 2. Try to query contacts without setting context:
--    SELECT * FROM contacts;  -- Should return 0 rows
-- 3. Set context and try again:
--    SELECT set_tenant_context('your-tenant-uuid', 'your-user-uuid');
--    SELECT * FROM contacts;  -- Should return tenant's contacts
-- 4. Connect as super admin
-- 5. Query without context:
--    SELECT * FROM contacts;  -- Should return ALL contacts
