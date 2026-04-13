-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Visual Workflow Builder Migration
-- Purpose: Drag-and-drop automation workflow builder
-- Run: psql $DATABASE_URL -f 019_workflow_builder.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Workflows Table (Automation workflows)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  trigger_type TEXT NOT NULL, -- 'contact.created', 'deal.stage_changed', etc.
  trigger_config JSONB DEFAULT '{}'::jsonb,
  nodes JSONB DEFAULT '[]'::jsonb, -- Visual node positions and connections
  is_published BOOLEAN DEFAULT false,
  version INTEGER DEFAULT 1,
  run_count INTEGER DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS workflows_tenant_idx ON public.workflows(tenant_id, status);
CREATE INDEX IF NOT EXISTS workflows_trigger_idx ON public.workflows(tenant_id, trigger_type, status);
CREATE INDEX IF NOT EXISTS workflows_created_idx ON public.workflows(created_by, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Workflow Actions Table (Individual actions in workflow)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE CASCADE NOT NULL,
  action_order INTEGER NOT NULL,
  action_type TEXT NOT NULL, -- 'send_email', 'create_task', 'update_contact', 'add_tag', 'fire_webhook', etc.
  action_config JSONB NOT NULL,
  condition_type TEXT DEFAULT 'always' CHECK (condition_type IN ('always', 'if', 'if_else', 'wait_until')),
  condition_config JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS workflow_actions_workflow_idx ON public.workflow_actions(workflow_id, action_order);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Workflow Execution Logs
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES public.workflows(id) ON DELETE CASCADE NOT NULL,
  trigger_entity_type TEXT NOT NULL, -- 'contact', 'deal', 'company'
  trigger_entity_id UUID NOT NULL,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'stopped')),
  started_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  actions_executed JSONB DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS workflow_execution_logs_workflow_idx ON public.workflow_execution_logs(workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS workflow_execution_logs_entity_idx ON public.workflow_execution_logs(trigger_entity_type, trigger_entity_id);
CREATE INDEX IF NOT EXISTS workflow_execution_logs_status_idx ON public.workflow_execution_logs(status, started_at);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Workflow Action Execution Logs
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workflow_action_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID REFERENCES public.workflow_execution_logs(id) ON DELETE CASCADE NOT NULL,
  action_id UUID REFERENCES public.workflow_actions(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  action_order INTEGER NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'skipped')),
  input_data JSONB DEFAULT '{}'::jsonb,
  output_data JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  executed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  duration_ms INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS workflow_action_logs_execution_idx ON public.workflow_action_logs(execution_id, action_order);
CREATE INDEX IF NOT EXISTS workflow_action_logs_status_idx ON public.workflow_action_logs(status, executed_at);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Available Triggers Reference (for documentation)
-- ─────────────────────────────────────────────────────────────────────
-- contact.created
-- contact.updated
-- contact.status_changed
-- contact.lifecycle_stage_changed
-- contact.assigned
-- 
-- deal.created
-- deal.updated
-- deal.stage_changed
-- deal.won
-- deal.lost
-- 
-- company.created
-- company.updated
-- 
-- task.created
-- task.completed
-- task.overdue
-- 
-- form.submitted
-- email.bounced
-- email.replied

-- ─────────────────────────────────────────────────────────────────────
-- 6. Available Actions Reference (for documentation)
-- ─────────────────────────────────────────────────────────────────────
-- send_email - Send email to contact
-- send_internal_email - Send email to team member
-- create_task - Create follow-up task
-- update_contact - Update contact fields
-- add_tag - Add tag to contact
-- remove_tag - Remove tag from contact
-- assign_contact - Assign contact to user
-- change_lifecycle_stage - Change contact lifecycle
-- create_deal - Create new deal
-- send_webhook - Fire webhook to external URL
-- send_sms - Send SMS (Twilio integration)
-- wait - Wait for specified time
-- wait_until - Wait until condition is met
-- create_note - Add note to contact
-- score_lead - Recalculate lead score

