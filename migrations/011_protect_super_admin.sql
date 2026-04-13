-- ═══════════════════════════════════════════════════════════════════════════════
-- 011_protect_super_admin.sql
-- Protect super admin accounts from being demoted or deleted
-- ═══════════════════════════════════════════════════════════════════════════════

-- Function to protect super admin accounts
CREATE OR REPLACE FUNCTION protect_super_admin()
RETURNS TRIGGER AS $$
BEGIN
  -- Prevent demoting super admin
  IF OLD.is_super_admin = true AND NEW.is_super_admin = false THEN
    RAISE EXCEPTION 'SUPER_ADMIN_PROTECTED: Super admin account cannot be demoted';
  END IF;
  
  -- Prevent soft-deleting super admin
  IF OLD.is_super_admin = true AND NEW.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'SUPER_ADMIN_PROTECTED: Super admin account cannot be deleted';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on users table
DROP TRIGGER IF EXISTS trigger_protect_super_admin ON public.users;
CREATE TRIGGER trigger_protect_super_admin
  BEFORE UPDATE OR DELETE ON public.users
  FOR EACH ROW
  WHEN (OLD.is_super_admin = true)
  EXECUTE FUNCTION protect_super_admin();

-- Add comment for documentation
COMMENT ON FUNCTION protect_super_admin() IS 
  'Prevents super admin accounts from being demoted or deleted for platform security';
