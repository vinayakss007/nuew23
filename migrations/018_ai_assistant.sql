-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — AI Assistant Migration
-- Purpose: AI-powered insights, email drafting, recommendations
-- Run: psql $DATABASE_URL -f 018_ai_assistant.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. AI Insights Table (Contact/Deal insights)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('contact', 'deal', 'company')),
  entity_id UUID NOT NULL,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('engagement', 'churn_risk', 'opportunity', 'follow_up', 'general')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  confidence_score DECIMAL(5,2) DEFAULT 0, -- 0-100
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  metadata JSONB DEFAULT '{}'::jsonb,
  is_read BOOLEAN DEFAULT false,
  is_actioned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_insights_entity_idx ON public.ai_insights(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ai_insights_tenant_idx ON public.ai_insights(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_insights_priority_idx ON public.ai_insights(tenant_id, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_insights_unread_idx ON public.ai_insights(tenant_id, is_read) WHERE is_read = false;

-- ─────────────────────────────────────────────────────────────────────
-- 2. AI Email Drafts Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_email_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL, -- 'follow_up', 'introduction', 'check_in', 'proposal', 'closing'
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  variables_used TEXT[] DEFAULT '{}',
  tone TEXT DEFAULT 'professional' CHECK (tone IN ('professional', 'friendly', 'casual', 'formal', 'enthusiastic')),
  length TEXT DEFAULT 'medium' CHECK (length IN ('short', 'medium', 'long')),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS ai_email_drafts_contact_idx ON public.ai_email_drafts(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_email_drafts_deal_idx ON public.ai_email_drafts(deal_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Contact Scoring Table (AI-powered lead scoring)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE NOT NULL UNIQUE,
  tenant_id UUID NOT NULL,
  overall_score INTEGER DEFAULT 0 CHECK (overall_score BETWEEN 0 AND 100),
  engagement_score INTEGER DEFAULT 0 CHECK (engagement_score BETWEEN 0 AND 100),
  fit_score INTEGER DEFAULT 0 CHECK (fit_score BETWEEN 0 AND 100),
  intent_score INTEGER DEFAULT 0 CHECK (intent_score BETWEEN 0 AND 100),
  score_factors JSONB DEFAULT '[]'::jsonb, -- What contributed to the score
  last_calculated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS contact_scores_tenant_idx ON public.contact_scores(tenant_id, overall_score DESC);
CREATE INDEX IF NOT EXISTS contact_scores_contact_idx ON public.contact_scores(contact_id);

-- ─────────────────────────────────────────────────────────────────────
-- 4. AI Usage Logs (for tracking API calls and costs)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES public.users(id),
  feature TEXT NOT NULL, -- 'insights', 'email_draft', 'scoring', 'summary'
  model TEXT, -- 'claude-haiku', 'claude-sonnet', etc.
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost_cents DECIMAL(10,4) DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS ai_usage_logs_tenant_idx ON public.ai_usage_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_logs_feature_idx ON public.ai_usage_logs(tenant_id, feature, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_logs_user_idx ON public.ai_usage_logs(user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Helper Function: Calculate Contact Score
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_contact_score(p_contact_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_score INTEGER := 50; -- Base score
  v_engagement INTEGER := 0;
  v_fit INTEGER := 0;
  v_intent INTEGER := 0;
  v_factors JSONB := '[]'::jsonb;
BEGIN
  -- Engagement Score (based on activities)
  SELECT COALESCE(
    (SELECT count(*) FROM public.activities WHERE contact_id = p_contact_id AND created_at > now() - interval '30 days') * 5,
    0
  ) INTO v_engagement;
  v_engagement := LEAST(v_engagement, 100);
  
  IF v_engagement > 50 THEN
    v_factors := v_factors || jsonb_build_object('engagement', 'High recent activity');
  END IF;

  -- Fit Score (based on completeness and company)
  SELECT CASE 
    WHEN c.email IS NOT NULL AND c.phone IS NOT NULL AND c.company_id IS NOT NULL THEN 100
    WHEN c.email IS NOT NULL AND c.phone IS NOT NULL THEN 70
    WHEN c.email IS NOT NULL THEN 50
    ELSE 20
  END INTO v_fit
  FROM public.contacts c WHERE c.id = p_contact_id;

  -- Intent Score (based on lifecycle stage)
  SELECT CASE 
    WHEN c.lifecycle_stage = 'opportunity' THEN 90
    WHEN c.lifecycle_stage = 'sales_qualified' THEN 75
    WHEN c.lifecycle_stage = 'marketing_qualified' THEN 60
    WHEN c.lifecycle_stage = 'lead' THEN 40
    ELSE 20
  END INTO v_intent
  FROM public.contacts c WHERE c.id = p_contact_id;

  -- Calculate overall score (weighted average)
  v_score := (v_engagement * 0.4 + v_fit * 0.3 + v_intent * 0.3)::INTEGER;

  -- Update or insert score
  INSERT INTO public.contact_scores (
    contact_id,
    tenant_id,
    overall_score,
    engagement_score,
    fit_score,
    intent_score,
    score_factors,
    last_calculated_at
  )
  SELECT 
    p_contact_id,
    c.tenant_id,
    v_score,
    v_engagement,
    v_fit,
    v_intent,
    v_factors,
    now()
  FROM public.contacts c
  WHERE c.id = p_contact_id
  ON CONFLICT (contact_id) DO UPDATE SET
    overall_score = v_score,
    engagement_score = v_engagement,
    fit_score = v_fit,
    intent_score = v_intent,
    score_factors = v_factors,
    last_calculated_at = now();

  RETURN v_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Helper Function: Generate AI Insight
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_ai_insight(
  p_tenant_id UUID,
  p_entity_type TEXT,
  p_entity_id UUID,
  p_insight_type TEXT,
  p_title TEXT,
  p_description TEXT,
  p_confidence DECIMAL,
  p_priority TEXT DEFAULT 'medium',
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_expiry_days INTEGER DEFAULT 7
)
RETURNS UUID AS $$
DECLARE
  v_insight_id UUID;
BEGIN
  INSERT INTO public.ai_insights (
    tenant_id,
    entity_type,
    entity_id,
    insight_type,
    title,
    description,
    confidence_score,
    priority,
    metadata,
    expires_at
  ) VALUES (
    p_tenant_id,
    p_entity_type,
    p_entity_id,
    p_insight_type,
    p_title,
    p_description,
    p_confidence,
    p_priority,
    p_metadata,
    now() + (p_expiry_days || ' days')::INTERVAL
  ) RETURNING id INTO v_insight_id;

  RETURN v_insight_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 7. View: High Priority Insights
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.high_priority_insights AS
SELECT 
  i.*,
  c.first_name,
  c.last_name,
  c.email,
  c.lead_status
FROM public.ai_insights i
LEFT JOIN public.contacts c ON c.id = i.entity_id AND i.entity_type = 'contact'
WHERE i.priority IN ('high', 'urgent')
  AND i.is_actioned = false
  AND (i.expires_at IS NULL OR i.expires_at > now())
ORDER BY 
  CASE i.priority 
    WHEN 'urgent' THEN 1 
    WHEN 'high' THEN 2 
    ELSE 3 
  END,
  i.created_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 8. View: Top Scored Contacts
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.top_scored_contacts AS
SELECT 
  cs.*,
  c.first_name,
  c.last_name,
  c.email,
  c.company_id,
  co.name as company_name,
  c.lead_status,
  c.lifecycle_stage
FROM public.contact_scores cs
JOIN public.contacts c ON c.id = cs.contact_id
LEFT JOIN public.companies co ON co.id = c.company_id
WHERE c.deleted_at IS NULL
ORDER BY cs.overall_score DESC
LIMIT 100;

-- ─────────────────────────────────────────────────────────────────────
-- Testing
-- ─────────────────────────────────────────────────────────────────────
-- Calculate contact score:
-- SELECT public.calculate_contact_score('contact-id');

-- Generate insight:
-- SELECT public.generate_ai_insight(
--   'tenant-id',
--   'contact',
--   'contact-id',
--   'engagement',
--   'High Engagement Detected',
--   'This contact has shown high engagement recently',
--   85.5,
--   'high'
-- );

-- View insights:
-- SELECT * FROM public.high_priority_insights;

-- View top contacts:
-- SELECT * FROM public.top_scored_contacts;
