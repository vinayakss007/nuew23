#!/bin/bash
# NuCRM SaaS - Database Restore Script
# Usage: ./scripts/restore.sh <backup_name>

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
S3_BUCKET="${S3_BUCKET:-}"
R2_ENDPOINT="${R2_ENDPOINT:-}"
R2_ACCESS_KEY="${R2_ACCESS_KEY_ID:-}"
R2_SECRET_KEY="${R2_SECRET_ACCESS_KEY:-}"
DATABASE_URL="${DATABASE_URL:-}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}  NuCRM SaaS - Database Restore${NC}"
echo -e "${BLUE}=====================================${NC}"

# Check if backup name is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Backup name is required${NC}"
    echo -e "${YELLOW}Usage: ./scripts/restore.sh <backup_name>${NC}"
    echo -e "\n${YELLOW}Available backups:${NC}"
    find "$BACKUP_DIR" -name "*.sql.gz" -type f | sed 's/.*\///' | sed 's/.sql.gz//' | sort -r | head -10
    exit 1
fi

BACKUP_NAME="$1"
BACKUP_FILE="$BACKUP_DIR/$BACKUP_NAME.sql.gz"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL environment variable is not set${NC}"
    exit 1
fi

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    # Try to download from S3
    if [ -n "$S3_BUCKET" ]; then
        echo -e "${YELLOW}Backup not found locally. Downloading from S3...${NC}"
        
        if [ -n "$R2_ENDPOINT" ]; then
            aws s3 cp "s3://$S3_BUCKET/backups/$BACKUP_NAME.sql.gz" "$BACKUP_FILE" \
                --endpoint-url "$R2_ENDPOINT" \
                --access-key "$R2_ACCESS_KEY" \
                --secret-key "$R2_SECRET_KEY" 2>/dev/null
        else
            aws s3 cp "s3://$S3_BUCKET/backups/$BACKUP_NAME.sql.gz" "$BACKUP_FILE"
        fi
        
        if [ $? -ne 0 ]; then
            echo -e "${RED}Error: Backup file not found: $BACKUP_FILE${NC}"
            exit 1
        fi
    else
        echo -e "${RED}Error: Backup file not found: $BACKUP_FILE${NC}"
        exit 1
    fi
fi

# Extract database name from DATABASE_URL
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

echo -e "${YELLOW}WARNING: This will restore database '$DB_NAME' from backup${NC}"
echo -e "Backup: $BACKUP_NAME"
echo -e "File: $BACKUP_FILE"
echo -e ""
echo -e "${RED}⚠️  All current data will be overwritten!${NC}"
echo -e ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${YELLOW}Restore cancelled${NC}"
    exit 0
fi

# Verify backup integrity
echo -e "${YELLOW}Verifying backup integrity...${NC}"
if ! gunzip -t "$BACKUP_FILE" 2>/dev/null; then
    echo -e "${RED}✗ Backup integrity verification failed!${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Backup integrity verified${NC}"

# Create pre-restore backup
echo -e "${YELLOW}Creating pre-restore backup...${NC}"
PRE_RESTORE_BACKUP="$BACKUP_DIR/pre_restore_$(date +%Y%m%d_%H%M%S).sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$PRE_RESTORE_BACKUP"
echo -e "${GREEN}✓ Pre-restore backup created: $PRE_RESTORE_BACKUP${NC}"

# Drop and recreate database (optional - for clean restore)
echo -e "${YELLOW}Preparing database for restore...${NC}"
read -p "Drop and recreate database? (recommended for clean restore) (yes/no): " DROP_DB

if [ "$DROP_DB" = "yes" ]; then
    echo -e "${YELLOW}Dropping all tables...${NC}"
    psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>/dev/null || true
    echo -e "${GREEN}✓ Database cleaned${NC}"
fi

# Restore database
echo -e "${YELLOW}Restoring database...${NC}"
gunzip -c "$BACKUP_FILE" | psql "$DATABASE_URL" > /dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Database restored successfully${NC}"
else
    echo -e "${RED}✗ Restore failed!${NC}"
    echo -e "${YELLOW}Pre-restore backup available: $PRE_RESTORE_BACKUP${NC}"
    exit 1
fi

# Verify restore
echo -e "${YELLOW}Verifying restore...${NC}"
TABLE_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')

if [ "$TABLE_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Restore verified - $TABLE_COUNT tables found${NC}"
else
    echo -e "${RED}✗ Restore verification failed!${NC}"
    exit 1
fi

# Update sequences (reset auto-increment)
echo -e "${YELLOW}Updating sequences...${NC}"
psql "$DATABASE_URL" -c "SELECT setval(pg_get_serial_sequence('users', 'id'), COALESCE(MAX(id), 1)) FROM users;" 2>/dev/null || true
psql "$DATABASE_URL" -c "SELECT setval(pg_get_serial_sequence('contacts', 'id'), COALESCE(MAX(id), 1)) FROM contacts;" 2>/dev/null || true
psql "$DATABASE_URL" -c "SELECT setval(pg_get_serial_sequence('companies', 'id'), COALESCE(MAX(id), 1)) FROM companies;" 2>/dev/null || true
psql "$DATABASE_URL" -c "SELECT setval(pg_get_serial_sequence('deals', 'id'), COALESCE(MAX(id), 1)) FROM deals;" 2>/dev/null || true
echo -e "${GREEN}✓ Sequences updated${NC}"

# Summary
echo -e "\n${GREEN}=====================================${NC}"
echo -e "${GREEN}  Restore Summary${NC}"
echo -e "${GREEN}=====================================${NC}"
echo -e "Database:     $DB_NAME"
echo -e "Backup Used:  $BACKUP_NAME"
echo -e "Tables:       $TABLE_COUNT"
echo -e "Pre-Restore:  $PRE_RESTORE_BACKUP"
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}  Restore completed successfully!${NC}"
echo -e "${GREEN}=====================================${NC}"

exit 0
