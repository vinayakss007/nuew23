-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Contact Timeline & Activity Feed Migration
-- Purpose: 360-degree view of contact interactions
-- Run: psql $DATABASE_URL -f 015_contact_timeline.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Enhance Activities Table
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.activities 
  ADD COLUMN IF NOT EXISTS event_type TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS activities_contact_timeline_idx 
  ON public.activities(contact_id, created_at DESC) 
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS activities_deal_timeline_idx 
  ON public.activities(deal_id, created_at DESC) 
  WHERE deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS activities_event_type_idx 
  ON public.activities(event_type, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Contact Lifecycle Stages
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.contacts 
  ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT DEFAULT 'subscriber',
  ADD COLUMN IF NOT EXISTS lifecycle_stage_changed_at TIMESTAMPTZ DEFAULT now();

-- Valid lifecycle stages
-- subscriber, lead, marketing_qualified, sales_qualified, opportunity, customer, evangelist, churned

CREATE INDEX IF NOT EXISTS contacts_lifecycle_stage_idx 
  ON public.contacts(lifecycle_stage, tenant_id);

-- Lifecycle history tracking
CREATE TABLE IF NOT EXISTS public.contact_lifecycle_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE NOT NULL,
  tenant_id UUID NOT NULL,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  changed_by UUID REFERENCES public.users(id),
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS contact_lifecycle_history_contact_idx 
  ON public.contact_lifecycle_history(contact_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS contact_lifecycle_history_tenant_idx 
  ON public.contact_lifecycle_history(tenant_id, changed_at DESC);

-- Auto-update lifecycle_stage_changed_at
CREATE OR REPLACE FUNCTION update_contact_lifecycle_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.lifecycle_stage IS DISTINCT FROM NEW.lifecycle_stage THEN
    NEW.lifecycle_stage_changed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_contact_lifecycle_timestamp_trigger
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_lifecycle_timestamp();

-- ─────────────────────────────────────────────────────────────────────
-- 3. Helper Function: Log Activity
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_activity(
  p_tenant_id UUID,
  p_user_id UUID,
  p_event_type TEXT,
  p_description TEXT,
  p_contact_id UUID DEFAULT NULL,
  p_deal_id UUID DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_activity_id UUID;
BEGIN
  INSERT INTO public.activities (
    tenant_id,
    user_id,
    contact_id,
    deal_id,
    company_id,
    event_type,
    description,
    metadata
  ) VALUES (
    p_tenant_id,
    p_user_id,
    p_contact_id,
    p_deal_id,
    p_company_id,
    p_event_type,
    p_description,
    p_metadata
  ) RETURNING id INTO v_activity_id;

  RETURN v_activity_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Helper Function: Update Lifecycle Stage
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_contact_lifecycle(
  p_contact_id UUID,
  p_new_stage TEXT,
  p_user_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS void AS $$
DECLARE
  v_old_stage TEXT;
  v_tenant_id UUID;
BEGIN
  -- Get current stage and tenant
  SELECT lifecycle_stage, tenant_id INTO v_old_stage, v_tenant_id
  FROM public.contacts
  WHERE id = p_contact_id;

  -- Update contact
  UPDATE public.contacts
  SET lifecycle_stage = p_new_stage
  WHERE id = p_contact_id;

  -- Log history
  INSERT INTO public.contact_lifecycle_history (
    contact_id,
    tenant_id,
    from_stage,
    to_stage,
    changed_by,
    reason,
    metadata
  ) VALUES (
    p_contact_id,
    v_tenant_id,
    v_old_stage,
    p_new_stage,
    p_user_id,
    p_reason,
    p_metadata
  );

  -- Log activity
  PERFORM public.log_activity(
    v_tenant_id,
    p_user_id,
    'lifecycle_stage_changed',
    format('Lifecycle changed from "%s" to "%s"', v_old_stage, p_new_stage),
    p_contact_id,
    NULL,
    NULL,
    jsonb_build_object(
      'from_stage', v_old_stage,
      'to_stage', p_new_stage,
      'reason', p_reason
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 5. View: Contact Timeline (Last 100 Activities)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.contact_timeline AS
SELECT 
  a.id,
  a.contact_id,
  a.event_type,
  a.description,
  a.metadata,
  a.created_at,
  u.full_name as user_name,
  u.email as user_email,
  c.first_name,
  c.last_name,
  c.email as contact_email
FROM public.activities a
LEFT JOIN public.users u ON u.id = a.user_id
LEFT JOIN public.contacts c ON c.id = a.contact_id
ORDER BY a.created_at DESC
LIMIT 100;

-- ─────────────────────────────────────────────────────────────────────
-- 6. View: Contact 360-Degree Summary
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.contact_360_summary AS
SELECT 
  c.id,
  c.first_name,
  c.last_name,
  c.email,
  c.phone,
  c.company_id,
  co.name as company_name,
  c.lead_status,
  c.lifecycle_stage,
  c.assigned_to,
  u.full_name as assigned_name,
  c.created_at,
  
  -- Activity counts
  (SELECT count(*) FROM public.activities WHERE contact_id = c.id) as total_activities,
  
  -- Last activity
  (SELECT description FROM public.activities WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1) as last_activity,
  
  -- Last activity date
  (SELECT created_at FROM public.activities WHERE contact_id = c.id ORDER BY created_at DESC LIMIT 1) as last_activity_at,
  
  -- Open tasks
  (SELECT count(*) FROM public.tasks WHERE contact_id = c.id AND completed = false) as open_tasks,
  
  -- Active deals
  (SELECT count(*) FROM public.deals WHERE contact_id = c.id AND stage NOT IN ('won', 'lost')) as active_deals,
  
  -- Total deal value
  (SELECT COALESCE(sum(value), 0) FROM public.deals WHERE contact_id = c.id AND stage = 'won') as won_deal_value,
  
  -- Notes count
  (SELECT count(*) FROM public.notes WHERE contact_id = c.id) as notes_count,
  
  -- Meetings count
  (SELECT count(*) FROM public.meetings WHERE contact_id = c.id) as meetings_count

FROM public.contacts c
LEFT JOIN public.companies co ON co.id = c.company_id
LEFT JOIN public.users u ON u.id = c.assigned_to
WHERE c.deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Event Types Reference
-- ─────────────────────────────────────────────────────────────────────
-- contact_created
-- contact_updated
-- contact_status_changed
-- contact_assigned
-- contact_merged
-- 
-- email_sent
-- email_opened
-- email_clicked
-- email_replied
-- email_bounced
-- 
-- call_made
-- call_scheduled
-- call_completed
-- call_no_show
-- 
-- meeting_scheduled
-- meeting_completed
-- meeting_no_show
-- meeting_cancelled
-- 
-- note_added
-- task_created
-- task_completed
-- task_overdue
-- 
-- deal_created
-- deal_updated
-- deal_stage_changed
-- deal_won
-- deal_lost
-- 
-- lifecycle_stage_changed
-- 
-- form_submitted
-- webhook_sent
-- automation_triggered

-- ─────────────────────────────────────────────────────────────────────
-- Testing
-- ─────────────────────────────────────────────────────────────────────
-- Test timeline view:
-- SELECT * FROM contact_timeline WHERE contact_id = 'your-contact-id';

-- Test 360 summary:
-- SELECT * FROM contact_360_summary WHERE id = 'your-contact-id';

-- Test lifecycle update:
-- SELECT public.update_contact_lifecycle(
--   'contact-id',
--   'sales_qualified',
--   'user-id',
--   'Demo completed successfully'
-- );
