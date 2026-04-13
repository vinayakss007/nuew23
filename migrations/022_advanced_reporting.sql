-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Advanced Reporting Migration
-- Purpose: Custom reports, scheduled reports, exports
-- Run: psql $DATABASE_URL -f 022_advanced_reporting.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Saved Reports Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saved_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  report_type TEXT NOT NULL CHECK (report_type IN ('contacts', 'deals', 'companies', 'tasks', 'activities', 'revenue', 'performance', 'custom')),
  config JSONB NOT NULL, -- Report configuration (columns, grouping, sorting)
  filters JSONB DEFAULT '{}'::jsonb, -- Report filters
  is_public BOOLEAN DEFAULT false, -- Available to all users in tenant
  is_scheduled BOOLEAN DEFAULT false,
  schedule_config JSONB DEFAULT '{}'::jsonb, -- {frequency: 'daily|weekly|monthly', recipients: []}
  last_run_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS saved_reports_tenant_idx ON public.saved_reports(tenant_id, report_type);
CREATE INDEX IF NOT EXISTS saved_reports_public_idx ON public.saved_reports(tenant_id, is_public);
CREATE INDEX IF NOT EXISTS saved_reports_scheduled_idx ON public.saved_reports(tenant_id, is_scheduled) WHERE is_scheduled = true;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Report Executions Table (Report run history)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.saved_reports(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  executed_by UUID REFERENCES public.users(id),
  executed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  execution_type TEXT CHECK (execution_type IN ('manual', 'scheduled', 'api')),
  filters_applied JSONB DEFAULT '{}'::jsonb,
  results_summary JSONB DEFAULT '{}'::jsonb, -- {total_rows, total_value, etc.}
  export_format TEXT, -- 'csv', 'pdf', 'xlsx'
  export_url TEXT,
  export_expires_at TIMESTAMPTZ,
  duration_ms INTEGER DEFAULT 0,
  status TEXT DEFAULT 'success' CHECK (status IN ('success', 'failed', 'timeout'))
);

