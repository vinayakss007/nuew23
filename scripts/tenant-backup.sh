#!/bin/sh
# NuCRM — Granular Tenant Backup & Restore
# Exports/imports a SINGLE tenant's data without touching other tenants
#
# Usage:
#   scripts/tenant-backup.sh export <TENANT_ID> [output_file]
#   scripts/tenant-backup import <tenant_id> <input_file>
#
# Requirements: pg_dump, pg_restore, gzip, psql
#

set -e

DB_URL="${DATABASE_URL:-postgresql://postgres:postgres123@localhost:5432/nucrm}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/nucrm-tenant-backups}"

mkdir -p "$BACKUP_DIR"

# ── Export a single tenant ──────────────────────────────────────────────────
tenant_export() {
  TENANT_ID="$1"
  OUTPUT="$2"

  if [ -z "$TENANT_ID" ]; then
    echo "Usage: $0 export <TENANT_ID> [output_file]"
    exit 1
  fi

  # Verify tenant exists
  TENANT_NAME=$(psql "$DB_URL" -tAc "SELECT name FROM public.tenants WHERE id='$TENANT_ID'")
  if [ -z "$TENANT_NAME" ]; then
    echo "❌ Tenant $TENANT_ID not found"
    exit 1
  fi

  if [ -z "$OUTPUT" ]; then
    OUTPUT="$BACKUP_DIR/tenant_${TENANT_ID}_$(date +%Y%m%d_%H%M%S).sql.gz"
  fi

  echo "📦 Exporting tenant: $TENANT_NAME ($TENANT_ID)"
  echo "   Output: $OUTPUT"

  # Get all user IDs for this tenant
  USER_IDS=$(psql "$DB_URL" -tAc "SELECT string_agg(user_id::text, ',') FROM public.tenant_members WHERE tenant_id='$TENANT_ID'")
  
  # Build WHERE clause for users
  if [ -n "$USER_IDS" ]; then
    USER_WHERE="id IN ($USER_IDS)"
  else
    USER_WHERE="id='00000000-0000-0000-0000-000000000000'" # empty
  fi

  # Export tenant-specific data
  TMP_SQL=$(mktemp)
  
  cat > "$TMP_SQL" << SQLEOF
-- =====================================================
-- NuCRM Tenant Export: $TENANT_NAME
-- Tenant ID: $TENANT_ID
-- Exported: $(date -u +%Y-%m-%dT%H:%M:%SZ)
-- =====================================================

\\echo 'Starting tenant export...'

BEGIN;

-- 1. Export tenant record
\\echo '  Exporting tenant...'
INSERT INTO public.tenants (SELECT * FROM public.tenants WHERE id='$TENANT_ID')
ON CONFLICT DO NOTHING;

-- 2. Export users belonging to this tenant
\\echo '  Exporting users...'
INSERT INTO public.users 
  (SELECT * FROM public.users WHERE $USER_WHERE)
ON CONFLICT DO NOTHING;

-- 3. Export tenant_members
\\echo '  Exporting tenant_members...'
INSERT INTO public.tenant_members 
  (SELECT * FROM public.tenant_members WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

-- 4. Export all tenant-specific data (WHERE tenant_id = ...)
\\echo '  Exporting tenant data...'

INSERT INTO public.contacts 
  (SELECT * FROM public.contacts WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.leads 
  (SELECT * FROM public.leads WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.companies 
  (SELECT * FROM public.companies WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.deals 
  (SELECT * FROM public.deals WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.tasks 
  (SELECT * FROM public.tasks WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.activities 
  (SELECT * FROM public.activities WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.notifications 
  (SELECT * FROM public.notifications WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.sequences 
  (SELECT * FROM public.sequences WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.sequence_enrollments 
  (SELECT * FROM public.sequence_enrollments WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.forms 
  (SELECT * FROM public.forms WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.form_submissions 
  (SELECT * FROM public.form_submissions WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.pipelines 
  (SELECT * FROM public.pipelines WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.webhook_deliveries 
  (SELECT * FROM public.webhook_deliveries WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.automations 
  (SELECT * FROM public.automations WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.modules 
  (SELECT * FROM public.modules WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.tenant_modules 
  (SELECT * FROM public.tenant_modules WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.api_keys 
  (SELECT * FROM public.api_keys WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

INSERT INTO public.file_attachments 
  (SELECT * FROM public.file_attachments WHERE tenant_id='$TENANT_ID')
ON CONFLICT DO NOTHING;

COMMIT;

\\echo '✅ Export complete'
SQLEOF

  # Run the export and compress
  psql "$DB_URL" -f "$TMP_SQL" 2>&1 | gzip > "$OUTPUT"
  rm -f "$TMP_SQL"

  SIZE=$(du -h "$OUTPUT" | cut -f1)
  echo ""
  echo "✅ Tenant exported successfully!"
  echo "   File: $OUTPUT"
  echo "   Size: $SIZE"
  echo ""
  echo "To restore:"
  echo "  $0 import $TENANT_ID $OUTPUT"
}

# ── Import a tenant backup ──────────────────────────────────────────────────
tenant_import() {
  TENANT_ID="$1"
  INPUT_FILE="$2"

  if [ -z "$TENANT_ID" ] || [ -z "$INPUT_FILE" ]; then
    echo "Usage: $0 import <tenant_id> <input_file>"
    exit 1
  fi

  if [ ! -f "$INPUT_FILE" ]; then
    echo "❌ File not found: $INPUT_FILE"
    exit 1
  fi

  echo "⚠️  IMPORTING tenant backup into: $TENANT_ID"
  echo "   Source: $INPUT_FILE"
  echo ""
  echo "This will:"
  echo "  - Insert/merge the tenant record"
  echo "  - Insert/merge users from the backup"
  echo "  - Insert/merge ALL tenant data (contacts, deals, etc.)"
  echo "  - NOT delete existing data (ON CONFLICT DO NOTHING)"
  echo ""
  read -p "Continue? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
  fi

  echo ""
  echo "📥 Importing..."
  
  gunzip -c "$INPUT_FILE" | psql "$DB_URL" 2>&1

  echo ""
  echo "✅ Import complete!"
}

# ── List tenant backups ─────────────────────────────────────────────────────
list_backups() {
  echo "📁 Tenant backups in $BACKUP_DIR:"
  echo ""
  if [ -d "$BACKUP_DIR" ] && [ "$(ls -A "$BACKUP_DIR" 2>/dev/null)" ]; then
    ls -lh "$BACKUP_DIR"/*.sql.gz 2>/dev/null || echo "  No backups found"
  else
    echo "  No backups found"
  fi
}

# ── Main ────────────────────────────────────────────────────────────────────
case "${1}" in
  export)
    tenant_export "$2" "$3"
    ;;
  import)
    tenant_import "$2" "$3"
    ;;
  list)
    list_backups
    ;;
  *)
    echo "========================================"
    echo "  NuCRM Tenant Backup & Restore"
    echo "========================================"
    echo ""
    echo "Usage:"
    echo "  $0 export <TENANT_ID> [output_file]  — Export a tenant's data"
    echo "  $0 import <tenant_id> <input_file>   — Import a tenant backup"
    echo "  $0 list                              — List available backups"
    echo ""
    echo "Examples:"
    echo "  $0 export 0c6e8531-f07c-410d-a52a-2372b73272b8"
    echo "  $0 import 0c6e8531-f07c-410d-a52a-2372b73272b8 /tmp/nucrm-tenant-backups/tenant_xxx.sql.gz"
    echo "  $0 list"
    ;;
esac
