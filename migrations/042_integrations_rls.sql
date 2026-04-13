-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Integrations Table + RLS Policy + Telegram Move
-- Purpose: Create integrations table with proper RLS policy
--          Move Telegram settings to integrations section
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Create integrations table if not exists
CREATE TABLE IF NOT EXISTS public.integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id),
  type text NOT NULL,
  name text NOT NULL,
  config jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON public.integrations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_integrations_type ON public.integrations(tenant_id, type);

-- 2. RLS Policies for integrations (MISSING in migration 030!)
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (idempotent)
DROP POLICY IF EXISTS tenant_isolation_integrations ON public.integrations;
DROP POLICY IF EXISTS super_admin_bypass_integrations ON public.integrations;

-- Tenant isolation: users can only see their own tenant's integrations
CREATE POLICY tenant_isolation_integrations ON public.integrations
  USING (tenant_id = (current_setting('app.current_tenant', true))::uuid);

-- Super admin bypass
CREATE POLICY super_admin_bypass_integrations ON public.integrations
  USING (EXISTS (
    SELECT 1 FROM users
    WHERE users.id = (current_setting('app.current_user', true))::uuid
    AND users.is_super_admin = true
  ));

-- 3. Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_integrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS integrations_updated_at ON public.integrations;
CREATE TRIGGER integrations_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_integrations_updated_at();

COMMIT;