-- ─────────────────────────────────────────────────────────────────────
-- 7. Helper Function: Execute Workflow
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_workflow(
  p_workflow_id UUID,
  p_trigger_entity_type TEXT,
  p_trigger_entity_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_execution_id UUID;
  v_actions RECORD;
  v_success BOOLEAN := true;
  v_error_message TEXT;
  v_actions_executed JSONB := '[]'::jsonb;
BEGIN
  -- Create execution log
  INSERT INTO public.workflow_execution_logs (
    workflow_id,
    trigger_entity_type,
    trigger_entity_id
  ) VALUES (
    p_workflow_id,
    p_trigger_entity_type,
    p_trigger_entity_id
  ) RETURNING id INTO v_execution_id;

  -- Get workflow actions in order
  FOR v_actions IN 
    SELECT * FROM public.workflow_actions 
    WHERE workflow_id = p_workflow_id AND is_active = true
    ORDER BY action_order
  LOOP
    -- Check condition
    IF v_actions.condition_type != 'always' THEN
      -- TODO: Implement condition evaluation
      -- For now, skip if condition is not 'always'
      CONTINUE;
    END IF;

    -- Execute action based on type
    BEGIN
      -- TODO: Implement action execution logic
      -- This is a placeholder - actual execution happens in application code
      
      -- Log action execution
      INSERT INTO public.workflow_action_logs (
        execution_id,
        action_id,
        action_type,
        action_order,
        status,
        executed_at
      ) VALUES (
        v_execution_id,
        v_actions.id,
        v_actions.action_type,
        v_actions.action_order,
        'success',
        now()
      );
      
      v_actions_executed := v_actions_executed || jsonb_build_array(
        jsonb_build_object(
          'action_id', v_actions.id,
          'action_type', v_actions.action_type,
          'status', 'success',
          'executed_at', now()
        )
      );
      
    EXCEPTION WHEN OTHERS THEN
      v_success := false;
      v_error_message := SQLERRM;
      
      INSERT INTO public.workflow_action_logs (
        execution_id,
        action_id,
        action_type,
        action_order,
        status,
        error_message,
        executed_at
      ) VALUES (
        v_execution_id,
        v_actions.id,
        v_actions.action_type,
        v_actions.action_order,
        'failed',
        v_error_message,
        now()
      );
      
      -- Stop execution on error
      EXIT;
    END;
  END LOOP;

  -- Update execution log
  UPDATE public.workflow_execution_logs
  SET 
    status = CASE WHEN v_success THEN 'completed' ELSE 'failed' END,
    completed_at = now(),
    error_message = v_error_message,
    actions_executed = v_actions_executed
  WHERE id = v_execution_id;

  -- Update workflow run count
  UPDATE public.workflows
  SET 
    run_count = run_count + 1,
    last_run_at = now()
  WHERE id = p_workflow_id;

  RETURN v_execution_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 8. View: Active Workflows by Trigger
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.active_workflows_by_trigger AS
SELECT 
  trigger_type,
  count(*) as workflow_count,
  array_agg(id) as workflow_ids
FROM public.workflows
WHERE status = 'active' AND is_published = true
GROUP BY trigger_type;

-- ─────────────────────────────────────────────────────────────────────
-- 9. View: Workflow Performance Stats
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.workflow_performance AS
SELECT 
  w.id,
  w.name,
  w.status,
  w.trigger_type,
  w.run_count,
  w.last_run_at,
  
  -- Execution stats (last 30 days)
  (SELECT count(*) FROM public.workflow_execution_logs 
   WHERE workflow_id = w.id AND started_at > now() - interval '30 days') as executions_30d,
  
  -- Success rate (last 30 days)
  CASE 
    WHEN (SELECT count(*) FROM public.workflow_execution_logs 
          WHERE workflow_id = w.id AND started_at > now() - interval '30 days') > 0
    THEN ROUND(
      (SELECT count(*)::numeric * 100 FROM public.workflow_execution_logs 
       WHERE workflow_id = w.id AND status = 'completed' AND started_at > now() - interval '30 days') /
      (SELECT count(*)::numeric FROM public.workflow_execution_logs 
       WHERE workflow_id = w.id AND started_at > now() - interval '30 days'),
      2
    )
    ELSE 0
  END as success_rate_30d,
  
  -- Average duration (last 30 days)
  (SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::INTEGER
   FROM public.workflow_execution_logs 
   WHERE workflow_id = w.id AND status = 'completed' AND started_at > now() - interval '30 days') as avg_duration_ms

FROM public.workflows w
ORDER BY w.run_count DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 10. View: Recent Workflow Executions
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.recent_workflow_executions AS
SELECT 
  el.id,
  el.workflow_id,
  w.name as workflow_name,
  el.trigger_entity_type,
  el.trigger_entity_id,
  el.status,
  el.started_at,
  el.completed_at,
  el.error_message,
  jsonb_array_length(el.actions_executed) as actions_executed_count,
  CASE 
    WHEN el.status = 'completed' THEN 
      EXTRACT(EPOCH FROM (el.completed_at - el.started_at)) * 1000
    ELSE NULL
  END as duration_ms
FROM public.workflow_execution_logs el
JOIN public.workflows w ON w.id = el.workflow_id
ORDER BY el.started_at DESC
LIMIT 100;

-- ─────────────────────────────────────────────────────────────────────
-- Testing
-- ─────────────────────────────────────────────────────────────────────
-- View active workflows:
-- SELECT * FROM public.active_workflows_by_trigger;

-- View workflow performance:
-- SELECT * FROM public.workflow_performance;

-- View recent executions:
-- SELECT * FROM public.recent_workflow_executions;

-- Execute workflow:
-- SELECT public.execute_workflow('workflow-id', 'contact', 'contact-id');
