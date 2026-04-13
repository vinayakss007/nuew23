-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Plans Table Missing Columns
-- Purpose: Add max_deals, max_automations, price_monthly, price_yearly, is_active, sort_order
-- These columns are referenced in billing, usage, plans, and workspace APIs
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS max_deals integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_automations integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_monthly integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_yearly integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0;

-- Set reasonable defaults for existing plans
UPDATE public.plans SET 
  max_deals = CASE WHEN max_users > 25 THEN 10000 ELSE max_users * 40 END,
  max_automations = CASE WHEN max_users > 25 THEN 50 ELSE 10 END,
  price_monthly = price_cents,
  price_yearly = price_cents * 10,
  is_active = true,
  sort_order = CASE WHEN slug = 'free' THEN 0 WHEN slug = 'starter' THEN 1 WHEN slug = 'basic' THEN 2 WHEN slug = 'enterprise' THEN 3 ELSE 99 END
WHERE true;
