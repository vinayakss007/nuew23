#!/usr/bin/env bash
###############################################################################
#  NuCRM — Full Source Code & Documents Backup
#
#  Usage:  ./backup-source.sh
#          ./backup-source.sh /path/to/backup/dir
#
#  Creates a timestamped archive of:
#    ✓ All source code (app/, lib/, components/, scripts/, types/)
#    ✓ All documents (*.md, *.txt, *.json, config files)
#    ✓ Migrations (SQL files)
#    ✓ .env.example (NOT .env.local — secrets excluded!)
#
#  Output: nucrm-backup-YYYYMMDD-HHMMSS.tar.gz
###############################################################################
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[BACKUP]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── Determine source directory ───────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Determine backup destination ─────────────────────────────────────────────
BACKUP_DIR="${1:-..}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE_NAME="nucrm-backup-${TIMESTAMP}.tar.gz"
ARCHIVE_PATH="${BACKUP_DIR}/${ARCHIVE_NAME}"

# ── What to include ─────────────────────────────────────────────────────────
log "Creating backup of NuCRM source code & documents…"
echo ""

INCLUDE_LIST=(
  # Source code directories
  "app/"
  "lib/"
  "components/"
  "scripts/"
  "types/"
  "migrations/"

  # Config files
  "package.json"
  "package-lock.json"
  "tsconfig.json"
  "next.config.mjs"
  "tailwind.config.ts"
  "postcss.config.mjs"
  "docker-compose.yml"
  "docker-compose.deploy.yml"
  "Dockerfile"
  "Dockerfile.worker"

  # Shell scripts
  "deploy.sh"
  "start-docker.sh"
  "run-local.sh"

  # Documentation
  "README.md"
  "QUICKSTART.md"
  "DEPLOYMENT.md"
  "DEPLOYMENT_READINESS.md"
  "ARCHITECTURE.md"
  "DATA_MODEL.md"
  "DATABASE-SETUP.md"
  "API.md"
  "CONTRIBUTING.md"
  "UPGRADE-GUIDE.md"
  "CHANGELOG.md"
  "SCHEMA_POLICY.md"
  "COMPLETE_TECHNICAL_BLUEPRINT.txt"
)

# ── Create .env.example (never backup real secrets) ──────────────────────────
if [[ -f ".env.local" ]]; then
    log "Creating .env.example from .env.local (secrets removed)…"
    grep -v 'PASSWORD\|SECRET\|KEY\|TOKEN' .env.local > .env.example 2>/dev/null || true
    cat > .env.example <<'EOFENV'
# NuCRM Environment Variables
# Copy this file to .env.local and fill in your values

# Database (PostgreSQL)
DATABASE_URL=postgresql://user:password@host:5432/nucrm
DATABASE_SSL=false
DATABASE_POOL_SIZE=5

# Authentication
JWT_SECRET=<generate-with: openssl rand -base64 64>
SETUP_KEY=<generate-with: openssl rand -hex 24>
CRON_SECRET=<generate-with: openssl rand -hex 48>

# Application
NEXT_PUBLIC_APP_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000
NODE_ENV=production

# Redis
REDIS_URL=redis://host:6379

# Email (Resend)
RESEND_API_KEY=re_xxxxxx

# AI (OpenAI)
OPENAI_API_KEY=sk-xxxxxx

# WhatsApp (Meta)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=

# Voice (Twilio)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# Storage (S3/R2)
BACKUP_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_REGION=auto
EOFENV
    ok ".env.example created (secrets excluded)"
fi

# ── Build tar command ────────────────────────────────────────────────────────
log "Archiving files to: $ARCHIVE_PATH"

TAR_ARGS=()
for item in "${INCLUDE_LIST[@]}"; do
    if [[ -e "$item" ]]; then
        TAR_ARGS+=("$item")
    else
        warn "Skipping (not found): $item"
    fi
done

if [[ ${#TAR_ARGS[@]} -eq 0 ]]; then
    err "No files found to backup!"
fi

echo ""
log "Including ${#TAR_ARGS[@]} files/directories…"

# ── Create the archive ───────────────────────────────────────────────────────
tar -czf "$ARCHIVE_PATH" "${TAR_ARGS[@]}" 2>/dev/null

# ── Report ───────────────────────────────────────────────────────────────────
ARCHIVE_SIZE=$(du -h "$ARCHIVE_PATH" | cut -f1)
FILE_COUNT=$(tar -tzf "$ARCHIVE_PATH" 2>/dev/null | wc -l)

echo ""
ok "Backup complete!"
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                                                           ║${NC}"
echo -e "${GREEN}║   Archive:  $ARCHIVE_NAME${NC}"
echo -e "${GREEN}║   Size:     $ARCHIVE_SIZE${NC}"
echo -e "${GREEN}║   Files:    $FILE_COUNT${NC}"
echo -e "${GREEN}║   Location: $(dirname "$ARCHIVE_PATH")${NC}"
echo -e "${GREEN}║                                                           ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
log "To restore on another machine:"
echo "   scp $ARCHIVE_PATH user@newserver:/opt/nucrm/"
echo "   ssh user@newserver"
echo "   cd /opt/nucrm && tar -xzf $ARCHIVE_NAME"
echo ""
log "Secrets NOT included — you'll need to set .env.local manually."
