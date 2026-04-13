#!/bin/bash
# NuCRM SaaS - Automated Database Backup Script
# Usage: ./scripts/backup.sh [backup_name]

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
S3_BUCKET="${S3_BUCKET:-}"
R2_ENDPOINT="${R2_ENDPOINT:-}"
R2_ACCESS_KEY="${R2_ACCESS_KEY_ID:-}"
R2_SECRET_KEY="${R2_SECRET_ACCESS_KEY:-}"
DATABASE_URL="${DATABASE_URL:-}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="${1:-nucrm_backup_$TIMESTAMP}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}  NuCRM SaaS - Database Backup${NC}"
echo -e "${GREEN}=====================================${NC}"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL environment variable is not set${NC}"
    exit 1
fi

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo -e "${YELLOW}Starting backup...${NC}"
echo -e "Backup Name: $BACKUP_NAME"
echo -e "Backup Directory: $BACKUP_DIR"
echo -e "Retention Period: $RETENTION_DAYS days"

# Extract database name from DATABASE_URL
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

# Perform backup using pg_dump
BACKUP_FILE="$BACKUP_DIR/$BACKUP_NAME.sql.gz"
echo -e "${YELLOW}Dumping database: $DB_NAME${NC}"

pg_dump "$DATABASE_URL" | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✓ Backup created successfully: $BACKUP_FILE${NC}"
    echo -e "  Size: $BACKUP_SIZE"
else
    echo -e "${RED}✗ Backup failed!${NC}"
    exit 1
fi

# Verify backup integrity
echo -e "${YELLOW}Verifying backup integrity...${NC}"
if gunzip -t "$BACKUP_FILE" 2>/dev/null; then
    echo -e "${GREEN}✓ Backup integrity verified${NC}"
else
    echo -e "${RED}✗ Backup verification failed!${NC}"
    exit 1
fi

# Create metadata file
METADATA_FILE="$BACKUP_DIR/$BACKUP_NAME.json"
cat > "$METADATA_FILE" << EOF
{
  "backup_name": "$BACKUP_NAME",
  "database": "$DB_NAME",
  "timestamp": "$TIMESTAMP",
  "file": "$BACKUP_FILE",
  "size": "$BACKUP_SIZE",
  "retention_days": "$RETENTION_DAYS",
  "expires_at": "$(date -d "+$RETENTION_DAYS days" +%Y%m%d_%H%M%S)"
}
EOF

echo -e "${GREEN}✓ Metadata created: $METADATA_FILE${NC}"

# Upload to S3/R2 if configured
if [ -n "$S3_BUCKET" ]; then
    echo -e "${YELLOW}Uploading to cloud storage...${NC}"
    
    if [ -n "$R2_ENDPOINT" ]; then
        # Cloudflare R2
        aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/backups/$BACKUP_NAME.sql.gz" \
            --endpoint-url "$R2_ENDPOINT" \
            --access-key "$R2_ACCESS_KEY" \
            --secret-key "$R2_SECRET_KEY" 2>/dev/null
        
        aws s3 cp "$METADATA_FILE" "s3://$S3_BUCKET/backups/$BACKUP_NAME.json" \
            --endpoint-url "$R2_ENDPOINT" \
            --access-key "$R2_ACCESS_KEY" \
            --secret-key "$R2_SECRET_KEY" 2>/dev/null
    else
        # AWS S3
        aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/backups/$BACKUP_NAME.sql.gz"
        aws s3 cp "$METADATA_FILE" "s3://$S3_BUCKET/backups/$BACKUP_NAME.json"
    fi
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ Backup uploaded to S3: s3://$S3_BUCKET/backups/$BACKUP_NAME${NC}"
    else
        echo -e "${RED}✗ S3 upload failed!${NC}"
        echo -e "${YELLOW}Local backup retained${NC}"
    fi
fi

# Cleanup old backups
echo -e "${YELLOW}Cleaning up backups older than $RETENTION_DAYS days...${NC}"
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete 2>/dev/null
find "$BACKUP_DIR" -name "*.json" -mtime +$RETENTION_DAYS -delete 2>/dev/null

# Count remaining backups
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "*.sql.gz" | wc -l)
echo -e "${GREEN}✓ Remaining local backups: $BACKUP_COUNT${NC}"

# Summary
echo -e "\n${GREEN}=====================================${NC}"
echo -e "${GREEN}  Backup Summary${NC}"
echo -e "${GREEN}=====================================${NC}"
echo -e "Database:     $DB_NAME"
echo -e "Backup File:  $BACKUP_FILE"
echo -e "Size:         $BACKUP_SIZE"
echo -e "Timestamp:    $TIMESTAMP"
echo -e "Retention:    $RETENTION_DAYS days"
echo -e "Total Backups: $BACKUP_COUNT"

if [ -n "$S3_BUCKET" ]; then
    echo -e "Cloud Backup: ✓ Uploaded to s3://$S3_BUCKET"
fi

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}  Backup completed successfully!${NC}"
echo -e "${GREEN}=====================================${NC}"

exit 0
