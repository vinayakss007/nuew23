-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Phase 4 Enterprise Features Complete Migration
-- Purpose: Custom dashboards, white-labeling, SSO, advanced permissions
-- Run: psql $DATABASE_URL -f 023_phase4_enterprise.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Custom Dashboards Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  layout JSONB DEFAULT '{}'::jsonb, -- Grid layout configuration
  widgets JSONB DEFAULT '[]'::jsonb, -- Widget configurations
  is_default BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT false,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS dashboards_tenant_idx ON public.dashboards(tenant_id, is_default);
CREATE INDEX IF NOT EXISTS dashboards_public_idx ON public.dashboards(tenant_id, is_public);

-- Insert default dashboard templates
INSERT INTO public.dashboards (name, description, is_default, is_public, layout, widgets) VALUES
('Sales Overview', 'Default sales dashboard with key metrics', true, true,
 '{"grid": {"columns": 3, "rows": 4}}',
 '[{"type": "metric", "title": "Total Contacts", "query": "count:contacts"},
   {"type": "metric", "title": "Pipeline Value", "query": "sum:deals.value"},
   {"type": "chart", "title": "Pipeline by Stage", "chart": "funnel", "query": "group:deals.stage"},
   {"type": "list", "title": "Recent Deals", "query": "list:deals.recent"}]'),

('Activity Dashboard', 'Track team activities and performance', false, true,
 '{"grid": {"columns": 2, "rows": 3}}',
 '[{"type": "chart", "title": "Activities by Type", "chart": "pie", "query": "group:activities.type"},
   {"type": "list", "title": "Recent Activities", "query": "list:activities.recent"}]'),

('Performance Dashboard', 'Sales rep performance metrics', false, true,
 '{"grid": {"columns": 2, "rows": 3}}',
 '[{"type": "metric", "title": "Deals Won", "query": "count:deals.won"},
   {"type": "chart", "title": "Rep Performance", "chart": "bar", "query": "group:deals.assigned_to"}]');

-- ─────────────────────────────────────────────────────────────────────
-- 2. Dashboard Templates Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dashboard_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  layout JSONB NOT NULL,
  widgets JSONB NOT NULL,
  is_global BOOLEAN DEFAULT true,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS dashboard_templates_category_idx ON public.dashboard_templates(category);

-- ─────────────────────────────────────────────────────────────────────
-- 3. Enhanced Tenant Branding (White-Labeling)
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenants 
  ADD COLUMN IF NOT EXISTS custom_domain TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS favicon_url TEXT,
  ADD COLUMN IF NOT EXISTS email_signature TEXT,
  ADD COLUMN IF NOT EXISTS custom_css TEXT,
  ADD COLUMN IF NOT EXISTS branded_emails BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS tenants_custom_domain_idx ON public.tenants(custom_domain) WHERE custom_domain IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 4. SSO/SAML Providers Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sso_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  provider_type TEXT NOT NULL CHECK (provider_type IN ('saml', 'google', 'microsoft', 'okta')),
  provider_name TEXT NOT NULL,
  config JSONB NOT NULL, -- SAML config or OAuth credentials
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(tenant_id, provider_type)
);

CREATE INDEX IF NOT EXISTS sso_providers_tenant_idx ON public.sso_providers(tenant_id, is_active);

-- SAML sessions
CREATE TABLE IF NOT EXISTS public.sso_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  provider_id UUID REFERENCES public.sso_providers(id) ON DELETE CASCADE,
  saml_response TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sso_sessions_user_idx ON public.sso_sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS sso_sessions_provider_idx ON public.sso_sessions(provider_id);

-- ─────────────────────────────────────────────────────────────────────
-- 5. Advanced Permissions (Field-Level)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL, -- 'contact', 'deal', 'company', 'task'
  field_name TEXT NOT NULL,
  can_read BOOLEAN DEFAULT true,
  can_write BOOLEAN DEFAULT false,
  can_export BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(role_id, entity_type, field_name)
);

CREATE INDEX IF NOT EXISTS field_permissions_role_idx ON public.field_permissions(role_id, entity_type);

-- Record-level permissions
CREATE TABLE IF NOT EXISTS public.record_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
  permissions JSONB DEFAULT '{"read": true, "write": false, "delete": false}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(entity_type, entity_id, user_id)
);

CREATE INDEX IF NOT EXISTS record_permissions_user_idx ON public.record_permissions(user_id, entity_type);
CREATE INDEX IF NOT EXISTS record_permissions_entity_idx ON public.record_permissions(entity_type, entity_id);

