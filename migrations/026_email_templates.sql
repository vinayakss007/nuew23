-- Migration: 026_email_templates.sql
-- Purpose: Create email_templates table for MISSING-009

CREATE TABLE IF NOT EXISTS public.email_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  name        text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  category    text NOT NULL DEFAULT 'general',
  created_by  uuid REFERENCES public.users(id),
  deleted_at  timestamptz,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_templates_tenant_idx
  ON public.email_templates(tenant_id) WHERE deleted_at IS NULL;

-- Seed starter templates per tenant via application logic (not SQL seed)
-- Templates are tenant-owned; no default global templates.