CREATE INDEX IF NOT EXISTS report_executions_tenant_idx ON public.report_executions(tenant_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS report_executions_report_idx ON public.report_executions(report_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS report_executions_user_idx ON public.report_executions(executed_by, executed_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Report Templates Table (Pre-built report templates)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT CHECK (category IN ('sales', 'marketing', 'performance', 'activity', 'revenue')),
  report_type TEXT NOT NULL,
  config JSONB NOT NULL,
  filters JSONB DEFAULT '{}'::jsonb,
  is_global BOOLEAN DEFAULT true, -- Available to all tenants
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS report_templates_category_idx ON public.report_templates(category, report_type);

-- Insert default report templates
INSERT INTO public.report_templates (name, description, category, report_type, config, filters) VALUES
-- Sales Reports
('Pipeline by Stage', 'View deals grouped by stage with values', 'sales', 'deals', 
 '{"columns": ["stage", "count", "total_value", "avg_value"], "group_by": "stage", "chart_type": "funnel"}',
 '{"stage_not_in": ["won", "lost"]}'),

('Won/Lost Analysis', 'Analyze won vs lost deals with reasons', 'sales', 'deals',
 '{"columns": ["stage", "count", "total_value", "win_rate"], "group_by": "stage", "chart_type": "pie"}',
 '{"stage_in": ["won", "lost"]}'),

('Sales by Rep', 'Performance breakdown by sales representative', 'sales', 'deals',
 '{"columns": ["assigned_to", "assigned_name", "count", "total_value", "avg_value"], "group_by": "assigned_to", "chart_type": "bar"}',
 '{}'),

('Revenue by Period', 'Revenue breakdown by time period', 'revenue', 'deals',
 '{"columns": ["period", "count", "total_value"], "group_by": "period", "chart_type": "line", "period": "month"}',
 '{"stage": "won"}'),

-- Activity Reports
('Calls Made', 'Call activity report', 'activity', 'activities',
 '{"columns": ["user_id", "user_name", "count", "avg_duration"], "group_by": "user_id", "chart_type": "bar"}',
 '{"event_type": "call_made"}'),

('Emails Sent', 'Email activity report', 'activity', 'activities',
 '{"columns": ["user_id", "user_name", "count", "open_rate", "click_rate"], "group_by": "user_id", "chart_type": "bar"}',
 '{"event_type": "email_sent"}'),

('Meetings Held', 'Meeting activity report', 'activity', 'meetings',
 '{"columns": ["user_id", "user_name", "count", "no_show_count"], "group_by": "user_id", "chart_type": "bar"}',
 '{"status": "completed"}'),

-- Performance Reports
('Rep Performance', 'Sales rep performance metrics', 'performance', 'performance',
 '{"columns": ["user_id", "user_name", "deals_won", "total_value", "avg_deal_size", "win_rate"], "group_by": "user_id", "chart_type": "table"}',
 '{}'),

('Goal Tracking', 'Track progress towards goals', 'performance', 'performance',
 '{"columns": ["goal_type", "target", "actual", "progress_percentage"], "group_by": "goal_type", "chart_type": "gauge"}',
 '{}'),

-- Trend Reports
('Month-over-Month Growth', 'MoM growth trends', 'sales', 'revenue',
 '{"columns": ["month", "value", "previous_month_value", "growth_percentage"], "group_by": "month", "chart_type": "line", "period": "month"}',
 '{"stage": "won"}'),

('Quarter Comparison', 'Quarterly performance comparison', 'sales', 'revenue',
 '{"columns": ["quarter", "value", "previous_quarter_value", "growth_percentage"], "group_by": "quarter", "chart_type": "bar", "period": "quarter"}',
 '{"stage": "won"}');

-- ─────────────────────────────────────────────────────────────────────
-- 4. Helper Function: Execute Report
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_saved_report(
  p_report_id UUID,
  p_executed_by UUID,
  p_execution_type TEXT DEFAULT 'manual',
  p_custom_filters JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
  v_report RECORD;
  v_results JSONB;
  v_start_time TIMESTAMPTZ;
  v_duration_ms INTEGER;
  v_summary JSONB;
BEGIN
  -- Get report config
  SELECT * INTO v_report
  FROM public.saved_reports
  WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  v_start_time := clock_timestamp();

  -- Execute report based on type
  CASE v_report.report_type
    WHEN 'deals' THEN
      -- Execute deals report
      SELECT jsonb_agg(row_to_json(t)) INTO v_results
      FROM (
        SELECT 
          d.stage,
          COUNT(*) as count,
          COALESCE(SUM(d.value), 0) as total_value,
          COALESCE(AVG(d.value), 0) as avg_value
        FROM public.deals d
        WHERE d.tenant_id = v_report.tenant_id
          AND d.deleted_at IS NULL
          AND (v_report.filters->>'stage' IS NULL OR d.stage = v_report.filters->>'stage')
          AND (p_custom_filters->>'stage' IS NULL OR d.stage = p_custom_filters->>'stage')
        GROUP BY d.stage
        ORDER BY total_value DESC
      ) t;
      
      v_summary := jsonb_build_object(
        'total_deals', SUM(count),
        'total_value', SUM(total_value)
      );

    WHEN 'contacts' THEN
      -- Execute contacts report
      SELECT jsonb_agg(row_to_json(t)) INTO v_results
      FROM (
        SELECT 
          c.lead_status,
          COUNT(*) as count,
          c.lifecycle_stage
        FROM public.contacts c
        WHERE c.tenant_id = v_report.tenant_id
          AND c.deleted_at IS NULL
          AND c.is_archived = false
        GROUP BY c.lead_status, c.lifecycle_stage
        ORDER BY count DESC
      ) t;

      v_summary := jsonb_build_object(
        'total_contacts', SUM(count)
      );

    WHEN 'activities' THEN
      -- Execute activities report
      SELECT jsonb_agg(row_to_json(t)) INTO v_results
      FROM (
        SELECT 
          u.full_name as user_name,
          u.id as user_id,
          COUNT(*) as count,
          a.event_type
        FROM public.activities a
        LEFT JOIN public.users u ON u.id = a.user_id
        WHERE a.tenant_id = v_report.tenant_id
          AND (v_report.filters->>'event_type' IS NULL OR a.event_type = v_report.filters->>'event_type')
        GROUP BY u.id, u.full_name, a.event_type
        ORDER BY count DESC
      ) t;

      v_summary := jsonb_build_object(
        'total_activities', SUM(count)
      );

    WHEN 'revenue' THEN
      -- Execute revenue report
      SELECT jsonb_agg(row_to_json(t)) INTO v_results
      FROM (
        SELECT 
          DATE_TRUNC('month', d.created_at) as period,
          COUNT(*) as count,
          COALESCE(SUM(d.value), 0) as total_value
        FROM public.deals d
        WHERE d.tenant_id = v_report.tenant_id
          AND d.stage = 'won'
          AND d.deleted_at IS NULL
        GROUP BY DATE_TRUNC('month', d.created_at)
        ORDER BY period DESC
      ) t;

      v_summary := jsonb_build_object(
        'total_deals', SUM(count),
        'total_revenue', SUM(total_value)
      );

    ELSE
      v_results := '[]'::jsonb;
      v_summary := '{}'::jsonb;
  END CASE;

  v_duration_ms := EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)) * 1000;

  -- Log execution
  INSERT INTO public.report_executions (
    report_id,
    tenant_id,
    executed_by,
    execution_type,
    filters_applied,
    results_summary,
    duration_ms,
    status
  ) VALUES (
    p_report_id,
    v_report.tenant_id,
    p_executed_by,
    p_execution_type,
    p_custom_filters,
    v_summary,
    v_duration_ms,
    'success'
  );

  -- Update last run
  UPDATE public.saved_reports
  SET last_run_at = now()
  WHERE id = p_report_id;

  RETURN jsonb_build_object(
    'report_id', p_report_id,
    'report_name', v_report.name,
    'results', v_results,
    'summary', v_summary,
    'duration_ms', v_duration_ms
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 5. View: Report Usage Stats
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.report_usage_stats AS
SELECT 
  r.id,
  r.name,
  r.report_type,
  r.is_public,
  r.is_scheduled,
  r.last_run_at,
  u.full_name as created_by_name,
  
  -- Execution stats
  (SELECT count(*) FROM public.report_executions WHERE report_id = r.id) as total_executions,
  (SELECT count(*) FROM public.report_executions WHERE report_id = r.id AND executed_at > now() - interval '7 days') as executions_7d,
  (SELECT count(*) FROM public.report_executions WHERE report_id = r.id AND executed_at > now() - interval '30 days') as executions_30d,
  
  -- Last execution
  (SELECT executed_at FROM public.report_executions WHERE report_id = r.id ORDER BY executed_at DESC LIMIT 1) as last_execution_at,
  
  -- Avg duration
  (SELECT AVG(duration_ms) FROM public.report_executions WHERE report_id = r.id) as avg_duration_ms

FROM public.saved_reports r
LEFT JOIN public.users u ON u.id = r.created_by
ORDER BY total_executions DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 6. View: Scheduled Reports Due
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.scheduled_reports_due AS
SELECT 
  r.id,
  r.name,
  r.report_type,
  r.schedule_config,
  r.last_run_at,
  r.created_by,
  u.email as created_by_email,
  u.full_name as created_by_name
FROM public.saved_reports r
LEFT JOIN public.users u ON u.id = r.created_by
WHERE r.is_scheduled = true
  AND (
    r.last_run_at IS NULL
    OR (
      r.schedule_config->>'frequency' = 'daily' AND r.last_run_at < now() - interval '1 day'
    )
    OR (
      r.schedule_config->>'frequency' = 'weekly' AND r.last_run_at < now() - interval '7 days'
    )
    OR (
      r.schedule_config->>'frequency' = 'monthly' AND r.last_run_at < now() - interval '1 month'
    )
  )
ORDER BY r.last_run_at ASC NULLS FIRST;

-- ─────────────────────────────────────────────────────────────────────
-- Testing
-- ─────────────────────────────────────────────────────────────────────
-- View report usage:
-- SELECT * FROM public.report_usage_stats;

-- View scheduled reports due:
-- SELECT * FROM public.scheduled_reports_due;

-- Execute a report:
-- SELECT public.execute_saved_report('report-id', 'user-id', 'manual', '{}');

-- View available templates:
-- SELECT * FROM public.report_templates;
