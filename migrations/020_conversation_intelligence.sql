-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Conversation Intelligence Migration
-- Purpose: Call analysis, sentiment, coaching insights
-- Run: psql $DATABASE_URL -f 020_conversation_intelligence.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Call Recordings Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  
  -- Call details
  call_sid TEXT UNIQUE, -- Twilio call SID
  direction TEXT CHECK (direction IN ('inbound', 'outbound')),
  from_number TEXT,
  to_number TEXT,
  duration_seconds INTEGER DEFAULT 0,
  recording_url TEXT,
  recording_sid TEXT,
  transcription TEXT,
  transcription_status TEXT DEFAULT 'pending' CHECK (transcription_status IN ('pending', 'completed', 'failed')),
  
  -- Analysis results
  sentiment_score DECIMAL(5,2), -- -1 to 1 (negative to positive)
  sentiment_label TEXT CHECK (sentiment_label IN ('negative', 'neutral', 'positive')),
  talk_listen_ratio DECIMAL(5,2), -- Agent talk time / Listener talk time
  keywords TEXT[], -- Detected keywords
  topics TEXT[], -- Detected topics
  
  -- Scoring
  call_score INTEGER DEFAULT 0 CHECK (call_score BETWEEN 0 AND 100),
  coaching_flags TEXT[], -- Flags for coaching (e.g., 'interrupted', 'no_discovery')
  
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS call_recordings_tenant_idx ON public.call_recordings(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_recordings_contact_idx ON public.call_recordings(contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_recordings_user_idx ON public.call_recordings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_recordings_sentiment_idx ON public.call_recordings(tenant_id, sentiment_label);
CREATE INDEX IF NOT EXISTS call_recordings_score_idx ON public.call_recordings(tenant_id, call_score DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Call Notes Table (Manual notes from calls)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.call_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID REFERENCES public.call_recordings(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  
  call_outcome TEXT, -- 'connected', 'voicemail', 'no_answer', 'callback_requested'
  next_steps TEXT,
  notes TEXT,
  follow_up_date TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS call_notes_tenant_idx ON public.call_notes(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS call_notes_contact_idx ON public.call_notes(contact_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Conversation Metrics Table (Aggregated metrics)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  
  -- Call stats
  total_calls INTEGER DEFAULT 0,
  total_duration_seconds INTEGER DEFAULT 0,
  avg_call_duration_seconds DECIMAL(10,2) DEFAULT 0,
  
  -- Sentiment distribution
  positive_calls INTEGER DEFAULT 0,
  neutral_calls INTEGER DEFAULT 0,
  negative_calls INTEGER DEFAULT 0,
  
  -- Performance
  avg_call_score DECIMAL(5,2) DEFAULT 0,
  avg_talk_listen_ratio DECIMAL(5,2) DEFAULT 0,
  
  -- Outcomes
  connected_calls INTEGER DEFAULT 0,
  voicemail_calls INTEGER DEFAULT 0,
  no_answer_calls INTEGER DEFAULT 0,
  
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(tenant_id, user_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS conversation_metrics_tenant_idx ON public.conversation_metrics(tenant_id, period_start DESC);
CREATE INDEX IF NOT EXISTS conversation_metrics_user_idx ON public.conversation_metrics(user_id, period_start DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Keyword Tracking Table (Keywords to detect in calls)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversation_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  keyword TEXT NOT NULL,
  category TEXT, -- 'competitor', 'feature', 'objection', 'positive', 'negative'
  sentiment_impact DECIMAL(3,2) DEFAULT 0, -- How much this keyword affects sentiment
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(tenant_id, keyword)
);

CREATE INDEX IF NOT EXISTS conversation_keywords_tenant_idx ON public.conversation_keywords(tenant_id, category);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Helper Function: Calculate Call Score
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_call_score(p_recording_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_score INTEGER := 50; -- Base score
  v_duration INTEGER;
  v_sentiment DECIMAL;
  v_talk_ratio DECIMAL;
BEGIN
  -- Get call data
  SELECT duration_seconds, sentiment_score, talk_listen_ratio
  INTO v_duration, v_sentiment, v_talk_ratio
  FROM public.call_recordings
  WHERE id = p_recording_id;

  -- Duration scoring (ideal: 5-30 minutes)
  IF v_duration BETWEEN 300 AND 1800 THEN
    v_score := v_score + 20;
  ELSIF v_duration > 1800 THEN
    v_score := v_score + 10;
  END IF;

  -- Sentiment scoring
  IF v_sentiment > 0.5 THEN
    v_score := v_score + 20;
  ELSIF v_sentiment > 0 THEN
    v_score := v_score + 10;
  ELSIF v_sentiment < -0.5 THEN
    v_score := v_score - 10;
  END IF;

  -- Talk/listen ratio (ideal: 0.8-1.2, balanced conversation)
  IF v_talk_ratio BETWEEN 0.8 AND 1.2 THEN
    v_score := v_score + 10;
  END IF;

  -- Ensure score is between 0-100
  v_score := GREATEST(0, LEAST(100, v_score));

  -- Update recording
  UPDATE public.call_recordings
  SET call_score = v_score
  WHERE id = p_recording_id;

  RETURN v_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 6. View: Recent Calls with Analysis
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.recent_calls_with_analysis AS
SELECT 
  cr.id,
  cr.contact_id,
  c.first_name,
  c.last_name,
  cr.user_id,
  u.full_name as user_full_name,
  cr.direction,
  cr.duration_seconds,
  cr.sentiment_label,
  cr.sentiment_score,
  cr.call_score,
  cr.talk_listen_ratio,
  cr.keywords,
  cr.transcription,
  cr.created_at
FROM public.call_recordings cr
LEFT JOIN public.contacts c ON c.id = cr.contact_id
LEFT JOIN public.users u ON u.id = cr.user_id
WHERE cr.transcription_status = 'completed'
ORDER BY cr.created_at DESC
LIMIT 100;

-- ─────────────────────────────────────────────────────────────────────
-- 7. View: User Performance Metrics
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.user_call_performance AS
SELECT 
  u.id as user_id,
  u.full_name,
  u.email,
  
  -- This month
  COUNT(cr.id) FILTER (WHERE cr.created_at > date_trunc('month', now())) as calls_this_month,
  AVG(cr.call_score) FILTER (WHERE cr.created_at > date_trunc('month', now())) as avg_score_this_month,
  AVG(cr.duration_seconds) FILTER (WHERE cr.created_at > date_trunc('month', now())) / 60 as avg_duration_this_month,
  
  -- Last month
  COUNT(cr.id) FILTER (WHERE cr.created_at > date_trunc('month', now()) - interval '1 month' 
                        AND cr.created_at < date_trunc('month', now())) as calls_last_month,
  AVG(cr.call_score) FILTER (WHERE cr.created_at > date_trunc('month', now()) - interval '1 month' 
                              AND cr.created_at < date_trunc('month', now())) as avg_score_last_month,
  
  -- All time
  COUNT(cr.id) as total_calls,
  AVG(cr.call_score) as all_time_avg_score

FROM public.users u
LEFT JOIN public.call_recordings cr ON cr.user_id = u.id
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.full_name, u.email
ORDER BY calls_this_month DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 8. View: Low Scoring Calls (Coaching Opportunities)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.coaching_opportunities AS
SELECT 
  cr.id,
  cr.contact_id,
  c.first_name,
  c.last_name,
  cr.user_id,
  u.full_name as user_full_name,
  cr.call_score,
  cr.sentiment_label,
  cr.duration_seconds,
  cr.coaching_flags,
  cr.created_at
FROM public.call_recordings cr
LEFT JOIN public.contacts c ON c.id = cr.contact_id
LEFT JOIN public.users u ON u.id = cr.user_id
WHERE cr.call_score < 60
  AND cr.created_at > now() - interval '7 days'
ORDER BY cr.call_score ASC, cr.created_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- Testing
-- ─────────────────────────────────────────────────────────────────────
-- View recent calls:
-- SELECT * FROM public.recent_calls_with_analysis;

-- View user performance:
-- SELECT * FROM public.user_call_performance;

-- View coaching opportunities:
-- SELECT * FROM public.coaching_opportunities;

-- Calculate call score:
-- SELECT public.calculate_call_score('recording-id');
