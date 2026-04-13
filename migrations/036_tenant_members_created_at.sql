-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Tenant Members Created At Column
-- Purpose: Code references tm.created_at but table only has joined_at
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.tenant_members
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

UPDATE public.tenant_members SET created_at = joined_at WHERE created_at = joined_at;
