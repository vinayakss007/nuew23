import { NextResponse } from 'next/server';
import { query } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

/**
 * Prometheus-compatible metrics endpoint
 * Exposes CRM metrics in text format for Prometheus scraping
 *
 * Usage: Add to Prometheus scrape config:
 *   - job_name: 'nucrm-app'
 *     static_configs:
 *       - targets: ['app:3000']
 *     metrics_path: '/api/metrics'
 */
export async function GET() {
  const metrics: string[] = [];
  const push = (name: string, help: string, type: string, value: number, labels = '') => {
    if (help) metrics.push(`# HELP ${name} ${help}`);
    if (type) metrics.push(`# TYPE ${name} ${type}`);
    metrics.push(labels ? `${name}${labels} ${value}` : `${name} ${value}`);
  };

  try {
    // ── CRM Counts ─────────────────────────────────────────────
    const [
      contacts, leads, deals, companies, tasks, activities, tenants, users,
      dealsWon, dealsLost, tasksCompleted, contactsCreated, leadsCreated, dealsCreated
    ] = await Promise.all([
      query('SELECT count(*)::int FROM public.contacts').then(r => r.rows[0].count),
      query('SELECT count(*)::int FROM public.leads WHERE deleted_at IS NULL').then(r => r.rows[0].count),
      query('SELECT count(*)::int FROM public.deals WHERE deleted_at IS NULL').then(r => r.rows[0].count),
      query('SELECT count(*)::int FROM public.companies WHERE deleted_at IS NULL').then(r => r.rows[0].count),
      query("SELECT count(*)::int FROM public.tasks WHERE completed = false AND deleted_at IS NULL").then(r => r.rows[0].count),
      query('SELECT count(*)::int FROM public.activities').then(r => r.rows[0].count),
      query("SELECT count(*)::int FROM public.tenants WHERE status = 'active'").then(r => r.rows[0].count),
      query('SELECT count(*)::int FROM public.users').then(r => r.rows[0].count),
      query("SELECT count(*)::int FROM public.deals WHERE stage = 'won' AND deleted_at IS NULL").then(r => r.rows[0].count),
      query("SELECT count(*)::int FROM public.deals WHERE stage = 'lost' AND deleted_at IS NULL").then(r => r.rows[0].count),
      query('SELECT count(*)::int FROM public.tasks WHERE completed = true').then(r => r.rows[0].count),
      query("SELECT count(*)::int FROM public.contacts WHERE created_at > now() - interval '24 hours'").then(r => r.rows[0].count),
      query("SELECT count(*)::int FROM public.leads WHERE created_at > now() - interval '24 hours'").then(r => r.rows[0].count),
      query("SELECT count(*)::int FROM public.deals WHERE created_at > now() - interval '24 hours'").then(r => r.rows[0].count),
    ]);

    push('nucrm_contacts_total', 'Total contacts in CRM', 'gauge', contacts);
    push('nucrm_leads_total', 'Total leads (not deleted)', 'gauge', leads);
    push('nucrm_deals_total', 'Total deals (not deleted)', 'gauge', deals);
    push('nucrm_companies_total', 'Total companies (not deleted)', 'gauge', companies);
    push('nucrm_tasks_pending_total', 'Pending incomplete tasks', 'gauge', tasks);
    push('nucrm_activities_total', 'Total activities logged', 'gauge', activities);
    push('nucrm_tenants_total', 'Active tenants', 'gauge', tenants);
    push('nucrm_users_total', 'Total users', 'gauge', users);
    push('nucrm_deals_won_total', 'Deals marked as won', 'gauge', dealsWon);
    push('nucrm_deals_lost_total', 'Deals marked as lost', 'gauge', dealsLost);
    push('nucrm_tasks_completed_total', 'Completed tasks', 'counter', tasksCompleted);
    push('nucrm_contacts_created_total', 'Contacts created in last 24h', 'counter', contactsCreated);
    push('nucrm_leads_created_total', 'Leads created in last 24h', 'counter', leadsCreated);
    push('nucrm_deals_created_total', 'Deals created in last 24h', 'counter', dealsCreated);

    // ── Deal Pipeline Value ────────────────────────────────────
    const pipelineValue = await query(
      "SELECT COALESCE(SUM(value), 0)::float FROM public.deals WHERE stage NOT IN ('lost') AND deleted_at IS NULL"
    ).then(r => parseFloat(r.rows[0].sum || '0'));
    push('nucrm_deals_value_total', 'Total pipeline value (USD)', 'gauge', pipelineValue);

    // ── Database Metrics ───────────────────────────────────────
    const t0 = Date.now();
    await query('SELECT 1');
    const dbLatency = Date.now() - t0;
    push('nucrm_db_latency_ms', 'Database query latency in ms', 'gauge', dbLatency);

    const poolSize = await query('SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()')
      .then(r => r.rows[0].count);
    push('nucrm_db_active_connections', 'Active DB connections', 'gauge', poolSize);
    push('nucrm_db_max_connections', 'Max DB connections', 'gauge', parseInt(process.env['DATABASE_POOL_SIZE'] || '20'));

    // ── HTTP Metrics ───────────────────────────────────────────
    push('nucrm_http_requests_total', 'Total HTTP requests', 'counter', 0);
    push('nucrm_http_errors_total', 'Total HTTP errors', 'counter', 0);

    // ── System ─────────────────────────────────────────────────
    push('nucrm_uptime_seconds', 'App uptime in seconds', 'counter', Math.floor(process.uptime()));
    push('nucrm_node_version_info', 'Node.js version (label)', 'gauge', 1, `{version="${process.version}"}`);
    push('nucrm_memory_heap_used_bytes', 'Node.js heap memory used', 'gauge', process.memoryUsage().heapUsed);
    push('nucrm_memory_heap_total_bytes', 'Node.js heap memory total', 'gauge', process.memoryUsage().heapTotal);
    push('nucrm_memory_rss_bytes', 'Node.js RSS memory', 'gauge', process.memoryUsage().rss);

    // ── Worker Metrics ─────────────────────────────────────────
    push('nucrm_worker_jobs_processed_total', 'Worker jobs processed', 'counter', 0, '{job_type="send-email"}');
    push('nucrm_worker_jobs_processed_total', 'Worker jobs processed', 'counter', 0, '{job_type="send-notification"}');
    push('nucrm_worker_jobs_failed_total', 'Worker jobs failed', 'counter', 0);

    return new Response(metrics.join('\n') + '\n', {
      headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
    });
  } catch (err: any) {
    return new Response(`# ERROR ${err.message}\n`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}
