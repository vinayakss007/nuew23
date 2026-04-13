-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Missing Columns: Companies, Contacts, Tasks
-- Purpose: Fix persistent contacts/leads pages errors
-- ═══════════════════════════════════════════════════════════════════

-- Companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';

-- Contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS score integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifecycle_stage text DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS search_vector tsvector,
  ADD COLUMN IF NOT EXISTS company_name text;

-- Create full-text search index for contacts
CREATE INDEX IF NOT EXISTS contacts_search_idx ON public.contacts USING GIN(search_vector) WHERE deleted_at IS NULL AND is_archived = false;

-- Create trigger to update search_vector for contacts
CREATE OR REPLACE FUNCTION update_contacts_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := 
    setweight(to_tsvector('english', COALESCE(NEW.first_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.last_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.email, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.phone, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.notes, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contacts_search_vector_trigger ON public.contacts;
CREATE TRIGGER contacts_search_vector_trigger
  BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_contacts_search_vector();

-- Update existing contacts to populate search_vector
UPDATE public.contacts 
SET search_vector = 
  setweight(to_tsvector('english', COALESCE(first_name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(last_name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(email, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(phone, '')), 'C') ||
  setweight(to_tsvector('english', COALESCE(notes, '')), 'D')
WHERE search_vector IS NULL;

-- Tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
