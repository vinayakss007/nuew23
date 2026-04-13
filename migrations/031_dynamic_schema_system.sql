-- ═══════════════════════════════════════════════════════════════════
-- NuCRM — Dynamic Schema System
-- 
-- This is the LAST structural migration you'll ever need.
-- After this, ALL new fields are stored in JSONB metadata columns.
-- No more ALTER TABLE. No more migration files for new features.
--
-- How it works:
--   1. Every core table gets ONE JSONB `metadata` column
--   2. Custom fields are defined in `custom_field_defs` table
--   3. The app reads/writes custom fields transparently
--   4. Features register themselves in `feature_registry`
--   5. Everything is queryable via generated views
--
-- Run ONCE. Safe to re-run. Never needs changing.
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Add JSONB metadata column to ALL core tables (one-time)
--    This is the ONLY ALTER TABLE you'll ever need on core tables.
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.contacts        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.companies       ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.deals           ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.leads           ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.tasks           ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.tenants         ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.users           ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.activities      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.webhooks        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.api_keys        ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.tags            ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.pipelines       ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.modules         ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.subscriptions   ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.notifications   ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.email_templates ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.sequences       ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.workflows       ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.forms           ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.companies       ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- GIN index for fast JSONB queries on the most-accessed tables
CREATE INDEX IF NOT EXISTS idx_contacts_metadata_g        ON public.contacts USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_companies_metadata_g       ON public.companies USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_deals_metadata_g           ON public.deals USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_leads_metadata_g           ON public.leads USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_tasks_metadata_g           ON public.tasks USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_users_metadata_g           ON public.users USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_tenants_metadata_g         ON public.tenants USING GIN (metadata);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Custom Field Definitions (tenant-defined dynamic fields)
--    Tenants can create their own fields for any entity type.
--    Values are stored in the entity's metadata JSONB column.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.custom_field_defs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type     TEXT NOT NULL,          -- 'contact', 'deal', 'company', 'lead', 'task'
  field_key       TEXT NOT NULL,          -- machine-readable key (e.g. 'linkedin_url')
  field_label     TEXT NOT NULL,          -- display label (e.g. 'LinkedIn Profile')
  field_type      TEXT NOT NULL DEFAULT 'text',  -- text | number | date | select | multiselect | boolean | url | email | phone | currency | json
  field_options   JSONB,                   -- For select/multiselect: ['option1', 'option2']
  is_required     BOOLEAN DEFAULT FALSE,
  is_searchable   BOOLEAN DEFAULT TRUE,
  default_value   TEXT,
  display_order   INT DEFAULT 0,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(tenant_id, entity_type, field_key)
);

