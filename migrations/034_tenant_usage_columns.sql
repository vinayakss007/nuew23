-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Missing Tenant Usage Columns
-- Purpose: Add current_users, current_contacts, current_deals to tenants
-- These columns are referenced throughout the codebase but missing from base schema
-- ═══════════════════════════════════════════════════════════════════

-- Add missing columns
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS current_users integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_contacts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_deals integer DEFAULT 0;

-- Populate with actual counts
UPDATE public.tenants t SET current_users = (
  SELECT count(*)::int FROM public.tenant_members tm 
  WHERE tm.tenant_id = t.id AND tm.status = 'active'
) WHERE current_users = 0;

UPDATE public.tenants t SET current_contacts = (
  SELECT count(*)::int FROM public.contacts c 
  WHERE c.tenant_id = t.id AND c.deleted_at IS NULL
) WHERE current_contacts = 0;

UPDATE public.tenants t SET current_deals = (
  SELECT count(*)::int FROM public.deals d 
  WHERE d.tenant_id = t.id AND d.deleted_at IS NULL
) WHERE current_deals = 0;

-- Trigger: Update current_users when tenant_members change
CREATE OR REPLACE FUNCTION update_tenant_user_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.tenants SET current_users = (
      SELECT count(*)::int FROM public.tenant_members 
      WHERE tenant_id = NEW.tenant_id AND status = 'active'
    ) WHERE id = NEW.tenant_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.tenants SET current_users = (
      SELECT count(*)::int FROM public.tenant_members 
      WHERE tenant_id = OLD.tenant_id AND status = 'active'
    ) WHERE id = OLD.tenant_id;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.tenants SET current_users = (
      SELECT count(*)::int FROM public.tenant_members 
      WHERE tenant_id = NEW.tenant_id AND status = 'active'
    ) WHERE id = NEW.tenant_id;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_tenant_user_count ON public.tenant_members;
CREATE TRIGGER trg_update_tenant_user_count
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION update_tenant_user_count();

-- Trigger: Update current_contacts when contacts change
CREATE OR REPLACE FUNCTION update_tenant_contact_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.tenants SET current_contacts = (
      SELECT count(*)::int FROM public.contacts 
      WHERE tenant_id = NEW.tenant_id AND deleted_at IS NULL
    ) WHERE id = NEW.tenant_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.tenants SET current_contacts = (
      SELECT count(*)::int FROM public.contacts 
      WHERE tenant_id = OLD.tenant_id AND deleted_at IS NULL
    ) WHERE id = OLD.tenant_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_tenant_contact_count ON public.contacts;
CREATE TRIGGER trg_update_tenant_contact_count
  AFTER INSERT OR DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION update_tenant_contact_count();

-- Trigger: Update current_deals when deals change
CREATE OR REPLACE FUNCTION update_tenant_deal_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.tenants SET current_deals = (
      SELECT count(*)::int FROM public.deals 
      WHERE tenant_id = NEW.tenant_id AND deleted_at IS NULL
    ) WHERE id = NEW.tenant_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.tenants SET current_deals = (
      SELECT count(*)::int FROM public.deals 
      WHERE tenant_id = OLD.tenant_id AND deleted_at IS NULL
    ) WHERE id = OLD.tenant_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_tenant_deal_count ON public.deals;
CREATE TRIGGER trg_update_tenant_deal_count
  AFTER INSERT OR DELETE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION update_tenant_deal_count();
