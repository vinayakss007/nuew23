-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Impersonation Audit Logging Migration
-- Purpose: Track super admin impersonation sessions for compliance
-- Run: psql $DATABASE_URL -f 014_impersonation_audit.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- Impersonation Sessions Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  super_admin_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  impersonated_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  ended_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  actions JSONB DEFAULT '[]'::jsonb, -- Track key actions during session
  reason TEXT, -- Why impersonation was initiated
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS impersonation_sessions_admin_idx 
  ON public.impersonation_sessions(super_admin_id, started_at DESC);

CREATE INDEX IF NOT EXISTS impersonation_sessions_user_idx 
  ON public.impersonation_sessions(impersonated_user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS impersonation_sessions_tenant_idx 
  ON public.impersonation_sessions(tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS impersonation_sessions_active_idx 
  ON public.impersonation_sessions(ended_at) WHERE ended_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- Enhanced Audit Logs (add impersonation tracking)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.audit_logs 
  ADD COLUMN IF NOT EXISTS impersonated_by UUID REFERENCES public.users(id);

CREATE INDEX IF NOT EXISTS audit_logs_impersonated_idx 
  ON public.audit_logs(impersonated_by) WHERE impersonated_by IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- Helper Function: Start Impersonation Session
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_impersonation(
  p_super_admin_id UUID,
  p_impersonated_user_id UUID,
  p_tenant_id UUID,
  p_ip_address INET,
  p_user_agent TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_session_id UUID;
BEGIN
  INSERT INTO public.impersonation_sessions (
    super_admin_id,
    impersonated_user_id,
    tenant_id,
    ip_address,
    user_agent,
    reason
  ) VALUES (
    p_super_admin_id,
    p_impersonated_user_id,
    p_tenant_id,
    p_ip_address,
    p_user_agent,
    p_reason
  ) RETURNING id INTO v_session_id;

  -- Log the impersonation start
  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    action,
    entity_type,
    metadata,
    impersonated_by
  ) VALUES (
    p_tenant_id,
    p_impersonated_user_id,
    'impersonation_start',
    'user',
    jsonb_build_object(
      'super_admin_id', p_super_admin_id,
      'session_id', v_session_id,
      'reason', p_reason
    ),
    p_super_admin_id
  );

  RETURN v_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- Helper Function: End Impersonation Session
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.end_impersonation(p_session_id UUID)
RETURNS void AS $$
DECLARE
  v_session RECORD;
BEGIN
  SELECT * INTO v_session
  FROM public.impersonation_sessions
  WHERE id = p_session_id AND ended_at IS NULL;

  IF v_session IS NOT NULL THEN
    -- Update session
    UPDATE public.impersonation_sessions
    SET ended_at = now()
    WHERE id = p_session_id;

    -- Log the impersonation end
    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      action,
      entity_type,
      metadata,
      impersonated_by
    ) VALUES (
      v_session.tenant_id,
      v_session.impersonated_user_id,
      'impersonation_end',
      'user',
      jsonb_build_object(
        'super_admin_id', v_session.super_admin_id,
        'session_id', p_session_id,
        'duration_seconds', EXTRACT(EPOCH FROM (now() - v_session.started_at))
      ),
      v_session.super_admin_id
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- Helper Function: Log Action During Impersonation
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_impersonation_action(
  p_session_id UUID,
  p_action TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void AS $$
BEGIN
  UPDATE public.impersonation_sessions
  SET actions = actions || jsonb_build_array(
    jsonb_build_object(
      'action', p_action,
      'metadata', p_metadata,
      'timestamp', now()
    )
  )
  WHERE id = p_session_id AND ended_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- View: Active Impersonation Sessions
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.active_impersonation_sessions AS
SELECT 
  s.id,
  s.super_admin_id,
  sa.email as super_admin_email,
  s.impersonated_user_id,
  u.email as impersonated_email,
  s.tenant_id,
  t.name as tenant_name,
  s.started_at,
  s.ip_address,
  s.user_agent,
  s.reason,
  EXTRACT(EPOCH FROM (now() - s.started_at))/60 as duration_minutes
FROM public.impersonation_sessions s
JOIN public.users sa ON sa.id = s.super_admin_id
JOIN public.users u ON u.id = s.impersonated_user_id
JOIN public.tenants t ON t.id = s.tenant_id
WHERE s.ended_at IS NULL
ORDER BY s.started_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- View: Impersonation History (Last 90 Days)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.impersonation_history AS
SELECT 
  s.id,
  s.super_admin_id,
  sa.email as super_admin_email,
  sa.full_name as super_admin_name,
  s.impersonated_user_id,
  u.email as impersonated_email,
  u.full_name as impersonated_name,
  s.tenant_id,
  t.name as tenant_name,
  s.started_at,
  s.ended_at,
  EXTRACT(EPOCH FROM (s.ended_at - s.started_at))/60 as duration_minutes,
  s.ip_address,
  s.reason,
  jsonb_array_length(s.actions) as action_count
FROM public.impersonation_sessions s
JOIN public.users sa ON sa.id = s.super_admin_id
JOIN public.users u ON u.id = s.impersonated_user_id
JOIN public.tenants t ON t.id = s.tenant_id
WHERE s.started_at > now() - interval '90 days'
ORDER BY s.started_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- Testing
-- ─────────────────────────────────────────────────────────────────────
-- Test impersonation functions:
-- SELECT * FROM active_impersonation_sessions;
-- SELECT * FROM impersonation_history LIMIT 10;