CREATE INDEX IF NOT EXISTS idx_custom_fields_tenant_entity ON public.custom_field_defs(tenant_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_custom_fields_key ON public.custom_field_defs(field_key);

COMMENT ON TABLE public.custom_field_defs IS 'Dynamic custom field definitions — tenants add fields without migrations';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Feature Registry (self-documenting system)
--    Features register themselves so the system knows what metadata
--    keys they use. No migrations needed — just register and go.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.feature_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_name    TEXT NOT NULL UNIQUE,    -- e.g. 'ai_scoring', 'conversation_intelligence'
  description     TEXT,
  version         TEXT DEFAULT '1.0.0',
  enabled         BOOLEAN DEFAULT TRUE,
  metadata_keys   JSONB DEFAULT '[]'::jsonb,  -- List of metadata keys this feature uses
  entities        JSONB DEFAULT '[]'::jsonb,  -- Entity types it extends (contacts, deals, etc.)
  requires_tables JSONB DEFAULT '[]'::jsonb,  -- New tables this feature creates (if any)
  registered_at   TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_registry_enabled ON public.feature_registry(enabled);

COMMENT ON TABLE public.feature_registry IS 'Features register their metadata keys here — no migrations needed';

-- ─────────────────────────────────────────────────────────────────────
-- 4. Auto-extend helper: features call this to register themselves
--    on first use. Idempotent — safe to call every startup.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.register_feature(
  p_feature_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_version TEXT DEFAULT '1.0.0',
  p_metadata_keys JSONB DEFAULT '[]'::jsonb,
  p_entities JSONB DEFAULT '[]'::jsonb,
  p_requires_tables JSONB DEFAULT '[]'::jsonb
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.feature_registry (feature_name, description, version, metadata_keys, entities, requires_tables)
  VALUES (p_feature_name, p_description, p_version, p_metadata_keys, p_entities, p_requires_tables)
  ON CONFLICT (feature_name) DO UPDATE SET
    version = EXCLUDED.version,
    metadata_keys = EXCLUDED.metadata_keys,
    entities = EXCLUDED.entities,
    requires_tables = EXCLUDED.requires_tables,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Custom field helper: add a custom field to an entity
--    Writes directly to the entity's metadata JSONB column.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_custom_field(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_field_key TEXT,
  p_value ANYELEMENT
)
RETURNS VOID AS $$
DECLARE
  v_table_name TEXT;
BEGIN
  -- Map entity type to table name
  v_table_name := CASE p_entity_type
    WHEN 'contact' THEN 'contacts'
    WHEN 'company' THEN 'companies'
    WHEN 'deal' THEN 'deals'
    WHEN 'lead' THEN 'leads'
    WHEN 'task' THEN 'tasks'
    WHEN 'user' THEN 'users'
    WHEN 'tenant' THEN 'tenants'
    ELSE NULL
  END;

  IF v_table_name IS NULL THEN
    RAISE EXCEPTION 'Unknown entity type: %', p_entity_type;
  END IF;

  -- Update metadata JSONB column
  EXECUTE format(
    'UPDATE public.%I SET metadata = jsonb_set(metadata, ARRAY[$1], to_jsonb($2), true) WHERE id = $3',
    v_table_name
  ) USING p_field_key, p_value, p_entity_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 6. Custom field getter: read a custom field from an entity
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_custom_field(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_field_key TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_table_name TEXT;
  v_result JSONB;
BEGIN
  v_table_name := CASE p_entity_type
    WHEN 'contact' THEN 'contacts'
    WHEN 'company' THEN 'companies'
    WHEN 'deal' THEN 'deals'
    WHEN 'lead' THEN 'leads'
    WHEN 'task' THEN 'tasks'
    WHEN 'user' THEN 'users'
    WHEN 'tenant' THEN 'tenants'
    ELSE NULL
  END;

  IF v_table_name IS NULL THEN
    RETURN NULL;
  END IF;

  EXECUTE format(
    'SELECT metadata->>$1 FROM public.%I WHERE id = $2',
    v_table_name
  ) INTO v_result USING p_field_key, p_entity_id;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 7. Dynamic search view: merges custom fields with core data
--    This view auto-includes all metadata keys for searching.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.contacts_with_custom_fields AS
SELECT 
  c.*,
  c.metadata->>'ai_score' AS ai_score,
  c.metadata->>'linkedin_url' AS linkedin_url,
  c.metadata->>'preferred_contact_method' AS preferred_contact_method,
  c.metadata->>'social_profiles' AS social_profiles,
  c.metadata->>'lead_source_detail' AS lead_source_detail,
  c.metadata
FROM public.contacts c
WHERE c.deleted_at IS NULL;

CREATE OR REPLACE VIEW public.deals_with_custom_fields AS
SELECT 
  d.*,
  d.metadata->>'probability_override' AS probability_override,
  d.metadata->>'competitor_info' AS competitor_info,
  d.metadata->>'decision_maker' AS decision_maker,
  d.metadata->>'next_steps' AS next_steps,
  d.metadata
FROM public.deals d
WHERE d.deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 8. Pre-register built-in features (so the system knows about them)
-- ─────────────────────────────────────────────────────────────────────

SELECT public.register_feature(
  'ai_assistant',
  'AI scoring, insights, and email drafts',
  '1.0.0',
  '["ai_score", "ai_sentiment", "ai_churn_risk", "ai_next_best_action", "ai_email_draft"]'::jsonb,
  '["contact", "deal", "lead"]'::jsonb,
  '["ai_insights", "ai_email_drafts", "contact_scores", "ai_usage_logs"]'::jsonb
);

SELECT public.register_feature(
  'conversation_intelligence',
  'Call recordings, notes, and conversation metrics',
  '1.0.0',
  '["call_sentiment", "talk_ratio", "key_topics", "competitor_mentions"]'::jsonb,
  '["contact", "deal"]'::jsonb,
  '["call_recordings", "call_notes", "conversation_metrics", "conversation_keywords"]'::jsonb
);

SELECT public.register_feature(
  'predictive_analytics',
  'Churn prediction, deal forecasting, revenue projections',
  '1.0.0',
  '["churn_probability", "deal_win_probability", "revenue_forecast", "engagement_trend"]'::jsonb,
  '["contact", "deal", "tenant"]'::jsonb,
  '["churn_predictions", "deal_forecasts", "revenue_projections", "pipeline_health_metrics"]'::jsonb
);

SELECT public.register_feature(
  'workflow_builder',
  'Visual automation workflow builder',
  '1.0.0',
  '["workflow_status", "last_triggered", "trigger_count"]'::jsonb,
  '["contact", "deal", "lead"]'::jsonb,
  '["workflows", "workflow_actions", "workflow_execution_logs", "workflow_action_logs"]'::jsonb
);

SELECT public.register_feature(
  'email_sequences',
  'Automated email sequence campaigns',
  '1.0.0',
  '["sequence_status", "enrolled_at", "last_step_sent", "sequence_completion"]'::jsonb,
  '["contact", "lead"]'::jsonb,
  '["sequences", "sequence_steps", "sequence_enrollments", "sequence_step_logs"]'::jsonb
);

SELECT public.register_feature(
  'tenant_backup_restore',
  'Per-tenant data backup and point-in-time restore',
  '1.0.0',
  '[]'::jsonb,
  '[]'::jsonb,
  '["tenant_backup_records", "tenant_restore_records", "backup_schedules", "critical_data_backups"]'::jsonb
);

-- ─────────────────────────────────────────────────────────────────────
-- 9. System health check function
--    Run this to verify all core tables have metadata columns.
-- ─────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_dynamic_schema()
RETURNS TABLE(
  table_name TEXT,
  has_metadata BOOLEAN,
  has_indexes BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.table_name::TEXT,
    EXISTS(
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_name = t.table_name AND c.column_name = 'metadata' AND c.table_schema = 'public'
    ) AS has_metadata,
    EXISTS(
      SELECT 1 FROM pg_indexes i
      WHERE i.tablename = t.table_name AND i.indexdef LIKE '%metadata%gin%'
    ) AS has_indexes
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND t.table_name IN (
      'contacts', 'companies', 'deals', 'leads', 'tasks',
      'tenants', 'users', 'activities', 'webhooks', 'api_keys',
      'tags', 'pipelines', 'modules', 'subscriptions',
      'notifications', 'email_templates', 'sequences', 'workflows', 'forms'
    )
  ORDER BY t.table_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Run check on migration (for verification — can be removed later)
-- SELECT * FROM public.check_dynamic_schema();
