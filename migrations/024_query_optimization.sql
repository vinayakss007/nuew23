-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Query Optimization & Materialized Views
-- Purpose: Performance optimization for dashboard and reporting queries
-- Run: psql $DATABASE_URL -f 024_query_optimization.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Dashboard Stats Materialized View
-- ─────────────────────────────────────────────────────────────────────
-- Pre-aggregated dashboard statistics for instant loading
-- Refreshed hourly via cron job

CREATE MATERIALIZED VIEW IF NOT EXISTS public.tenant_dashboard_stats AS
SELECT
  t.id as tenant_id,
  
  -- Contact stats
  COUNT(DISTINCT c.id) FILTER (WHERE c.deleted_at IS NULL) as contact_count,
  COUNT(DISTINCT c.id) FILTER (
    WHERE c.deleted_at IS NULL 
    AND c.created_at > now() - interval '30 days'
  ) as new_contacts_30d,
  
  -- Company stats
  COUNT(DISTINCT co.id) FILTER (WHERE co.deleted_at IS NULL) as company_count,
  
  -- Deal stats
  COUNT(DISTINCT d.id) FILTER (WHERE d.deleted_at IS NULL) as deal_count,
  COUNT(DISTINCT d.id) FILTER (
    WHERE d.deleted_at IS NULL AND d.stage NOT IN ('won', 'lost')
  ) as open_deals,
  COUNT(DISTINCT d.id) FILTER (
    WHERE d.deleted_at IS NULL AND d.stage = 'won'
  ) as won_deals,
  COUNT(DISTINCT d.id) FILTER (
    WHERE d.deleted_at IS NULL AND d.stage = 'lost'
  ) as lost_deals,
  
  -- Pipeline value
  COALESCE(SUM(d.value) FILTER (
    WHERE d.deleted_at IS NULL AND d.stage NOT IN ('won', 'lost')
  ), 0) as pipeline_value,
  COALESCE(SUM(d.value) FILTER (
    WHERE d.deleted_at IS NULL AND d.stage = 'won'
  ), 0) as won_value,
  COALESCE(SUM(d.value) FILTER (
    WHERE d.deleted_at IS NULL AND d.stage = 'won'
    AND d.closed_at > now() - interval '30 days'
  ), 0) as won_value_30d,
  
  -- Task stats
  COUNT(DISTINCT tsk.id) FILTER (
    WHERE tsk.tenant_id = t.id AND NOT tsk.completed
  ) as pending_tasks,
  COUNT(DISTINCT tsk.id) FILTER (
    WHERE tsk.tenant_id = t.id 
    AND NOT tsk.completed 
    AND tsk.due_date < CURRENT_DATE
  ) as overdue_tasks,
  COUNT(DISTINCT tsk.id) FILTER (
    WHERE tsk.tenant_id = t.id 
    AND tsk.completed 
    AND tsk.completed_at > now() - interval '7 days'
  ) as completed_tasks_7d,
  
  -- Activity stats
  COUNT(DISTINCT a.id) FILTER (
    WHERE a.tenant_id = t.id 
    AND a.created_at > now() - interval '7 days'
  ) as activities_7d,
  
  -- User stats
  COUNT(DISTINCT tm.user_id) FILTER (
    WHERE tm.tenant_id = t.id AND tm.status = 'active'
  ) as active_users,
  
  -- Updated timestamp
  now() as calculated_at

FROM public.tenants t
LEFT JOIN public.contacts c ON c.tenant_id = t.id
LEFT JOIN public.companies co ON co.tenant_id = t.id
LEFT JOIN public.deals d ON d.tenant_id = t.id
LEFT JOIN public.tasks tsk ON tsk.tenant_id = t.id
LEFT JOIN public.activities a ON a.tenant_id = t.id
LEFT JOIN public.tenant_members tm ON tm.tenant_id = t.id
WHERE t.deleted_at IS NULL
GROUP BY t.id;

-- Create unique index for concurrent refresh
CREATE UNIQUE INDEX IF NOT EXISTS tenant_dashboard_stats_tenant_idx 
  ON public.tenant_dashboard_stats(tenant_id);

-- Additional indexes for common queries
CREATE INDEX IF NOT EXISTS tenant_dashboard_stats_won_value_idx 
  ON public.tenant_dashboard_stats(tenant_id, won_value);

