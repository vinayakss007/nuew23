#!/bin/bash
# ════════════════════════════════════════════════════
# NuCRM SaaS — Setup Automated Backups with Cron
#
# This script sets up automated daily backups using cron
#
# Usage: ./scripts/setup-backup-cron.sh
# ════════════════════════════════════════════════════

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
  local level=$1
  shift
  local message="$@"
  echo -e "${level}${message}${NC}"
}

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_SCRIPT="$SCRIPT_DIR/backup.sh"
CRON_FILE="/etc/cron.d/nucrm-backup"

log "${BLUE}INFO${NC}" "🔄 Setting up automated backups for NuCRM SaaS..."

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  log "${YELLOW}WARNING${NC}" "⚠️ This script should be run as root to install cron jobs"
  log "${YELLOW}WARNING${NC}" "⚠️ Run: sudo $0"
  echo ""
  read -p "Continue anyway? (yes/no): " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    log "${YELLOW}INFO${NC}" "Setup cancelled"
    exit 0
  fi
fi

# Check if backup script exists
if [ ! -f "$BACKUP_SCRIPT" ]; then
  log "${RED}ERROR${NC}" "Backup script not found: $BACKUP_SCRIPT"
  exit 1
fi

# Make backup script executable
chmod +x "$BACKUP_SCRIPT"
log "${GREEN}SUCCESS${NC}" "✅ Backup script is executable"

# Create crontab entry
CRON_JOB="0 2 * * * root cd $PROJECT_DIR && $BACKUP_SCRIPT >> /var/log/nucrm-backup.log 2>&1"

log "${BLUE}INFO${NC}" "Installing cron job for daily backups at 2:00 AM..."

# Check if cron file already exists
if [ -f "$CRON_FILE" ]; then
  log "${YELLOW}WARNING${NC}" "⚠️ Cron file already exists: $CRON_FILE"
  read -p "Overwrite? (yes/no): " CONFIRM
  if [ "$CONFIRM" != "yes" ]; then
    log "${YELLOW}INFO${NC}" "Setup cancelled - existing cron job preserved"
    exit 0
  fi
fi

# Install cron job
echo "$CRON_JOB" > "$CRON_FILE"
chmod 644 "$CRON_FILE"
log "${GREEN}SUCCESS${NC}" "✅ Cron job installed: $CRON_FILE"

# Restart cron service
if command -v systemctl &> /dev/null; then
  systemctl restart cron 2>/dev/null || systemctl restart crond 2>/dev/null || true
  log "${GREEN}SUCCESS${NC}" "✅ Cron service restarted"
elif command -v service &> /dev/null; then
  service cron restart 2>/dev/null || true
  log "${GREEN}SUCCESS${NC}" "✅ Cron service restarted"
fi

# Verify cron job
log "${BLUE}INFO${NC}" "Installed cron job:"
cat "$CRON_FILE"
echo ""

# Test backup script
log "${BLUE}INFO${NC}" "Testing backup script..."
if cd "$PROJECT_DIR" && "$BACKUP_SCRIPT" > /dev/null 2>&1; then
  log "${GREEN}SUCCESS${NC}" "✅ Backup script executed successfully"
else
  log "${YELLOW}WARNING${NC}" "⚠️ Backup script test failed - check configuration"
fi

log "${GREEN}SUCCESS${NC}" "🎉 Automated backup setup complete!"
log "${BLUE}INFO${NC}" "─────────────────────────────────────"
log "${BLUE}INFO${NC}" "Backups will run daily at 2:00 AM"
log "${BLUE}INFO${NC}" "View logs: tail -f /var/log/nucrm-backup.log"
log "${BLUE}INFO${NC}" "Manage cron: sudo crontab -e"
log "${BLUE}INFO${NC}" ""

exit 0
