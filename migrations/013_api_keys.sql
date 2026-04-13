-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — API Keys Migration
-- Purpose: Scoped API key authentication for external integrations
-- Run: psql $DATABASE_URL -f 013_api_keys.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- API Keys Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_used_ip INET,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON public.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON public.api_keys(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS api_keys_user_idx ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS api_keys_expires_idx ON public.api_keys(expires_at) WHERE expires_at IS NOT NULL;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_api_keys_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_api_keys_updated_at_trigger
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_api_keys_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- API Usage Logs (for rate limiting and auditing)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.api_key_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID REFERENCES public.api_keys(id) ON DELETE CASCADE NOT NULL,
  tenant_id UUID NOT NULL,
  user_id UUID,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  ip_address INET,
  user_agent TEXT,
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS api_key_usage_key_idx ON public.api_key_usage(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_key_usage_tenant_idx ON public.api_key_usage(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS api_key_usage_endpoint_idx ON public.api_key_usage(endpoint, created_at DESC);

-- Auto-cleanup old usage logs (keep 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_api_usage()
RETURNS void AS $$
BEGIN
  DELETE FROM public.api_key_usage
  WHERE created_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────
-- Available API Scopes Reference
-- ─────────────────────────────────────────────────────────────────────
-- contacts:read       - Read contacts
-- contacts:write      - Create/update contacts
-- contacts:delete     - Delete contacts
-- contacts:all        - Full contact access
-- 
-- companies:read      - Read companies
-- companies:write     - Create/update companies
-- companies:delete    - Delete companies
-- companies:all       - Full company access
-- 
-- deals:read          - Read deals
-- deals:write         - Create/update deals
-- deals:delete        - Delete deals
-- deals:all           - Full deal access
-- 
-- tasks:read          - Read tasks
-- tasks:write         - Create/update tasks
-- tasks:delete        - Delete tasks
-- tasks:all           - Full task access
-- 
-- reports:read        - Read reports
-- reports:export      - Export reports
-- 
-- automations:read    - Read automations
-- automations:write   - Create/update automations
-- automations:all     - Full automation access
-- 
-- all                 - Full access to everything

-- ─────────────────────────────────────────────────────────────────────
-- Sample Data (for testing)
-- ─────────────────────────────────────────────────────────────────────
-- INSERT INTO public.api_keys (tenant_id, user_id, name, key_hash, key_prefix, scopes)
-- VALUES (
--   '00000000-0000-0000-0000-000000000000',
--   '00000000-0000-0000-0000-000000000000',
--   'Test Key',
--   'test_hash',
--   'ak_test_abc',
--   ARRAY['contacts:read', 'contacts:write']
-- );
