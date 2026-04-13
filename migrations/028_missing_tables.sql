-- 028_missing_tables.sql
-- Create tables referenced in code but missing from migrations

-- Webhook deliveries table (used by lib/webhooks/delivery.ts)
CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id  uuid NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  url         text NOT NULL,
  method      text NOT NULL DEFAULT 'POST',
  headers     jsonb DEFAULT '{}',
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending',
  attempt     int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 3,
  response_status int,
  response_body text,
  error_message text,
  delivered_at timestamptz,
  failed_at   timestamptz,
  next_retry_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON public.webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON public.webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry ON public.webhook_deliveries(next_retry_at) WHERE status = 'pending';

-- Failed webhooks table
CREATE TABLE IF NOT EXISTS public.failed_webhooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id  uuid NOT NULL,
  tenant_id   uuid NOT NULL,
  url         text NOT NULL,
  payload     jsonb NOT NULL,
  error_message text NOT NULL,
  attempt_count int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_failed_webhooks_tenant ON public.failed_webhooks(tenant_id);

-- Automation runs table (used by lib/automation/engine.ts)
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id     uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  status      text NOT NULL DEFAULT 'running',
  trigger_entity text,
  trigger_entity_id uuid,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error_message text,
  steps_completed int NOT NULL DEFAULT 0,
  total_steps int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_rule ON public.automation_runs(rule_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_tenant ON public.automation_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON public.automation_runs(status);
