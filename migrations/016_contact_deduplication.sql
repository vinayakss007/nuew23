-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Contact Deduplication & Merge Migration
-- Purpose: Find and merge duplicate contacts
-- Run: psql $DATABASE_URL -f 016_contact_deduplication.sql
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- 1. Contact Merge History Table
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_merge_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  primary_contact_id UUID REFERENCES public.contacts(id) NOT NULL,
  merged_contact_id UUID REFERENCES public.contacts(id) NOT NULL,
  merged_fields JSONB DEFAULT '{}'::jsonb,
  merged_by UUID REFERENCES public.users(id),
  merged_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS contact_merge_history_tenant_idx 
  ON public.contact_merge_history(tenant_id, merged_at DESC);

CREATE INDEX IF NOT EXISTS contact_merge_history_primary_idx 
  ON public.contact_merge_history(primary_contact_id, merged_at DESC);

CREATE INDEX IF NOT EXISTS contact_merge_history_merged_idx 
  ON public.contact_merge_history(merged_contact_id, merged_at DESC);

-- ─────────────────────────────────────────────────────────────────────
-- 2. Helper Function: Find Duplicate Contacts
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.find_duplicate_contacts(
  p_tenant_id UUID,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_exclude_contact_id UUID DEFAULT NULL
)
RETURNS TABLE (
  contact_id UUID,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  company_name TEXT,
  match_type TEXT,
  match_score INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id as contact_id,
    c.first_name,
    c.last_name,
    c.email,
    c.phone,
    co.name as company_name,
    CASE 
      WHEN c.email = p_email AND c.phone = p_phone THEN 'exact'
      WHEN c.email = p_email THEN 'email'
      WHEN c.phone = p_phone THEN 'phone'
      ELSE 'partial'
    END as match_type,
    CASE 
      WHEN c.email = p_email AND c.phone = p_phone THEN 100
      WHEN c.email = p_email THEN 90
      WHEN c.phone = p_phone THEN 80
      ELSE 50
    END as match_score
  FROM public.contacts c
  LEFT JOIN public.companies co ON co.id = c.company_id
  WHERE c.tenant_id = p_tenant_id
    AND c.deleted_at IS NULL
    AND c.id != COALESCE(p_exclude_contact_id, '00000000-0000-0000-0000-000000000000')
    AND (
      (p_email IS NOT NULL AND c.email = p_email)
      OR (p_phone IS NOT NULL AND c.phone = p_phone)
    )
  ORDER BY match_score DESC, c.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Helper Function: Merge Contacts
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.merge_contacts(
  p_tenant_id UUID,
  p_primary_contact_id UUID,
  p_duplicate_contact_id UUID,
  p_user_id UUID,
  p_merge_strategy JSONB DEFAULT '{}'::jsonb,
  p_reason TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_merged_fields JSONB := '{}'::jsonb;
  v_activity_id UUID;
BEGIN
  -- Verify both contacts exist and belong to tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.contacts 
    WHERE id = p_primary_contact_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Primary contact not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.contacts 
    WHERE id = p_duplicate_contact_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Duplicate contact not found';
  END IF;

  -- Update primary contact with fields from duplicate (based on merge strategy)
  UPDATE public.contacts c
  SET
    first_name = COALESCE(
      (p_merge_strategy->>'first_name')::TEXT,
      c.first_name,
      (SELECT first_name FROM public.contacts WHERE id = p_duplicate_contact_id)
    ),
    last_name = COALESCE(
      (p_merge_strategy->>'last_name')::TEXT,
      c.last_name,
      (SELECT last_name FROM public.contacts WHERE id = p_duplicate_contact_id)
    ),
    email = COALESCE(
      NULLIF((p_merge_strategy->>'email')::TEXT, 'keep_primary'),
      c.email,
      (SELECT email FROM public.contacts WHERE id = p_duplicate_contact_id)
    ),
    phone = COALESCE(
      NULLIF((p_merge_strategy->>'phone')::TEXT, 'keep_primary'),
      c.phone,
      (SELECT phone FROM public.contacts WHERE id = p_duplicate_contact_id)
    ),
    notes = CASE
      WHEN p_merge_strategy->>'notes' = 'merge' THEN
        COALESCE(c.notes, '') || chr(10) || chr(10) || '--- Merged from duplicate ---' || chr(10) ||
        COALESCE((SELECT notes FROM public.contacts WHERE id = p_duplicate_contact_id), '')
      ELSE c.notes
    END,
    updated_at = now()
  WHERE id = p_primary_contact_id
  RETURNING jsonb_build_object(
    'first_name', first_name,
    'last_name', last_name,
    'email', email,
    'phone', phone
  ) INTO v_merged_fields;

  -- Transfer associations from duplicate to primary
  -- Update deals
  UPDATE public.deals SET contact_id = p_primary_contact_id 
  WHERE contact_id = p_duplicate_contact_id;

  -- Update tasks
  UPDATE public.tasks SET contact_id = p_primary_contact_id 
  WHERE contact_id = p_duplicate_contact_id;

  -- Update activities
  UPDATE public.activities SET contact_id = p_primary_contact_id 
  WHERE contact_id = p_duplicate_contact_id;

  -- Update notes
  UPDATE public.notes SET contact_id = p_primary_contact_id 
  WHERE contact_id = p_duplicate_contact_id;

  -- Update meetings
  UPDATE public.meetings SET contact_id = p_primary_contact_id 
  WHERE contact_id = p_duplicate_contact_id;

  -- Transfer tags (append to primary)
  UPDATE public.contacts c
  SET tags = ARRAY(
    SELECT DISTINCT unnest(c.tags || (SELECT tags FROM public.contacts WHERE id = p_duplicate_contact_id))
  )
  WHERE c.id = p_primary_contact_id;

  -- Log merge history
  INSERT INTO public.contact_merge_history (
    tenant_id,
    primary_contact_id,
    merged_contact_id,
    merged_fields,
    merged_by,
    reason
  ) VALUES (
    p_tenant_id,
    p_primary_contact_id,
    p_duplicate_contact_id,
    v_merged_fields,
    p_user_id,
    p_reason
  );

  -- Soft delete duplicate contact
  UPDATE public.contacts 
  SET deleted_at = now()
  WHERE id = p_duplicate_contact_id;

  -- Log activity on primary contact
  INSERT INTO public.activities (
    tenant_id,
    user_id,
    contact_id,
    event_type,
    description,
    metadata
  ) VALUES (
    p_tenant_id,
    p_user_id,
    p_primary_contact_id,
    'contact_merged',
    format('Merged duplicate contact (ID: %s)', p_duplicate_contact_id),
    jsonb_build_object(
      'merged_contact_id', p_duplicate_contact_id,
      'merged_fields', v_merged_fields,
      'reason', p_reason
    )
  ) RETURNING id INTO v_activity_id;

  RETURN v_activity_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────
-- 4. View: Potential Duplicates (Email or Phone Match)
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.potential_duplicates AS
SELECT 
  c1.id as contact_1_id,
  c1.first_name as contact_1_first_name,
  c1.last_name as contact_1_last_name,
  c1.email as contact_1_email,
  c1.phone as contact_1_phone,
  c2.id as contact_2_id,
  c2.first_name as contact_2_first_name,
  c2.last_name as contact_2_last_name,
  c2.email as contact_2_email,
  c2.phone as contact_2_phone,
  CASE 
    WHEN c1.email = c2.email AND c1.phone = c2.phone THEN 'exact'
    WHEN c1.email = c2.email THEN 'email'
    WHEN c1.phone = c2.phone THEN 'phone'
  END as match_type,
  c1.tenant_id
FROM public.contacts c1
JOIN public.contacts c2 ON c1.tenant_id = c2.tenant_id
  AND c1.id < c2.id
  AND c1.deleted_at IS NULL
  AND c2.deleted_at IS NULL
  AND (
    (c1.email IS NOT NULL AND c1.email = c2.email)
    OR (c1.phone IS NOT NULL AND c1.phone = c2.phone)
  )
ORDER BY c1.tenant_id, match_type DESC, c1.created_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- 5. View: Merge History Summary
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.merge_history_summary AS
SELECT 
  mh.id,
  mh.tenant_id,
  mh.primary_contact_id,
  pc.first_name as primary_first_name,
  pc.last_name as primary_last_name,
  pc.email as primary_email,
  mh.merged_contact_id,
  mc.first_name as merged_first_name,
  mc.last_name as merged_last_name,
  mc.email as merged_email,
  mh.merged_fields,
  mh.merged_by,
  u.full_name as merged_by_name,
  mh.reason,
  mh.merged_at
FROM public.contact_merge_history mh
JOIN public.contacts pc ON pc.id = mh.primary_contact_id
JOIN public.contacts mc ON mc.id = mh.merged_contact_id
LEFT JOIN public.users u ON u.id = mh.merged_by
ORDER BY mh.merged_at DESC;

-- ─────────────────────────────────────────────────────────────────────
-- Testing
-- ─────────────────────────────────────────────────────────────────────
-- Find duplicates:
-- SELECT * FROM public.find_duplicate_contacts('tenant-id', 'email@example.com', NULL, NULL);

-- View potential duplicates:
-- SELECT * FROM public.potential_duplicates WHERE tenant_id = 'tenant-id';

-- Merge contacts:
-- SELECT public.merge_contacts(
--   'tenant-id',
--   'primary-contact-id',
--   'duplicate-contact-id',
--   'user-id',
--   '{"first_name": "keep_primary", "email": "keep_primary"}'::jsonb,
--   'Duplicate entry from import'
-- );
