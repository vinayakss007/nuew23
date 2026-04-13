-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Predictive Analytics Migration
-- Purpose: Churn prediction, deal forecasting, revenue projections
-- Run: psql $DATABASE_URL -f 021_predictive_analytics.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Churn Predictions Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.churn_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE NOT NULL,
  
  -- Prediction
  churn_probability DECIMAL(5,2) DEFAULT 0 CHECK (churn_probability BETWEEN 0 AND 100),
  churn_risk TEXT CHECK (churn_risk IN ('low', 'medium', 'high', 'critical')),
  
  -- Factors
  risk_factors JSONB DEFAULT '[]'::jsonb, -- What contributes to churn risk
  -- e.g., ['no_activity_30d', 'negative_sentiment', 'competitor_mentioned']
  
  -- Recommendations
  recommended_actions TEXT[], -- Actions to reduce churn risk
  
  -- Tracking
  previous_probability DECIMAL(5,2),
  probability_change DECIMAL(5,2),
  
  is_actioned BOOLEAN DEFAULT false,
  actioned_at TIMESTAMPTZ,
  actioned_by UUID REFERENCES public.users(id),
  
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(tenant_id, contact_id)
);

CREATE INDEX IF NOT EXISTS churn_predictions_tenant_idx ON public.churn_predictions(tenant_id, churn_probability DESC);
CREATE INDEX IF NOT EXISTS churn_predictions_risk_idx ON public.churn_predictions(tenant_id, churn_risk);
CREATE INDEX IF NOT EXISTS churn_predictions_unactioned_idx ON public.churn_predictions(tenant_id, churn_risk) WHERE is_actioned = false;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Deal Forecasts Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.deal_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE NOT NULL,
  
  -- Prediction
  win_probability DECIMAL(5,2) DEFAULT 0 CHECK (win_probability BETWEEN 0 AND 100),
  predicted_close_date DATE,
  predicted_value DECIMAL(12,2),
  
  -- Factors
  positive_factors JSONB DEFAULT '[]'::jsonb, -- Factors increasing win probability
  negative_factors JSONB DEFAULT '[]'::jsonb, -- Factors decreasing win probability
  
  -- Comparison
  original_value DECIMAL(12,2),
  value_change DECIMAL(12,2),
  original_close_date DATE,
  date_change_days INTEGER,
  
  confidence_level TEXT CHECK (confidence_level IN ('low', 'medium', 'high')),
  
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(tenant_id, deal_id)
);

