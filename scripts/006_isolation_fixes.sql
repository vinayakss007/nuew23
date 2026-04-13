-- ═══════════════════════════════════════════════════════════════
-- NuCRM Migration 006 — Data Isolation & Org Creation Fixes
-- Run AFTER existing migrations: psql $DATABASE_URL -f scripts/006_isolation_fixes.sql
-- ═══════════════════════════════════════════════════════════════

-- 1. Ensure tenant_id is NOT NULL on all data tables
-- (These should already be NOT NULL but let's enforce it)
ALTER TABLE public.contacts   ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.companies  ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.deals      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.tasks      ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE public.activities ALTER COLUMN tenant_id SET NOT NULL;

-- 2. Add composite indexes for fast tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_contacts_tenant_created
  ON public.contacts(tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_companies_tenant
  ON public.companies(tenant_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_deals_tenant_stage
  ON public.deals(tenant_id, stage)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_tenant_due
  ON public.tasks(tenant_id, due_date ASC NULLS LAST)
  WHERE deleted_at IS NULL AND completed = false;

CREATE INDEX IF NOT EXISTS idx_activities_tenant_created
  ON public.activities(tenant_id, created_at DESC);

-- 3. UNIQUE constraint on tenant_members — one record per user per org
-- (already exists as UNIQUE(tenant_id, user_id) in schema but confirm)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_members_tenant_id_user_id_key'
  ) THEN
    ALTER TABLE public.tenant_members
      ADD CONSTRAINT tenant_members_tenant_id_user_id_key
      UNIQUE (tenant_id, user_id);
  END IF;
END $$;

-- 4. FIX: Find any tenants missing admin membership and fix them
-- (Fixes the bug where signup created tenant but no tenant_member row)
INSERT INTO public.tenant_members (tenant_id, user_id, role_slug, status, joined_at)
SELECT t.id, t.owner_id, 'admin', 'active', t.created_at
FROM public.tenants t
WHERE t.owner_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = t.id AND tm.user_id = t.owner_id
  )
ON CONFLICT (tenant_id, user_id) DO UPDATE
  SET role_slug = 'admin', status = 'active';

-- 5. FIX: Set last_tenant_id for any users missing it
-- (Users created before the fix who have a tenant but no last_tenant_id)
UPDATE public.users u
SET last_tenant_id = (
  SELECT tm.tenant_id FROM public.tenant_members tm
  WHERE tm.user_id = u.id AND tm.status = 'active'
  ORDER BY tm.created_at ASC
  LIMIT 1
)
WHERE u.last_tenant_id IS NULL
  AND EXISTS (
    SELECT 1 FROM public.tenant_members
    WHERE user_id = u.id AND status = 'active'
  );

-- 6. Verify isolation — view showing any cross-contamination issues
-- Run this to audit: SELECT * FROM public.v_data_isolation_check;
CREATE OR REPLACE VIEW public.v_data_isolation_check AS
SELECT
  'contacts' as table_name,
  c.id,
  c.tenant_id,
  t.name as tenant_name,
  CASE WHEN t.id IS NULL THEN 'ORPHANED - no matching tenant!' ELSE 'OK' END as status
FROM public.contacts c
LEFT JOIN public.tenants t ON t.id = c.tenant_id
WHERE t.id IS NULL
UNION ALL
SELECT
  'deals' as table_name,
  d.id,
  d.tenant_id,
  t.name,
  CASE WHEN t.id IS NULL THEN 'ORPHANED - no matching tenant!' ELSE 'OK' END
FROM public.deals d
LEFT JOIN public.tenants t ON t.id = d.tenant_id
WHERE t.id IS NULL;

-- Done
SELECT 'Migration 006 complete. Run: SELECT * FROM public.v_data_isolation_check; to verify.' as result;
