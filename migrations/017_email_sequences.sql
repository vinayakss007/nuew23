-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Email Sequences Migration
-- Purpose: Multi-step drip campaign automation
-- Run: psql $DATABASE_URL -f 017_email_sequences.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Sequences Table (Drip Campaigns)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  total_steps INTEGER DEFAULT 0,
  total_duration_days INTEGER DEFAULT 0,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  stats JSONB DEFAULT '{"sent": 0, "opened": 0, "clicked": 0, "replied": 0, "unsubscribed": 0}'::jsonb
);

CREATE INDEX IF NOT EXISTS sequences_tenant_idx ON public.sequences(tenant_id, status);
CREATE INDEX IF NOT EXISTS sequences_created_idx ON public.sequences(created_by, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Sequence Steps Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID REFERENCES public.sequences(id) ON DELETE CASCADE NOT NULL,
  step_number INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email', 'task', 'wait', 'call')),
  subject TEXT, -- For email
  body TEXT, -- For email
  delay_days INTEGER DEFAULT 0, -- Days to wait before this step
  delay_hours INTEGER DEFAULT 0, -- Hours to wait (for shorter delays)
  task_title TEXT, -- For task type
  task_description TEXT, -- For task type
  call_script TEXT, -- For call type
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(sequence_id, step_number)
);

CREATE INDEX IF NOT EXISTS sequence_steps_sequence_idx ON public.sequence_steps(sequence_id, step_number);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Sequence Enrollments Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID REFERENCES public.sequences(id) ON DELETE CASCADE NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE NOT NULL,
  tenant_id UUID NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused', 'unsubscribed', 'bounced')),
  current_step INTEGER DEFAULT 1,
  enrolled_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  completed_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  enrolled_by UUID REFERENCES public.users(id),
  metadata JSONB DEFAULT '{}'::jsonb,
  UNIQUE(sequence_id, contact_id)
);

CREATE INDEX IF NOT EXISTS sequence_enrollments_contact_idx ON public.sequence_enrollments(contact_id, status);
CREATE INDEX IF NOT EXISTS sequence_enrollments_sequence_idx ON public.sequence_enrollments(sequence_id, status);
CREATE INDEX IF NOT EXISTS sequence_enrollments_tenant_idx ON public.sequence_enrollments(tenant_id, status);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Sequence Step Logs (Execution History)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sequence_step_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID REFERENCES public.sequence_enrollments(id) ON DELETE CASCADE NOT NULL,
  step_id UUID REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  step_number INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS sequence_step_logs_enrollment_idx ON public.sequence_step_logs(enrollment_id, step_number);
