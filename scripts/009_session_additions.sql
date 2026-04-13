-- ══════════════════════════════════════════════════════════════
-- Migration 009: Session additions consolidation
-- All new tables and columns added across build sessions.
-- Safe to run multiple times (IF NOT EXISTS / idempotent).
-- ══════════════════════════════════════════════════════════════

-- ─── Ensure file_attachments has storage path columns ────────
ALTER TABLE public.file_attachments
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS storage_type text DEFAULT 'local';

-- ─── Ensure contacts have do_not_contact and lifecycle ───────
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS do_not_contact   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS lifecycle_stage  text,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- ─── Unsubscribe tracking on sequence_enrollments ───────────
ALTER TABLE public.sequence_enrollments
  ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;

-- ─── Email tracking table ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_tracking (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              uuid REFERENCES public.tenants ON DELETE CASCADE NOT NULL,
  contact_id             uuid REFERENCES public.contacts ON DELETE CASCADE,
  sequence_enrollment_id uuid REFERENCES public.sequence_enrollments ON DELETE SET NULL,
  message_id             text,
  recipient              text NOT NULL,
  subject                text,
  opened_at              timestamptz,
  open_count             integer DEFAULT 0,
  clicked_at             timestamptz,
  click_count            integer DEFAULT 0,
  clicks                 jsonb DEFAULT '[]'::jsonb,
  created_at             timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_tracking_tenant_idx
  ON public.email_tracking(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_tracking_contact_idx
  ON public.email_tracking(contact_id);

-- ─── Audit log additions ─────────────────────────────────────
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS impersonated_by uuid REFERENCES public.users ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata        jsonb DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS audit_logs_impersonated_idx
  ON public.audit_logs(impersonated_by) WHERE impersonated_by IS NOT NULL;

-- ─── Stripe billing on tenants ───────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id      text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  text;
CREATE INDEX IF NOT EXISTS tenants_stripe_customer_idx
  ON public.tenants(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ─── Task notification dedup ─────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

-- ─── Pipeline customization ──────────────────────────────────
-- pipelines table already in 004, ensure stages column type ──
ALTER TABLE public.pipelines
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- ─── TOTP / 2FA columns on users ────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS totp_enabled      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_secret       text,
  ADD COLUMN IF NOT EXISTS totp_backup_codes jsonb,
  ADD COLUMN IF NOT EXISTS totp_verified_at  timestamptz;

-- ─── API key columns ─────────────────────────────────────────
ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS call_count bigint DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_ip    text;

-- ─── Seed system roles for any tenants missing them ─────────
-- (idempotent — ON CONFLICT DO NOTHING)
INSERT INTO public.roles (tenant_id, name, slug, is_system, sort_order, permissions)
SELECT
  t.id,
  r.name,
  r.slug,
  true,
  r.sort_order,
  r.permissions::jsonb
FROM public.tenants t
CROSS JOIN (VALUES
  ('Admin',        'admin',        1, '{"all":true}'),
  ('Manager',      'manager',      2, '{"contacts.view_all":true,"contacts.create":true,"contacts.edit":true,"contacts.assign":true,"deals.view_all":true,"deals.create":true,"deals.edit":true,"tasks.view_all":true,"tasks.create":true,"tasks.edit":true,"companies.create":true,"companies.edit":true,"reports.view":true,"team.view":true,"automations.view":true}'),
  ('Sales Rep',    'sales_rep',    3, '{"contacts.create":true,"contacts.edit":true,"deals.create":true,"deals.edit":true,"deals.view_value":true,"tasks.create":true,"tasks.edit":true,"companies.create":true,"companies.edit":true,"team.view":true}'),
  ('Lead Manager', 'lead_manager', 4, '{"contacts.view_all":true,"contacts.assign":true,"contacts.edit":true,"deals.view_all":true,"team.view":true,"reports.view":true}'),
  ('Viewer',       'viewer',       5, '{"contacts.view_all":true,"deals.view_all":true,"tasks.view_all":true,"companies.view_all":true,"team.view":true,"reports.view":true}')
) AS r(name, slug, sort_order, permissions)
WHERE NOT EXISTS (
  SELECT 1 FROM public.roles
  WHERE tenant_id = t.id AND slug = r.slug
);

-- ─── Recalibrate tenant counters ────────────────────────────
UPDATE public.tenants SET
  current_contacts = (SELECT count(*) FROM public.contacts c WHERE c.tenant_id=tenants.id AND c.deleted_at IS NULL),
  current_deals    = (SELECT count(*) FROM public.deals d WHERE d.tenant_id=tenants.id AND d.deleted_at IS NULL);

-- ─── Default pipeline for orgs that don't have one ──────────
INSERT INTO public.pipelines (tenant_id, name, is_default, stages)
SELECT t.id, 'Sales Pipeline', true, '[
  {"id":"lead","label":"Lead","order":0,"probability":10},
  {"id":"qualified","label":"Qualified","order":1,"probability":30},
  {"id":"proposal","label":"Proposal","order":2,"probability":60},
  {"id":"negotiation","label":"Negotiation","order":3,"probability":80},
  {"id":"won","label":"Won","order":4,"probability":100},
  {"id":"lost","label":"Lost","order":5,"probability":0}
]'::jsonb
FROM public.tenants t
WHERE NOT EXISTS (SELECT 1 FROM public.pipelines p WHERE p.tenant_id = t.id);

ANALYZE;

-- ── Manual billing notes for superadmin ───────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS admin_notes      text,
  ADD COLUMN IF NOT EXISTS billing_type     text DEFAULT 'trial'
    CHECK (billing_type IN ('trial','stripe','manual','lifetime','complimentary')),
  ADD COLUMN IF NOT EXISTS manual_paid_until timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;