CREATE INDEX IF NOT EXISTS deal_forecasts_tenant_idx ON public.deal_forecasts(tenant_id, win_probability DESC);
CREATE INDEX IF NOT EXISTS deal_forecasts_deal_idx ON public.deal_forecasts(deal_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Revenue Projections Table (Monthly/Quarterly projections)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.revenue_projections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  period_type TEXT CHECK (period_type IN ('month', 'quarter', 'year')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- Projections
  projected_revenue DECIMAL(14,2) DEFAULT 0,
  projected_deals_won INTEGER DEFAULT 0,
  projected_new_contacts INTEGER DEFAULT 0,
  
  -- Confidence
  confidence_low DECIMAL(14,2), -- Lower bound (90% confidence)
  confidence_high DECIMAL(14,2), -- Upper bound (90% confidence)
  
  -- Factors considered
  factors JSONB DEFAULT '{}'::jsonb,
  
  -- Actuals (filled in after period ends)
  actual_revenue DECIMAL(14,2),
  actual_deals_won INTEGER,
  actual_new_contacts INTEGER,
  
  -- Accuracy tracking
  revenue_accuracy DECIMAL(5,2), -- Percentage accuracy
  is_closed BOOLEAN DEFAULT false,
  
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(tenant_id, period_type, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS revenue_projections_tenant_idx ON public.revenue_projections(tenant_id, period_start DESC);
CREATE INDEX IF NOT EXISTS revenue_projections_period_idx ON public.revenue_projections(period_type, period_start);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Pipeline Health Metrics Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pipeline_health_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  calculated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  -- Pipeline stats
  total_deals INTEGER DEFAULT 0,
  total_value DECIMAL(14,2) DEFAULT 0,
  weighted_value DECIMAL(14,2) DEFAULT 0,
  
  -- By stage
  stage_distribution JSONB DEFAULT '{}'::jsonb, -- {stage: count}
  stage_values JSONB DEFAULT '{}'::jsonb, -- {stage: value}
  
  -- Velocity
  avg_days_in_pipeline DECIMAL(10,2) DEFAULT 0,
  avg_days_per_stage JSONB DEFAULT '{}'::jsonb,
  
  -- Conversion
  stage_conversion_rates JSONB DEFAULT '{}'::jsonb, -- {stage: conversion_rate}
  
  -- Health indicators
  health_score INTEGER DEFAULT 0 CHECK (health_score BETWEEN 0 AND 100),
  health_factors JSONB DEFAULT '[]'::jsonb,
  
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS pipeline_health_metrics_tenant_idx ON public.pipeline_health_metrics(tenant_id, calculated_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Helper Function: Calculate Churn Risk
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_churn_risk(p_contact_id UUID)
RETURNS DECIMAL AS $$
DECLARE
  v_churn_probability DECIMAL := 0;
  v_risk_factors JSONB := '[]'::jsonb;
  v_last_activity_days INTEGER;
  v_lifecycle_stage TEXT;
  v_negative_activities INTEGER;
BEGIN
  -- Get contact data
  SELECT 
    EXTRACT(DAY FROM (now() - MAX(a.created_at)))::INTEGER,
    c.lifecycle_stage
  INTO v_last_activity_days, v_lifecycle_stage
  FROM public.contacts c
  LEFT JOIN public.activities a ON a.contact_id = c.id
  WHERE c.id = p_contact_id
  GROUP BY c.lifecycle_stage;

  -- Factor 1: No recent activity (30+ days)
  IF v_last_activity_days > 30 THEN
    v_churn_probability := v_churn_probability + 30;
    v_risk_factors := v_risk_factors || jsonb_build_array('no_activity_30d');
  END IF;
  
  IF v_last_activity_days > 60 THEN
    v_churn_probability := v_churn_probability + 20;
    v_risk_factors := v_risk_factors || jsonb_build_array('no_activity_60d');
  END IF;

  -- Factor 2: Lifecycle stage (lead stage for long time)
  IF v_lifecycle_stage = 'lead' AND v_last_activity_days > 14 THEN
    v_churn_probability := v_churn_probability + 15;
    v_risk_factors := v_risk_factors || jsonb_build_array('stuck_in_lead_stage');
  END IF;

  -- Factor 3: Negative sentiment activities
  SELECT COUNT(*) INTO v_negative_activities
  FROM public.activities a
  WHERE a.contact_id = p_contact_id
    AND a.metadata->>'sentiment' = 'negative'
    AND a.created_at > now() - interval '60 days';

  IF v_negative_activities > 0 THEN
    v_churn_probability := v_churn_probability + (v_negative_activities * 10);
    v_risk_factors := v_risk_factors || jsonb_build_array('negative_sentiment');
  END IF;

  -- Cap at 100
  v_churn_probability := LEAST(100, v_churn_probability);

  -- Upsert prediction
  INSERT INTO public.churn_predictions (
    tenant_id,
    contact_id,
    churn_probability,
    churn_risk,
    risk_factors,
    recommended_actions,
    updated_at
  )
  SELECT
    c.tenant_id,
    p_contact_id,
    v_churn_probability,
    CASE 
      WHEN v_churn_probability >= 75 THEN 'critical'
      WHEN v_churn_probability >= 50 THEN 'high'
      WHEN v_churn_probability >= 25 THEN 'medium'
      ELSE 'low'
    END,
    v_risk_factors,
    CASE 
      WHEN v_churn_probability >= 75 THEN ARRAY['Immediate outreach required', 'Schedule check-in call', 'Offer special incentive']
      WHEN v_churn_probability >= 50 THEN ARRAY['Send personalized follow-up', 'Share relevant content']
      WHEN v_churn_probability >= 25 THEN ARRAY['Monitor engagement', 'Send newsletter']
      ELSE ARRAY['Continue regular engagement']
    END,
    now()
  FROM public.contacts c
  WHERE c.id = p_contact_id
  ON CONFLICT (tenant_id, contact_id) DO UPDATE SET
    churn_probability = v_churn_probability,
    churn_risk = CASE 
      WHEN v_churn_probability >= 75 THEN 'critical'
      WHEN v_churn_probability >= 50 THEN 'high'
      WHEN v_churn_probability >= 25 THEN 'medium'
      ELSE 'low'
    END,
    risk_factors = v_risk_factors,
    updated_at = now();

  RETURN v_churn_probability;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Helper Function: Calculate Deal Win Probability
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_deal_win_probability(p_deal_id UUID)
RETURNS DECIMAL AS $$
DECLARE
  v_win_probability DECIMAL := 50; -- Base probability
  v_positive_factors JSONB := '[]'::jsonb;
  v_negative_factors JSONB := '[]'::jsonb;
  v_stage TEXT;
  v_value DECIMAL;
  v_days_open INTEGER;
  v_activity_count INTEGER;
BEGIN
  -- Get deal data
  SELECT 
    d.stage,
    d.value,
    EXTRACT(DAY FROM (now() - d.created_at))::INTEGER,
    (SELECT COUNT(*) FROM public.activities a WHERE a.deal_id = d.id)
  INTO v_stage, v_value, v_days_open, v_activity_count
  FROM public.deals d
  WHERE d.id = p_deal_id;

  -- Factor 1: Stage probability
  CASE v_stage
    WHEN 'won' THEN
      v_win_probability := 100;
      v_positive_factors := v_positive_factors || jsonb_build_array('deal_won');
    WHEN 'negotiation' THEN
      v_win_probability := v_win_probability + 25;
      v_positive_factors := v_positive_factors || jsonb_build_array('in_negotiation');
    WHEN 'proposal' THEN
      v_win_probability := v_win_probability + 10;
      v_positive_factors := v_positive_factors || jsonb_build_array('proposal_sent');
    WHEN 'qualified' THEN
      v_win_probability := v_win_probability - 10;
    WHEN 'lead' THEN
      v_win_probability := v_win_probability - 20;
      v_negative_factors := v_negative_factors || jsonb_build_array('early_stage');
    ELSE
      v_win_probability := v_win_probability - 30;
      v_negative_factors := v_negative_factors || jsonb_build_array('lost_stage');
  END CASE;

  -- Factor 2: Activity engagement
  IF v_activity_count > 10 THEN
    v_win_probability := v_win_probability + 15;
    v_positive_factors := v_positive_factors || jsonb_build_array('high_engagement');
  ELSIF v_activity_count < 3 THEN
    v_win_probability := v_win_probability - 15;
    v_negative_factors := v_negative_factors || jsonb_build_array('low_engagement');
  END IF;

  -- Factor 3: Deal age (stale deals less likely to close)
  IF v_days_open > 90 THEN
    v_win_probability := v_win_probability - 20;
    v_negative_factors := v_negative_factors || jsonb_build_array('stale_deal');
  ELSIF v_days_open > 60 THEN
    v_win_probability := v_win_probability - 10;
  END IF;

  -- Cap between 0-100
  v_win_probability := GREATEST(0, LEAST(100, v_win_probability));

  -- Upsert forecast
  INSERT INTO public.deal_forecasts (
    tenant_id,
    deal_id,
    win_probability,
    positive_factors,
    negative_factors,
    confidence_level,
    updated_at
  )
  SELECT
    d.tenant_id,
    p_deal_id,
    v_win_probability,
    v_positive_factors,
    v_negative_factors,
    CASE 
      WHEN v_activity_count > 10 AND v_days_open < 60 THEN 'high'
      WHEN v_activity_count > 5 THEN 'medium'
      ELSE 'low'
    END,
    now()
  FROM public.deals d
  WHERE d.id = p_deal_id
  ON CONFLICT (tenant_id, deal_id) DO UPDATE SET
    win_probability = v_win_probability,
    positive_factors = v_positive_factors,
    negative_factors = v_negative_factors,
    confidence_level = CASE 
      WHEN v_activity_count > 10 AND v_days_open < 60 THEN 'high'
      WHEN v_activity_count > 5 THEN 'medium'
      ELSE 'low'
    END,
    updated_at = now();

  RETURN v_win_probability;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 7. View: High Risk Churn Contacts
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.high_risk_churn_contacts AS
SELECT 
  cp.*,
  c.first_name,
  c.last_name,
  c.email,
  c.company_id,
  co.name as company_name,
  c.assigned_to,
  u.full_name as assigned_name
FROM public.churn_predictions cp
JOIN public.contacts c ON c.id = cp.contact_id
LEFT JOIN public.companies co ON co.id = c.company_id
LEFT JOIN public.users u ON u.id = c.assigned_to
WHERE cp.churn_risk IN ('high', 'critical')
  AND cp.is_actioned = false
ORDER BY cp.churn_probability DESC, cp.created_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 8. View: Deals by Win Probability
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.deals_by_win_probability AS
SELECT 
  df.*,
  d.title,
  d.value as original_value,
  d.stage,
  c.first_name,
  c.last_name,
  co.name as company_name
FROM public.deal_forecasts df
JOIN public.deals d ON d.id = df.deal_id
LEFT JOIN public.contacts c ON c.id = d.contact_id
LEFT JOIN public.companies co ON c.id = co.id
WHERE d.stage NOT IN ('won', 'lost')
ORDER BY df.win_probability DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 9. View: Revenue Forecast Summary
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.revenue_forecast_summary AS
SELECT 
  d.tenant_id,
  COUNT(*) as total_deals,
  SUM(d.value) as total_pipeline_value,
  SUM(d.value * df.win_probability / 100) as weighted_forecast,
  AVG(df.win_probability) as avg_win_probability,
  
  -- By confidence level
  COUNT(*) FILTER (WHERE df.confidence_level = 'high') as high_confidence_deals,
  SUM(d.value) FILTER (WHERE df.confidence_level = 'high') as high_confidence_value,
  
  COUNT(*) FILTER (WHERE df.confidence_level = 'medium') as medium_confidence_deals,
  SUM(d.value) FILTER (WHERE df.confidence_level = 'medium') as medium_confidence_value

FROM public.deals d
JOIN public.deal_forecasts df ON df.deal_id = d.id
WHERE d.stage NOT IN ('won', 'lost')
GROUP BY d.tenant_id;

-- ─────────────────────────────────────────────────────────────────────
-- Testing
-- ─────────────────────────────────────────────────────────────────────
-- Calculate churn risk:
-- SELECT public.calculate_churn_risk('contact-id');

-- Calculate deal win probability:
-- SELECT public.calculate_deal_win_probability('deal-id');

-- View high risk churn:
-- SELECT * FROM public.high_risk_churn_contacts;

-- View deals by probability:
-- SELECT * FROM public.deals_by_win_probability;

-- View revenue forecast:
-- SELECT * FROM public.revenue_forecast_summary;
