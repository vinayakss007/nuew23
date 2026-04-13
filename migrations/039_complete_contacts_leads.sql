-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — COMPLETE Contacts & Leads Fix
-- Purpose: Add ALL missing columns so pages NEVER break again
-- Date: April 2026
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. CONTACTS — Add columns that code references but don't exist
-- ═══════════════════════════════════════════════════════════════════

-- deleted_by — used by soft-delete routes
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id);

-- last_assigned_at — used by assign route
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_assigned_at timestamptz;

-- owner_id — used by some routes
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.users(id);

-- source — alias for lead_source, used by some routes
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS source text;

-- status — alias for lead_status, used by some routes
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS status text;

-- last_contacted_at — used by some routes
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;

-- avatar_url — used by some routes
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- ═══════════════════════════════════════════════════════════════════
-- 2. LEADS — Add columns that code references but don't exist
-- ═══════════════════════════════════════════════════════════════════

-- converted_at — used by convert route
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS converted_at timestamptz;

-- converted_to_contact_id — used by convert route
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS converted_to_contact_id uuid REFERENCES public.contacts(id);

-- form_submissions_count — used by public form route
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS form_submissions_count integer DEFAULT 0;

-- form_id — used by public form route
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS form_id uuid;

-- deleted_by — used by soft-delete
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES public.users(id);

-- ═══════════════════════════════════════════════════════════════════
-- 3. COMPANIES — Add missing columns
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ═══════════════════════════════════════════════════════════════════
-- 4. ACTIVITIES — Add missing columns used by contact timeline
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id),
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS description text;

-- ═══════════════════════════════════════════════════════════════════
-- 5. MERGE HISTORY — Create for contact merge feature
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contact_merge_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kept_contact_id uuid NOT NULL REFERENCES public.contacts(id),
  merged_contact_id uuid NOT NULL REFERENCES public.contacts(id),
  merged_by uuid REFERENCES public.users(id),
  merged_fields jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_merge_history_tenant ON public.contact_merge_history(tenant_id);

-- Create merge_contacts() function
CREATE OR REPLACE FUNCTION public.merge_contacts(
  p_tenant_id uuid,
  p_kept_contact_id uuid,
  p_merged_contact_id uuid,
  p_user_id uuid,
  p_merged_fields jsonb DEFAULT '{}',
  p_delete_merged boolean DEFAULT true
) RETURNS uuid AS $$
DECLARE
  v_kept_id uuid;
  v_merged_id uuid;
BEGIN
  -- Verify both contacts exist and belong to tenant
  SELECT id INTO v_kept_id FROM public.contacts WHERE id = p_kept_contact_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;
  SELECT id INTO v_merged_id FROM public.contacts WHERE id = p_merged_contact_id AND tenant_id = p_tenant_id AND deleted_at IS NULL;

  IF v_kept_id IS NULL OR v_merged_id IS NULL THEN
    RAISE EXCEPTION 'Both contacts must exist and belong to the tenant';
  END IF;

  -- Update kept contact with merged data where available
  UPDATE public.contacts SET
    phone = COALESCE((SELECT phone FROM public.contacts WHERE id = p_merged_contact_id), phone),
    mobile = COALESCE((SELECT mobile FROM public.contacts WHERE id = p_merged_contact_id), mobile),
    title = COALESCE((SELECT title FROM public.contacts WHERE id = p_merged_contact_id), title),
    company_id = COALESCE((SELECT company_id FROM public.contacts WHERE id = p_merged_contact_id), company_id),
    lead_status = COALESCE((SELECT lead_status FROM public.contacts WHERE id = p_merged_contact_id), lead_status),
    lead_source = COALESCE((SELECT lead_source FROM public.contacts WHERE id = p_merged_contact_id), lead_source),
    notes = COALESCE((SELECT notes FROM public.contacts WHERE id = p_merged_contact_id), notes),
    city = COALESCE((SELECT city FROM public.contacts WHERE id = p_merged_contact_id), city),
    country = COALESCE((SELECT country FROM public.contacts WHERE id = p_merged_contact_id), country),
    website = COALESCE((SELECT website FROM public.contacts WHERE id = p_merged_contact_id), website),
    linkedin_url = COALESCE((SELECT linkedin_url FROM public.contacts WHERE id = p_merged_contact_id), linkedin_url),
    twitter_url = COALESCE((SELECT twitter_url FROM public.contacts WHERE id = p_merged_contact_id), twitter_url),
    tags = COALESCE((SELECT tags FROM public.contacts WHERE id = p_merged_contact_id), tags),
    score = GREATEST(score, COALESCE((SELECT score FROM public.contacts WHERE id = p_merged_contact_id), 0)),
    updated_at = now()
  WHERE id = p_kept_contact_id;

  -- Record merge history
  INSERT INTO public.contact_merge_history (tenant_id, kept_contact_id, merged_contact_id, merged_by, merged_fields)
  VALUES (p_tenant_id, p_kept_contact_id, p_merged_contact_id, p_user_id, p_merged_fields);

  -- Optionally delete merged contact (soft delete)
  IF p_delete_merged THEN
    UPDATE public.contacts SET deleted_at = now(), deleted_by = p_user_id, is_archived = true
    WHERE id = p_merged_contact_id;
  END IF;

  RETURN p_kept_contact_id;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- 6. LEAD ACTIVITIES — Ensure table exists
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id),
  activity_type text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}',
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON public.lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_tenant ON public.lead_activities(tenant_id);

