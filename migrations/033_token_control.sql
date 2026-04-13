-- ═══════════════════════════════════════════════════════════════════
-- NuCRM — Token & Usage Control System (Migration 033)
-- Purpose: Superadmin controls for AI tokens, budgets, and limits
-- Tables: token_budgets, tenant_token_limits, user_token_limits,
--         api_keys_registry, usage_alerts, cost_anomalies
-- ═══════════════════════════════════════════════════════════════════

-- Global service budgets
CREATE TABLE IF NOT EXISTS public.token_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  monthly_budget_cents BIGINT NOT NULL DEFAULT 0,
  current_month_cents BIGINT NOT NULL DEFAULT 0,
  alert_at_50pct BOOLEAN DEFAULT true,
  alert_at_80pct BOOLEAN DEFAULT true,
  alert_at_100pct BOOLEAN DEFAULT true,
  hard_cap_enabled BOOLEAN DEFAULT true,
  soft_cap_enabled BOOLEAN DEFAULT true,
  billing_period TEXT NOT NULL DEFAULT TO_CHAR(NOW(), 'YYYY-MM'),
  reset_day INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(service, billing_period)
);

CREATE INDEX IF NOT EXISTS idx_token_budgets_service ON public.token_budgets(service, billing_period);

-- Per-tenant token limits
CREATE TABLE IF NOT EXISTS public.tenant_token_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  openai_monthly_limit BIGINT DEFAULT -1,
  whatsapp_monthly_msgs BIGINT DEFAULT -1,
  voice_monthly_mins BIGINT DEFAULT -1,
  content_monthly_gen BIGINT DEFAULT -1,
  proposal_monthly_gen BIGINT DEFAULT -1,
  followup_monthly_cnt BIGINT DEFAULT -1,
  score_monthly_cnt BIGINT DEFAULT -1,
  total_monthly_cost BIGINT DEFAULT -1,
  hard_cap_action TEXT DEFAULT 'block',
  override_reason TEXT,
  set_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

-- Per-user token limits
CREATE TABLE IF NOT EXISTS public.user_token_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  daily_limit BIGINT DEFAULT -1,
  monthly_limit BIGINT DEFAULT -1,
  max_cost_per_call BIGINT DEFAULT -1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id, module)
);

-- API keys registry
CREATE TABLE IF NOT EXISTS public.api_keys_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL,
  key_name TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_prefix TEXT,
  is_active BOOLEAN DEFAULT true,
  is_primary BOOLEAN DEFAULT false,
  monthly_budget_cents BIGINT DEFAULT -1,
  current_month_cents BIGINT DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  rate_limit_per_min INT,
  rate_limit_per_day INT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_service ON public.api_keys_registry(service, is_active);

-- Usage alerts
CREATE TABLE IF NOT EXISTS public.usage_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  service TEXT,
  current_value BIGINT,
  threshold_value BIGINT,
  message TEXT,
  notification_sent TEXT,
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_by UUID REFERENCES public.users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_alerts_target ON public.usage_alerts(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_alerts_unacked ON public.usage_alerts(acknowledged) WHERE acknowledged = false;

-- Cost anomalies
CREATE TABLE IF NOT EXISTS public.cost_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  expected_daily_cents BIGINT,
  actual_daily_cents BIGINT,
  deviation_pct DECIMAL(10,2),
  suspected_cause TEXT,
  action_taken TEXT,
  reviewed BOOLEAN DEFAULT false,
  reviewed_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_anomalies_tenant ON public.cost_anomalies(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_anomalies_unreviewed ON public.cost_anomalies(reviewed) WHERE reviewed = false;

-- Insert default global budgets
INSERT INTO public.token_budgets (service, monthly_budget_cents, billing_period) VALUES
  ('openai', 1000000, TO_CHAR(NOW(), 'YYYY-MM')),
  ('whatsapp', 500000, TO_CHAR(NOW(), 'YYYY-MM')),
  ('twilio', 200000, TO_CHAR(NOW(), 'YYYY-MM')),
  ('vapi', 200000, TO_CHAR(NOW(), 'YYYY-MM')),
  ('resend', 10000, TO_CHAR(NOW(), 'YYYY-MM'))
ON CONFLICT (service, billing_period) DO NOTHING;

COMMENT ON TABLE public.token_budgets IS 'Global spending limits per AI service per month — controlled by superadmin';
COMMENT ON TABLE public.tenant_token_limits IS 'Per-tenant AI usage limits set by superadmin';
COMMENT ON TABLE public.user_token_limits IS 'Per-user AI usage limits within a tenant';
COMMENT ON TABLE public.api_keys_registry IS 'Registry of all external API keys with usage tracking';
COMMENT ON TABLE public.usage_alerts IS 'Budget and limit alert history';
COMMENT ON TABLE public.cost_anomalies IS 'Detected unusual spending patterns';
