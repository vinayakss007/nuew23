-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Fix Audit Logs Column Mismatch
-- Purpose: Add resource_type/resource_id/old_data/new_data columns
--          that app code uses, and sync with entity_type/entity_id/details
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Add columns that app code uses
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS resource_id text,
  ADD COLUMN IF NOT EXISTS old_data jsonb,
  ADD COLUMN IF NOT EXISTS new_data jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- 2. Sync existing data: copy entity_type→resource_type, entity_id→resource_id, details→old_data
UPDATE public.audit_logs
SET
  resource_type = entity_type,
  resource_id = entity_id::text,
  old_data = details
WHERE resource_type IS NULL AND entity_type IS NOT NULL;

-- 3. Create trigger to keep old and new columns in sync
CREATE OR REPLACE FUNCTION public.sync_audit_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- When app writes resource_type/resource_id/old_data/new_data, sync to old columns
  IF NEW.resource_type IS NOT NULL THEN
    NEW.entity_type := NEW.resource_type;
  END IF;
  IF NEW.resource_id IS NOT NULL THEN
    BEGIN
      NEW.entity_id := NEW.resource_id::uuid;
    EXCEPTION WHEN OTHERS THEN
      -- resource_id might not be a valid UUID, skip
      NULL;
    END;
  END IF;
  IF NEW.old_data IS NOT NULL THEN
    NEW.details := NEW.old_data;
  ELSIF NEW.new_data IS NOT NULL THEN
    NEW.details := NEW.new_data;
  END IF;

  -- When old columns are written (by legacy code), sync to new columns
  IF NEW.entity_type IS NOT NULL AND NEW.resource_type IS NULL THEN
    NEW.resource_type := NEW.entity_type;
  END IF;
  IF NEW.entity_id IS NOT NULL AND NEW.resource_id IS NULL THEN
    NEW.resource_id := NEW.entity_id::text;
  END IF;
  IF NEW.details IS NOT NULL AND NEW.old_data IS NULL AND NEW.new_data IS NULL THEN
    NEW.old_data := NEW.details;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_sync_columns ON public.audit_logs;
CREATE TRIGGER audit_sync_columns
  BEFORE INSERT OR UPDATE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_audit_columns();

-- 4. Fix impersonation functions to use resource_type instead of entity_type
CREATE OR REPLACE FUNCTION public.start_impersonation(
  p_tenant_id uuid,
  p_admin_id uuid,
  p_target_user_id uuid
) RETURNS void AS $$
BEGIN
  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, metadata, impersonated_by
  ) VALUES (
    p_tenant_id, p_target_user_id, 'impersonation_started', 'user',
    p_target_user_id::text,
    jsonb_build_object('admin_id', p_admin_id),
    p_admin_id
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.end_impersonation(
  p_tenant_id uuid,
  p_admin_id uuid,
  p_target_user_id uuid
) RETURNS void AS $$
BEGIN
  INSERT INTO public.audit_logs (
    tenant_id, user_id, action, resource_type, resource_id, metadata, impersonated_by
  ) VALUES (
    p_tenant_id, p_target_user_id, 'impersonation_ended', 'user',
    p_target_user_id::text,
    jsonb_build_object('admin_id', p_admin_id),
    p_admin_id
  );
END;
$$ LANGUAGE plpgsql;

COMMIT;