CREATE INDEX IF NOT EXISTS tenant_dashboard_stats_pipeline_idx 
  ON public.tenant_dashboard_stats(tenant_id, pipeline_value);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Refresh Function
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_tenant_dashboard_stats()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.tenant_dashboard_stats;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Contact Activity Summary View
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.contact_activity_summary AS
SELECT
  c.id as contact_id,
  c.tenant_id,
  c.first_name,
  c.last_name,
  c.email,
  c.lead_status,
  c.lifecycle_stage,
  
  -- Activity counts
  COUNT(DISTINCT a.id) as total_activities,
  MAX(a.created_at) as last_activity_at,
  
  -- Recent activity flag
  COUNT(DISTINCT a.id) FILTER (
    WHERE a.created_at > now() - interval '7 days'
  ) as recent_activities,
  
  -- Task stats
  COUNT(DISTINCT tsk.id) FILTER (WHERE NOT tsk.completed) as pending_tasks,
  COUNT(DISTINCT tsk.id) FILTER (
    WHERE NOT tsk.completed AND tsk.due_date < CURRENT_DATE
  ) as overdue_tasks,
  
  -- Deal stats
  COUNT(DISTINCT d.id) FILTER (WHERE d.stage NOT IN ('won', 'lost')) as open_deals,
  COALESCE(SUM(d.value) FILTER (WHERE d.stage NOT IN ('won', 'lost')), 0) as pipeline_value,
  
  -- Engagement score (simple calculation)
  CASE
    WHEN COUNT(DISTINCT a.id) FILTER (WHERE a.created_at > now() - interval '7 days') > 5 THEN 100
    WHEN COUNT(DISTINCT a.id) FILTER (WHERE a.created_at > now() - interval '7 days') > 2 THEN 75
    WHEN COUNT(DISTINCT a.id) FILTER (WHERE a.created_at > now() - interval '30 days') > 2 THEN 50
    WHEN COUNT(DISTINCT a.id) > 0 THEN 25
    ELSE 0
  END as engagement_score

FROM public.contacts c
LEFT JOIN public.activities a ON a.contact_id = c.id
LEFT JOIN public.tasks tsk ON tsk.contact_id = c.id
LEFT JOIN public.deals d ON d.contact_id = c.id
WHERE c.deleted_at IS NULL
GROUP BY c.id, c.tenant_id, c.first_name, c.last_name, c.email, c.lead_status, c.lifecycle_stage;

CREATE INDEX IF NOT EXISTS contact_activity_summary_tenant_idx 
  ON public.contact_activity_summary(tenant_id);

