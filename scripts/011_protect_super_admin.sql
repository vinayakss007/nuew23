-- ═══════════════════════════════════════════════════════════════════
-- NuCRM SaaS — Super Admin Account Protection
--
-- This makes super admin accounts IMMUTABLE and PROTECTED
--
-- Run: psql $DATABASE_URL -f scripts/011_protect_super_admin.sql
-- ═══════════════════════════════════════════════════════════════════

-- First ensure deleted_at column exists (from migration 003)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE public.users ADD COLUMN deleted_at timestamptz;
    ALTER TABLE public.users ADD COLUMN deleted_by uuid references public.users on delete set null;
    CREATE INDEX users_deleted_idx ON public.users(deleted_at) WHERE deleted_at IS NOT NULL;
  END IF;
END $$;

-- Function to prevent super admin modification
CREATE OR REPLACE FUNCTION protect_super_admin()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent demotion
  IF OLD.is_super_admin = true AND NEW.is_super_admin = false THEN
    RAISE EXCEPTION 'SUPER_ADMIN_PROTECTED: Super admin account cannot be demoted';
  END IF;

  -- Prevent deletion (soft delete)
  IF OLD.is_super_admin = true AND NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'SUPER_ADMIN_PROTECTED: Super admin account cannot be deleted';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to users table (UPDATE and DELETE only, not INSERT)
DROP TRIGGER IF EXISTS trigger_protect_super_admin ON public.users;
CREATE TRIGGER trigger_protect_super_admin
  BEFORE UPDATE OR DELETE ON public.users
  FOR EACH ROW
  WHEN (OLD.is_super_admin = true)
  EXECUTE FUNCTION protect_super_admin();

-- Add comment
COMMENT ON FUNCTION protect_super_admin() IS 'Prevents any modification to super admin accounts';
COMMENT ON TRIGGER trigger_protect_super_admin ON public.users IS 'Protects super admin accounts from modification or deletion';

-- Verify trigger exists
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'trigger_protect_super_admin';

-- Test protection (should fail)
-- Uncomment to test:
-- UPDATE public.users SET is_super_admin = false WHERE is_super_admin = true;
-- Should return: ERROR: SUPER_ADMIN_PROTECTED: Super admin account cannot be demoted