-- ═══════════════════════════════════════════════════════════════════
-- 7. LEAD ASSIGNMENTS — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.lead_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL REFERENCES public.users(id),
  assigned_by uuid REFERENCES public.users(id),
  reason text,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_contact ON public.lead_assignments(contact_id);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_assigned_to ON public.lead_assignments(assigned_to);

-- ═══════════════════════════════════════════════════════════════════
-- 8. SEQUENCE ENROLLMENTS — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sequence_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  current_step integer DEFAULT 0,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  UNIQUE(contact_id, sequence_id)
);
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_contact ON public.sequence_enrollments(contact_id);
CREATE INDEX IF NOT EXISTS idx_sequence_enrollments_status ON public.sequence_enrollments(status);

-- ═══════════════════════════════════════════════════════════════════
-- 9. CONTACT LIFECYCLE HISTORY — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contact_lifecycle_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  changed_by uuid REFERENCES public.users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_lifecycle_contact ON public.contact_lifecycle_history(contact_id);

-- ═══════════════════════════════════════════════════════════════════
-- 10. POTENTIAL DUPLICATES — Create if missing
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.potential_duplicates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  potential_duplicate_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  match_reason text NOT NULL,
  confidence_score numeric DEFAULT 0,
  is_resolved boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_potential_duplicates_tenant ON public.potential_duplicates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_potential_duplicates_contact ON public.potential_duplicates(contact_id);

-- ═══════════════════════════════════════════════════════════════════
-- 11. CREATE update_contact_lifecycle() function
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_contact_lifecycle(
  p_contact_id uuid,
  p_tenant_id uuid,
  p_new_stage text,
  p_user_id uuid
) RETURNS boolean AS $$
DECLARE
  v_current_stage text;
BEGIN
  SELECT lifecycle_stage INTO v_current_stage FROM public.contacts WHERE id = p_contact_id AND tenant_id = p_tenant_id;

  IF v_current_stage IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.contacts SET lifecycle_stage = p_new_stage, lifecycle_stage_changed_at = now(), updated_at = now()
  WHERE id = p_contact_id AND tenant_id = p_tenant_id;

  INSERT INTO public.contact_lifecycle_history (tenant_id, contact_id, from_stage, to_stage, changed_by)
  VALUES (p_tenant_id, p_contact_id, v_current_stage, p_new_stage, p_user_id);

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- 12. CREATE find_duplicate_contacts() function
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.find_duplicate_contacts(
  p_tenant_id uuid,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_name text DEFAULT NULL
) RETURNS TABLE(
  contact_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  match_reason text,
  confidence_score numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.first_name, c.last_name, c.email, c.phone,
    CASE
      WHEN c.email IS NOT NULL AND p_email IS NOT NULL AND lower(c.email) = lower(p_email) THEN 'email'
      WHEN c.phone IS NOT NULL AND p_phone IS NOT NULL AND c.phone = p_phone THEN 'phone'
      WHEN c.first_name IS NOT NULL AND p_name IS NOT NULL AND lower(c.first_name) = lower(p_name) AND c.last_name IS NOT NULL AND c.last_name = (SELECT last_name FROM public.contacts WHERE id = (SELECT id FROM public.contacts WHERE tenant_id = p_tenant_id AND first_name = p_name LIMIT 1)) THEN 'name'
      ELSE 'unknown'
    END as match_reason,
    CASE
      WHEN c.email IS NOT NULL AND p_email IS NOT NULL AND lower(c.email) = lower(p_email) THEN 95
      WHEN c.phone IS NOT NULL AND p_phone IS NOT NULL AND c.phone = p_phone THEN 80
      ELSE 50
    END as confidence_score
  FROM public.contacts c
  WHERE c.tenant_id = p_tenant_id AND c.deleted_at IS NULL
    AND (
      (p_email IS NOT NULL AND c.email IS NOT NULL AND lower(c.email) = lower(p_email))
      OR (p_phone IS NOT NULL AND c.phone IS NOT NULL AND c.phone = p_phone)
    );
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
-- 13. CREATE merge_history_summary view
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.merge_history_summary AS
SELECT
  mhs.tenant_id,
  mhs.kept_contact_id,
  kc.first_name || ' ' || kc.last_name as kept_contact_name,
  kc.email as kept_contact_email,
  mhs.merged_contact_id,
  mc.first_name || ' ' || mc.last_name as merged_contact_name,
  mc.email as merged_contact_email,
  mhs.merged_by,
  u.full_name as merged_by_name,
  mhs.merged_fields,
  mhs.created_at as merged_at
FROM public.contact_merge_history mhs
LEFT JOIN public.contacts kc ON kc.id = mhs.kept_contact_id
LEFT JOIN public.contacts mc ON mc.id = mhs.merged_contact_id
LEFT JOIN public.users u ON u.id = mhs.merged_by;

COMMIT;