CREATE INDEX IF NOT EXISTS sequence_step_logs_scheduled_idx ON public.sequence_step_logs(scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS sequence_step_logs_status_idx ON public.sequence_step_logs(status, scheduled_at);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Email Templates (Reusable templates for sequences)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  variables TEXT[] DEFAULT '{}', -- Available variables: {{first_name}}, {{company}}, etc.
  is_global BOOLEAN DEFAULT false, -- Available to all users in tenant
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS email_templates_tenant_idx ON public.email_templates(tenant_id, is_global);

-- ─────────────────────────────────────────────────────────────────────
-- 6. Helper Function: Calculate Next Step Date
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_sequence_step_date(
  p_enrolled_at TIMESTAMPTZ,
  p_step_number INTEGER
)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_scheduled_at TIMESTAMPTZ;
BEGIN
  SELECT 
    p_enrolled_at + 
    (COALESCE(delay_days, 0) || ' days')::INTERVAL +
    (COALESCE(delay_hours, 0) || ' hours')::INTERVAL
  INTO v_scheduled_at
  FROM public.sequence_steps
  WHERE step_number = p_step_number
  ORDER BY step_number
  LIMIT 1;
  
  RETURN v_scheduled_at;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Helper Function: Enroll Contact in Sequence
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enroll_contact_in_sequence(
  p_tenant_id UUID,
  p_sequence_id UUID,
  p_contact_id UUID,
  p_user_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_enrollment_id UUID;
  v_first_step_date TIMESTAMPTZ;
BEGIN
  -- Check if already enrolled
  IF EXISTS (
    SELECT 1 FROM public.sequence_enrollments 
    WHERE sequence_id = p_sequence_id AND contact_id = p_contact_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Contact already enrolled in this sequence';
  END IF;

  -- Create enrollment
  INSERT INTO public.sequence_enrollments (
    sequence_id,
    contact_id,
    tenant_id,
    enrolled_by
  ) VALUES (
    p_sequence_id,
    p_contact_id,
    p_tenant_id,
    p_user_id
  ) RETURNING id INTO v_enrollment_id;

  -- Schedule first step
  SELECT public.calculate_sequence_step_date(now(), 1) INTO v_first_step_date;

  INSERT INTO public.sequence_step_logs (
    enrollment_id,
    step_number,
    scheduled_at
  ) VALUES (
    v_enrollment_id,
    1,
    COALESCE(v_first_step_date, now())
  );

  RETURN v_enrollment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 8. View: Sequence Performance Stats
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.sequence_performance AS
SELECT 
  s.id,
  s.name,
  s.status,
  s.total_steps,
  s.total_duration_days,
  
  -- Enrollment stats
  (SELECT count(*) FROM public.sequence_enrollments WHERE sequence_id = s.id) as total_enrollments,
  (SELECT count(*) FROM public.sequence_enrollments WHERE sequence_id = s.id AND status = 'active') as active_enrollments,
  (SELECT count(*) FROM public.sequence_enrollments WHERE sequence_id = s.id AND status = 'completed') as completed_enrollments,
  
  -- Email stats
  (SELECT count(*) FROM public.sequence_step_logs ssl
   JOIN public.sequence_enrollments se ON se.id = ssl.enrollment_id
   WHERE se.sequence_id = s.id AND ssl.status = 'sent') as emails_sent,
  
  (SELECT count(*) FROM public.sequence_step_logs ssl
   JOIN public.sequence_enrollments se ON se.id = ssl.enrollment_id
   WHERE se.sequence_id = s.id AND ssl.opened_at IS NOT NULL) as emails_opened,
  
  (SELECT count(*) FROM public.sequence_step_logs ssl
   JOIN public.sequence_enrollments se ON se.id = ssl.enrollment_id
   WHERE se.sequence_id = s.id AND ssl.clicked_at IS NOT NULL) as emails_clicked,
  
  (SELECT count(*) FROM public.sequence_step_logs ssl
   JOIN public.sequence_enrollments se ON se.id = ssl.enrollment_id
   WHERE se.sequence_id = s.id AND ssl.replied_at IS NOT NULL) as emails_replied,

  -- Rates
  CASE 
    WHEN (SELECT count(*) FROM public.sequence_step_logs ssl
          JOIN public.sequence_enrollments se ON se.id = ssl.enrollment_id
          WHERE se.sequence_id = s.id AND ssl.status = 'sent') > 0
    THEN ROUND(
      (SELECT count(*)::numeric * 100 FROM public.sequence_step_logs ssl
       JOIN public.sequence_enrollments se ON se.id = ssl.enrollment_id
       WHERE se.sequence_id = s.id AND ssl.opened_at IS NOT NULL) /
      (SELECT count(*)::numeric FROM public.sequence_step_logs ssl
       JOIN public.sequence_enrollments se ON se.id = ssl.enrollment_id
       WHERE se.sequence_id = s.id AND ssl.status = 'sent'),
      2
    )
    ELSE 0
  END as open_rate,

  s.created_at
FROM public.sequences s
ORDER BY s.created_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 9. View: Pending Sequence Steps (for cron job)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.pending_sequence_steps AS
SELECT 
  ssl.id as log_id,
  ssl.enrollment_id,
  ssl.step_id,
  ssl.step_number,
  ssl.scheduled_at,
  se.sequence_id,
  se.contact_id,
  se.tenant_id,
  ss.type as step_type,
  ss.subject,
  ss.body,
  ss.task_title,
  ss.task_description,
  c.email as contact_email,
  c.first_name,
  c.last_name,
  co.name as company_name
FROM public.sequence_step_logs ssl
JOIN public.sequence_enrollments se ON se.id = ssl.enrollment_id
JOIN public.sequence_steps ss ON ss.id = ssl.step_id OR ss.step_number = ssl.step_number
JOIN public.contacts c ON c.id = se.contact_id
LEFT JOIN public.companies co ON co.id = c.company_id
WHERE ssl.status = 'pending'
  AND ssl.scheduled_at <= now()
  AND se.status = 'active'
ORDER BY ssl.scheduled_at ASC;

-- ─────────────────────────────────────────────────────────────────────
-- Testing
-- ─────────────────────────────────────────────────────────────────────
-- View sequence performance:
-- SELECT * FROM public.sequence_performance;

-- View pending steps (for cron):
-- SELECT * FROM public.pending_sequence_steps;

-- Enroll contact:
-- SELECT public.enroll_contact_in_sequence('tenant-id', 'sequence-id', 'contact-id', 'user-id');