CREATE INDEX IF NOT EXISTS contact_activity_summary_engagement_idx 
  ON public.contact_activity_summary(tenant_id, engagement_score DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 4. Deal Pipeline Summary View
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.deal_pipeline_summary AS
SELECT
  d.tenant_id,
  d.stage,
  COUNT(*) as deal_count,
  COALESCE(SUM(d.value), 0) as total_value,
  COALESCE(AVG(d.value), 0) as avg_value,
  COALESCE(SUM(d.value) * AVG(d.probability) / 100, 0) as weighted_value,
  
  -- Age stats
  AVG(EXTRACT(DAY FROM (now() - d.created_at))) as avg_age_days,
  MAX(EXTRACT(DAY FROM (now() - d.created_at))) as max_age_days,
  
  -- Conversion stats (for won deals)
  COUNT(*) FILTER (WHERE d.stage = 'won') as won_count,
  COUNT(*) FILTER (WHERE d.stage = 'lost') as lost_count,
  CASE 
    WHEN COUNT(*) FILTER (WHERE d.stage IN ('won', 'lost')) > 0
    THEN ROUND(
      COUNT(*) FILTER (WHERE d.stage = 'won')::numeric / 
      COUNT(*) FILTER (WHERE d.stage IN ('won', 'lost')) * 100, 
      2
    )
    ELSE 0
  END as win_rate_percentage

FROM public.deals d
WHERE d.deleted_at IS NULL
GROUP BY d.tenant_id, d.stage
ORDER BY 
  CASE d.stage
    WHEN 'lead' THEN 1
    WHEN 'qualified' THEN 2
    WHEN 'proposal' THEN 3
    WHEN 'negotiation' THEN 4
    WHEN 'won' THEN 5
    WHEN 'lost' THEN 6
    ELSE 7
  END;

CREATE INDEX IF NOT EXISTS deal_pipeline_summary_tenant_idx 
  ON public.deal_pipeline_summary(tenant_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5. User Performance Summary View
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.user_performance_summary AS
SELECT
  u.id as user_id,
  u.tenant_id,
  u.full_name,
  u.email,
  
  -- Contact stats
  COUNT(DISTINCT c.id) FILTER (WHERE c.deleted_at IS NULL) as contacts_owned,
  
  -- Deal stats
  COUNT(DISTINCT d.id) FILTER (
    WHERE d.deleted_at IS NULL AND d.assigned_to = u.id
  ) as deals_owned,
  COUNT(DISTINCT d.id) FILTER (
    WHERE d.deleted_at IS NULL 
    AND d.assigned_to = u.id 
    AND d.stage = 'won'
  ) as deals_won,
  COALESCE(SUM(d.value) FILTER (
    WHERE d.deleted_at IS NULL 
    AND d.assigned_to = u.id 
    AND d.stage = 'won'
  ), 0) as revenue_won,
  
  -- Task stats
  COUNT(DISTINCT tsk.id) FILTER (
    WHERE tsk.assigned_to = u.id AND NOT tsk.completed
  ) as pending_tasks,
  COUNT(DISTINCT tsk.id) FILTER (
    WHERE tsk.assigned_to = u.id 
    AND tsk.completed 
    AND tsk.completed_at > now() - interval '7 days'
  ) as completed_tasks_7d,
  
  -- Activity stats
  COUNT(DISTINCT a.id) FILTER (
    WHERE a.user_id = u.id 
    AND a.created_at > now() - interval '7 days'
  ) as activities_7d,
  
  -- Performance score
  CASE
    WHEN COUNT(DISTINCT d.id) FILTER (
      WHERE d.deleted_at IS NULL AND d.assigned_to = u.id AND d.stage = 'won'
    ) > 10 THEN 100
    WHEN COUNT(DISTINCT d.id) FILTER (
      WHERE d.deleted_at IS NULL AND d.assigned_to = u.id AND d.stage = 'won'
    ) > 5 THEN 75
    WHEN COUNT(DISTINCT tsk.id) FILTER (
      WHERE tsk.assigned_to = u.id AND tsk.completed
    ) > 20 THEN 50
    ELSE 25
  END as performance_score

FROM public.users u
LEFT JOIN public.contacts c ON c.assigned_to = u.id
LEFT JOIN public.deals d ON d.assigned_to = u.id
LEFT JOIN public.tasks tsk ON tsk.assigned_to = u.id
LEFT JOIN public.activities a ON a.user_id = u.id
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.tenant_id, u.full_name, u.email;

CREATE INDEX IF NOT EXISTS user_performance_summary_tenant_idx 
  ON public.user_performance_summary(tenant_id);

CREATE INDEX IF NOT EXISTS user_performance_summary_score_idx 
  ON public.user_performance_summary(tenant_id, performance_score DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 6. Covering Indexes for Common Queries
-- ─────────────────────────────────────────────────────────────────────
-- Contacts list with common filters
CREATE INDEX IF NOT EXISTS contacts_tenant_status_covering_idx
  ON public.contacts(tenant_id, lead_status, created_at DESC)
  INCLUDE (first_name, last_name, email, company_id, assigned_to)
  WHERE deleted_at IS NULL;

-- Deals pipeline view
CREATE INDEX IF NOT EXISTS deals_tenant_stage_covering_idx
  ON public.deals(tenant_id, stage, created_at DESC)
  INCLUDE (title, value, probability, contact_id, company_id, assigned_to)
  WHERE deleted_at IS NULL;

-- Tasks list
CREATE INDEX IF NOT EXISTS tasks_tenant_completed_covering_idx
  ON public.tasks(tenant_id, completed, due_date ASC)
  INCLUDE (title, description, priority, contact_id, deal_id, assigned_to)
  WHERE deleted_at IS NULL;

-- Activities timeline
CREATE INDEX IF NOT EXISTS activities_contact_covering_idx
  ON public.activities(contact_id, created_at DESC)
  INCLUDE (tenant_id, user_id, type, event_type, description)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Query Performance Monitoring Function
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_slow_queries(
  min_duration_ms INTEGER DEFAULT 100,
  limit_count INTEGER DEFAULT 20
)
RETURNS TABLE (
  query text,
  calls bigint,
  total_time double precision,
  mean_time double precision,
  rows bigint
) AS $$
BEGIN
  -- Requires pg_stat_statements extension
  RETURN QUERY
  SELECT
    qs.query,
    qs.calls,
    qs.total_exec_time,
    qs.mean_exec_time,
    qs.rows
  FROM pg_stat_statements qs
  WHERE qs.mean_exec_time > min_duration_ms
  ORDER BY qs.mean_exec_time DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────
-- 8. Grant Permissions
-- ─────────────────────────────────────────────────────────────────────
-- Allow read access to materialized views for all authenticated users
GRANT SELECT ON public.tenant_dashboard_stats TO authenticated;
GRANT SELECT ON public.contact_activity_summary TO authenticated;
GRANT SELECT ON public.deal_pipeline_summary TO authenticated;
GRANT SELECT ON public.user_performance_summary TO authenticated;

-- Allow super admins to refresh materialized views
GRANT EXECUTE ON FUNCTION public.refresh_tenant_dashboard_stats() TO super_admin;

-- ─────────────────────────────────────────────────────────────────────
-- 9. Initial Refresh
-- ─────────────────────────────────────────────────────────────────────
-- Refresh materialized view after creation
REFRESH MATERIALIZED VIEW CONCURRENTLY public.tenant_dashboard_stats;

-- ─────────────────────────────────────────────────────────────────────
-- Testing & Verification
-- ─────────────────────────────────────────────────────────────────────
-- Check materialized view
-- SELECT * FROM public.tenant_dashboard_stats WHERE tenant_id = 'your-tenant-id';

-- Check view row counts
-- SELECT 
--   'tenant_dashboard_stats' as view_name, 
--   count(*) as row_count 
-- FROM public.tenant_dashboard_stats
-- UNION ALL
-- SELECT 'contact_activity_summary', count(*) FROM public.contact_activity_summary;

-- Test refresh function
-- SELECT public.refresh_tenant_dashboard_stats();

-- Check slow queries (requires pg_stat_statements)
-- SELECT * FROM public.get_slow_queries(100, 10);