-- ─────────────────────────────────────────────────────────────────────
-- 6. Product Catalog
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sku TEXT UNIQUE,
  unit_price DECIMAL(12,2) NOT NULL,
  cost DECIMAL(12,2),
  currency TEXT DEFAULT 'USD',
  is_active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS products_tenant_idx ON public.products(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS products_sku_idx ON public.products(sku);

-- Price books
CREATE TABLE IF NOT EXISTS public.price_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  currency TEXT DEFAULT 'USD',
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS price_books_tenant_idx ON public.price_books(tenant_id, is_active);

-- Price book entries
CREATE TABLE IF NOT EXISTS public.price_book_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  price_book_id UUID REFERENCES public.price_books(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  unit_price DECIMAL(12,2) NOT NULL,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(price_book_id, product_id)
);

-- ─────────────────────────────────────────────────────────────────────
-- 7. Quotes & Proposals
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE NOT NULL,
  deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  quote_number TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired')),
  subject TEXT,
  description TEXT,
  subtotal DECIMAL(14,2) DEFAULT 0,
  discount DECIMAL(14,2) DEFAULT 0,
  tax DECIMAL(14,2) DEFAULT 0,
  total DECIMAL(14,2) DEFAULT 0,
  valid_until DATE,
  template_id UUID,
  pdf_url TEXT,
  signed_at TIMESTAMPTZ,
  signed_by UUID REFERENCES public.users(id),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS quotes_tenant_idx ON public.quotes(tenant_id, status);
CREATE INDEX IF NOT EXISTS quotes_deal_idx ON public.quotes(deal_id);
CREATE INDEX IF NOT EXISTS quotes_contact_idx ON public.quotes(contact_id);
CREATE INDEX IF NOT EXISTS quotes_status_idx ON public.quotes(tenant_id, status);

-- Quote line items
CREATE TABLE IF NOT EXISTS public.quote_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID REFERENCES public.quotes(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  description TEXT,
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(12,2) NOT NULL,
  discount_percent DECIMAL(5,2) DEFAULT 0,
  total DECIMAL(14,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS quote_line_items_quote_idx ON public.quote_line_items(quote_id);

-- ─────────────────────────────────────────────────────────────────────
-- 8. Helper Function: Generate Quote Number
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_quote_number()
RETURNS TEXT AS $$
DECLARE
  v_year TEXT;
  v_sequence INTEGER;
  v_quote_number TEXT;
BEGIN
  v_year := TO_CHAR(now(), 'YYYY');
  
  SELECT COALESCE(MAX(CAST(SUBSTRING(quote_number FROM 8) AS INTEGER)), 0) + 1
  INTO v_sequence
  FROM public.quotes
  WHERE quote_number LIKE CONCAT('QT-', v_year, '-%');
  
  v_quote_number := CONCAT('QT-', v_year, '-', LPAD(v_sequence::TEXT, 5, '0'));
  
  RETURN v_quote_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 9. Helper Function: Calculate Quote Total
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_quote_total(p_quote_id UUID)
RETURNS void AS $$
DECLARE
  v_subtotal DECIMAL;
  v_discount DECIMAL;
  v_tax DECIMAL;
  v_total DECIMAL;
BEGIN
  SELECT 
    COALESCE(SUM(total), 0),
    0, -- Discount at quote level
    COALESCE(SUM(total), 0) * 0.1, -- 10% tax
    COALESCE(SUM(total), 0) * 1.1
  INTO v_subtotal, v_discount, v_tax, v_total
  FROM public.quote_line_items
  WHERE quote_id = p_quote_id;
  
  UPDATE public.quotes
  SET 
    subtotal = v_subtotal,
    discount = v_discount,
    tax = v_tax,
    total = v_total,
    updated_at = now()
  WHERE id = p_quote_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 10. View: Dashboard Usage Stats
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.dashboard_usage_stats AS
SELECT 
  d.id,
  d.name,
  d.is_default,
  d.is_public,
  u.full_name as created_by_name,
  jsonb_array_length(d.widgets) as widget_count,
  d.created_at
FROM public.dashboards d
LEFT JOIN public.users u ON u.id = d.created_by
ORDER BY d.created_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 11. View: Quote Pipeline
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.quote_pipeline AS
SELECT 
  q.id,
  q.quote_number,
  q.status,
  q.total,
  q.valid_until,
  c.first_name,
  c.last_name,
  c.email,
  co.name as company_name,
  d.title as deal_title,
  q.created_at,
  CASE 
    WHEN q.status = 'accepted' THEN 'won'
    WHEN q.status = 'rejected' OR q.valid_until < CURRENT_DATE THEN 'lost'
    ELSE 'open'
  END as outcome
FROM public.quotes q
LEFT JOIN public.contacts c ON c.id = q.contact_id
LEFT JOIN public.companies co ON co.id = c.company_id
LEFT JOIN public.deals d ON d.id = q.deal_id
ORDER BY q.created_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 12. View: Product Performance
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.product_performance AS
SELECT 
  p.id,
  p.name,
  p.sku,
  p.unit_price,
  COUNT(qli.id) as times_quoted,
  COALESCE(SUM(qli.total), 0) as total_revenue,
  p.is_active
FROM public.products p
LEFT JOIN public.quote_line_items qli ON qli.product_id = p.id
LEFT JOIN public.quotes q ON q.id = qli.quote_id AND q.status = 'accepted'
GROUP BY p.id, p.name, p.sku, p.unit_price, p.is_active
ORDER BY total_revenue DESC;

-- ─────────────────────────────────────────────────────────────────────
-- Testing
-- ─────────────────────────────────────────────────────────────────────
-- View dashboards:
-- SELECT * FROM public.dashboard_usage_stats;

-- View quote pipeline:
-- SELECT * FROM public.quote_pipeline;

-- View product performance:
-- SELECT * FROM public.product_performance;

-- Generate quote number:
-- SELECT public.generate_quote_number();
