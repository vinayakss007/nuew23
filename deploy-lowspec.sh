#!/usr/bin/env bash
###############################################################################
#  NuCRM — Low-Spec Deployment Script (1 Core, 1GB RAM, NO Docker)
#
#  Usage:  ./deploy-lowspec.sh
#
#  Requirements (will check & guide):
#    • 1 CPU core, 1GB RAM minimum
#    • External PostgreSQL (not local)
#    • External Redis (not local)
#    • Node.js 22+ (will install if missing)
#    • Internet access (for npm packages)
#
#  What it does:
#    1. Checks system specs
#    2. Installs Node.js 22 if missing
#    3. Installs npm dependencies
#    4. Creates .env.local from your input
#    5. Creates swap file if RAM < 2GB (needed for build)
#    6. Builds the app (with memory limits for low-spec)
#    7. Runs database migrations
#    8. Sets up systemd service (auto-start on boot)
#    9. Starts the application
#   10. Verifies everything works
#
#  Interactive: Will ask for DB/Redis credentials during setup.
###############################################################################
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DEPLOY_DIR="/opt/nucrm"
SERVICE_NAME="nucrm"
WORKER_SERVICE_NAME="nucrm-worker"
ENV_FILE=".env.local"
NODE_VERSION="22"

# ── Helpers ─────────────────────────────────────────────────────────────────
log()  { echo -e "${BLUE}[DEPLOY]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
info() { echo -e "${CYAN}[i]${NC} $*"; }
sep()  { echo -e "${BLUE}─────────────────────────────────────────────────${NC}"; }

banner() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║   NuCRM — Low-Spec Deployment (1 Core / 1GB RAM)          ║${NC}"
    echo -e "${GREEN}║   No Docker — Native Node.js + External DB/Redis          ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ── Step 1: System Check ────────────────────────────────────────────────────
check_system() {
    sep
    log "Step 1: Checking system specs…"

    # CPU
    CPU_COUNT=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1)
    info "CPU cores: $CPU_COUNT"
    if (( CPU_COUNT < 1 )); then
        warn "Only $CPU_COUNT core detected. Build may be slow but will work."
    fi

    # RAM
    RAM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)
    info "RAM: ${RAM_MB}MB"
    if (( RAM_MB < 512 )); then
        err "Not enough RAM. Minimum 512MB required (1GB recommended)."
    fi

    # Disk
    DISK_AVAIL=$(df -m "$SCRIPT_DIR" 2>/dev/null | awk 'NR==2{print $4}' || echo 0)
    info "Disk available: ${DISK_AVAIL}MB"
    if (( DISK_AVAIL < 500 )); then
        err "Not enough disk space. Need at least 500MB free."
    fi

    # OS
    OS_NAME=$(cat /etc/os-release 2>/dev/null | grep ^PRETTY_NAME | cut -d'"' -f2 || uname -s)
    info "OS: $OS_NAME"

    # Swap check
    SWAP_TOTAL=$(free -m 2>/dev/null | awk '/^Swap:/{print $2}' || echo 0)
    if (( RAM_MB < 2048 && SWAP_TOTAL < 512 )); then
        warn "RAM < 2GB and no swap — will create 1GB swap for build"
    fi

    ok "System check passed"
}

# ── Step 2: Install Node.js 22 ──────────────────────────────────────────────
install_node() {
    sep
    log "Step 2: Checking Node.js…"

    if command -v node >/dev/null 2>&1; then
        NODE_VER=$(node --version)
        NODE_MAJOR=$(echo "$NODE_VER" | cut -d'v' -f2 | cut -d'.' -f1)
        ok "Node.js already installed: $NODE_VER"
        if (( NODE_MAJOR < 22 )); then
            warn "Node.js $NODE_VER is below 22 — installing Node.js 22…"
            install_nodejs
        fi
    else
        warn "Node.js not found — installing Node.js $NODE_VERSION…"
        install_nodejs
    fi
}

install_nodejs() {
    info "Installing Node.js $NODE_VERSION via NodeSource…"

    if command -v apt-get >/dev/null 2>&1; then
        # Ubuntu/Debian
        sudo apt-get update -y
        sudo apt-get install -y curl ca-certificates gnupg
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v yum >/dev/null 2>&1; then
        # CentOS/RHEL
        curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
        sudo yum install -y nodejs
    elif command -v apk >/dev/null 2>&1; then
        # Alpine
        apk add --no-cache nodejs npm
    else
        err "Cannot auto-install Node.js on this OS. Please install Node.js 22+ manually."
    fi

    if command -v node >/dev/null 2>&1; then
        ok "Node.js installed: $(node --version)"
        ok "npm installed: $(npm --version)"
    else
        err "Node.js installation failed."
    fi
}

# ── Step 3: Swap file (needed for build on < 2GB RAM) ──────────────────────
setup_swap() {
    RAM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)
    SWAP_TOTAL=$(free -m 2>/dev/null | awk '/^Swap:/{print $2}' || echo 0)

    if (( RAM_MB >= 2048 )); then
        info "RAM >= 2GB — swap not needed"
        return
    fi

    if (( SWAP_TOTAL >= 512 )); then
        info "Swap already exists: ${SWAP_TOTAL}MB"
        return
    fi

    sep
    log "Step 3: Creating 1GB swap file (needed for build on low RAM)…"

    if [[ $EUID -ne 0 ]]; then
        warn "Need sudo for swap creation. Please re-run with: sudo $0"
        err "Cannot create swap without root privileges."
    fi

    SWAP_FILE="/swapfile"
    if [[ -f "$SWAP_FILE" ]]; then
        info "Swap file already exists"
        return
    fi

    sudo fallocate -l 1G "$SWAP_FILE" 2>/dev/null || sudo dd if=/dev/zero of="$SWAP_FILE" bs=1M count=1024
    sudo chmod 600 "$SWAP_FILE"
    sudo mkswap "$SWAP_FILE"
    sudo swapon "$SWAP_FILE"

    # Make persistent
    if ! grep -q "$SWAP_FILE" /etc/fstab 2>/dev/null; then
        echo "$SWAP_FILE none swap sw 0 0" | sudo tee -a /etc/fstab > /dev/null
    fi

    ok "1GB swap created and enabled"
}

# ── Step 4: Environment Setup ───────────────────────────────────────────────
setup_env() {
    sep
    log "Step 4: Environment configuration…"

    if [[ -f "$ENV_FILE" ]]; then
        warn "$ENV_FILE already exists."
        read -p "  Overwrite it? (y/N): " OVERWRITE
        if [[ "$OVERWRITE" != "y" && "$OVERWRITE" != "Y" ]]; then
            ok "Keeping existing $ENV_FILE"
            set -a
            source "$ENV_FILE"
            set +a
            return
        fi
    fi

    echo ""
    echo -e "${CYAN}  Enter your external service credentials:${NC}"
    echo -e "${GRAY}  (Values are saved to .env.local — never committed to git)${NC}"
    echo ""

    # Database
    read -p "  PostgreSQL URL (e.g. postgresql://user:pass@host:5432/nucrm): " DB_URL
    while [[ -z "$DB_URL" ]]; do
        echo -e "${RED}  This is required!${NC}"
        read -p "  PostgreSQL URL: " DB_URL
    done

    read -p "  Database SSL? (true/false, default: false): " DB_SSL
    DB_SSL="${DB_SSL:-false}"

    read -p "  DB Pool Size (default: 5 for low-spec): " DB_POOL
    DB_POOL="${DB_POOL:-5}"

    # Redis
    read -p "  Redis URL (e.g. redis://host:6379): " REDIS_URL
    while [[ -z "$REDIS_URL" ]]; do
        echo -e "${RED}  This is required!${NC}"
        read -p "  Redis URL: " REDIS_URL
    done

    # Generate secrets
    info "Generating secure secrets…"
    JWT_SECRET=$(openssl rand -base64 64 2>/dev/null || head -c 64 /dev/urandom | base64)
    SETUP_KEY=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p)
    CRON_SECRET=$(openssl rand -hex 48 2>/dev/null || head -c 48 /dev/urandom | xxd -p)

    # App URL
    read -p "  Public app URL (default: http://localhost:3000): " APP_URL
    APP_URL="${APP_URL:-http://localhost:3000}"
    APP_HOST=$(echo "$APP_URL" | sed 's|http[s]*://||' | sed 's|:.*||')
    APP_PORT=$(echo "$APP_URL" | grep -o ':[0-9]*' | tr -d ':' || echo 3000)

    # Email
    read -p "  Resend API key (optional, press Enter to skip): " RESEND_KEY

    # AI
    read -p "  OpenAI API key (optional, press Enter to skip): " OPENAI_KEY

    # Write .env.local
    cat > "$ENV_FILE" <<EOF
# ── Database (External PostgreSQL) ──────────────────────
DATABASE_URL=${DB_URL}
DATABASE_SSL=${DB_SSL}
DATABASE_POOL_SIZE=${DB_POOL}

# ── Redis (External) ───────────────────────────────────
REDIS_URL=${REDIS_URL}

# ── Authentication (Auto-generated) ────────────────────
JWT_SECRET=${JWT_SECRET}
SETUP_KEY=${SETUP_KEY}
CRON_SECRET=${CRON_SECRET}

# ── Application ─────────────────────────────────────────
NEXT_PUBLIC_APP_URL=${APP_URL}
ALLOWED_ORIGINS=${APP_URL}
NODE_ENV=production
PORT=${APP_PORT}
HOSTNAME=0.0.0.0

# ── Email (Optional) ───────────────────────────────────
RESEND_API_KEY=${RESEND_KEY:-}

# ── AI (Optional) ──────────────────────────────────────
OPENAI_API_KEY=${OPENAI_KEY:-}

# ── WhatsApp (Optional) ────────────────────────────────
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=

# ── Voice/Twilio (Optional) ────────────────────────────
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# ── Storage (Optional) ─────────────────────────────────
BACKUP_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
S3_REGION=auto
EOF

    ok ".env.local created"

    # Load env vars
    set -a
    source "$ENV_FILE"
    set +a
}

# ── Step 5: Install Dependencies ────────────────────────────────────────────
install_deps() {
    sep
    log "Step 5: Installing npm dependencies…"

    # Check if node_modules exists and is valid
    if [[ -d "node_modules" ]] && [[ -f "node_modules/.package-lock.json" ]]; then
        info "node_modules exists — checking if up to date…"
        npm install --legacy-peer-deps --prefer-offline 2>/dev/null || npm install --legacy-peer-deps
    else
        npm install --legacy-peer-deps
    fi

    ok "Dependencies installed ($(du -sh node_modules 2>/dev/null | cut -f1))"
}

# ── Step 6: Build ───────────────────────────────────────────────────────────
build_app() {
    sep
    log "Step 6: Building Next.js application…"
    info "This may take 2-5 minutes on a low-spec machine…"

    # Memory management for low-spec build
    export NODE_OPTIONS="--max-old-space-size=1024"
    export NEXT_TELEMETRY_DISABLED=1
    export CI=true

    # Set placeholder env vars for build (needed by Next.js)
    export DATABASE_URL="${DATABASE_URL:-postgresql://placeholder:placeholder@localhost:5432/placeholder}"
    export JWT_SECRET="${JWT_SECRET:-build-time-placeholder-secret-minimum-32-chars}"
    export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"

    log "Running: next build (memory limited to 1GB)"
    
    if npx next build; then
        ok "Build successful!"
        BUILD_SIZE=$(du -sh .next 2>/dev/null | cut -f1 || echo "unknown")
        info "Build output size: $BUILD_SIZE"
    else
        err "Build failed! Check the error output above."
    fi
}

# ── Step 7: Run Migrations ──────────────────────────────────────────────────
run_migrations() {
    sep
    log "Step 7: Running database migrations…"

    # Reset DATABASE_URL to real value for migration
    export DATABASE_URL

    if npx tsx scripts/push-db.mts 2>&1; then
        ok "Migrations complete"
    else
        warn "Migration finished with warnings (may already be up-to-date)"
    fi
}

# ── Step 8: Systemd Service Setup ──────────────────────────────────────────
setup_systemd() {
    sep
    log "Step 8: Setting up systemd service (auto-start on boot)…"

    if ! command -v systemctl >/dev/null 2>&1; then
        warn "systemctl not found — skipping systemd setup"
        warn "You'll need to start the app manually:"
        echo "   cd $SCRIPT_DIR && node --max-old-space-size=512 .next/server/app.js"
        return
    fi

    # Ensure we're deploying from the right directory
    APP_DIR="$SCRIPT_DIR"

    # Main app service
    sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=NuCRM SaaS Application
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
Environment=NODE_OPTIONS=--max-old-space-size=512
ExecStart=$(which npx 2>/dev/null || echo "/usr/bin/npx") next start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=nucrm

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    # Worker service (optional — skip on very low spec)
    RAM_MB=$(free -m 2>/dev/null | awk '/^Mem:/{print $2}' || echo 0)
    if (( RAM_MB >= 1024 )); then
        sudo tee /etc/systemd/system/${WORKER_SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=NuCRM Background Worker
After=network.target ${SERVICE_NAME}.service

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=256
ExecStart=$(which npx 2>/dev/null || echo "/usr/bin/npx") tsx worker.ts
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=nucrm-worker

[Install]
WantedBy=multi-user.target
EOF
        WORKER_ENABLED=true
    else
        warn "RAM < 1GB — skipping worker service (not enough memory)"
        WORKER_ENABLED=false
    fi

    # Enable and start
    sudo systemctl daemon-reload
    sudo systemctl enable ${SERVICE_NAME}.service
    sudo systemctl start ${SERVICE_NAME}.service

    if [[ "$WORKER_ENABLED" == "true" ]]; then
        sudo systemctl enable ${WORKER_SERVICE_NAME}.service
        sudo systemctl start ${WORKER_SERVICE_NAME}.service
    fi

    ok "Systemd services created and started"
    info "Commands:"
    echo "   systemctl status nucrm              # Check app status"
    echo "   journalctl -u nucrm -f              # Follow app logs"
    echo "   systemctl restart nucrm             # Restart app"
    if [[ "$WORKER_ENABLED" == "true" ]]; then
        echo "   systemctl status nucrm-worker         # Check worker status"
        echo "   journalctl -u nucrm-worker -f       # Follow worker logs"
    fi
}

# ── Step 9: Verify ──────────────────────────────────────────────────────────
verify() {
    sep
    log "Step 9: Verifying deployment…"

    sleep 3

    # Check if process is running
    if pgrep -f "next start" >/dev/null 2>&1 || systemctl is-active --quiet nucrm 2>/dev/null; then
        ok "NuCRM app is running"
    else
        err "NuCRM app is NOT running. Check: journalctl -u nucrm"
    fi

    # Check health endpoint
    PORT="${PORT:-3000}"
    sleep 2
    local HTTP_CODE
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/health" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        ok "Health endpoint responding (HTTP $HTTP_CODE)"
    else
        warn "Health endpoint returned HTTP $HTTP_CODE (may need a few more seconds)"
    fi

    # Check database connectivity
    if npx tsx -e "
      const { Pool } = require('pg');
      const p = new Pool({ connectionString: process.env.DATABASE_URL });
      p.query('SELECT 1').then(() => { process.exit(0); }).catch(() => process.exit(1));
    " 2>/dev/null; then
        ok "Database connected"
    else
        warn "Database connection failed — check DATABASE_URL"
    fi

    # Check Redis
    if npx tsx -e "
      const Redis = require('ioredis');
      const r = new Redis(process.env.REDIS_URL);
      r.ping().then(() => { process.exit(0); }).catch(() => process.exit(1));
    " 2>/dev/null; then
        ok "Redis connected"
    else
        warn "Redis connection failed — check REDIS_URL"
    fi
}

# ── Final Banner ─────────────────────────────────────────────────────────────
print_final() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║   🚀  NuCRM Deployed Successfully!                            ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    APP_URL_FINAL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
    echo -e "${GREEN}║   🌐  App:     $APP_URL_FINAL                                ║${NC}"
    echo -e "${GREEN}║   ⚙️   Setup:   $APP_URL_FINAL/setup                         ║${NC}"
    echo -e "${GREEN}║   🏥  Health:  $APP_URL_FINAL/api/health                     ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}╠═══════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}║   Useful Commands:                                            ║${NC}"
    echo -e "${GREEN}║   systemctl status nucrm          # Check status              ║${NC}"
    echo -e "${GREEN}║   journalctl -u nucrm -f         # Follow logs               ║${NC}"
    echo -e "${GREEN}║   systemctl restart nucrm         # Restart                   ║${NC}"
    echo -e "${GREEN}║   systemctl stop nucrm            # Stop                      ║${NC}"
    if [[ "$WORKER_ENABLED" == "true" ]]; then
        echo -e "${GREEN}║   systemctl status nucrm-worker   # Worker status           ║${NC}"
    fi
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    warn "IMPORTANT: Save your .env.local file securely!"
    warn "It contains your secrets and is NOT in git."
    echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
    banner

    # Check if running as root — warn but continue
    if [[ $EUID -eq 0 ]]; then
        warn "Running as root. It's better to run as a regular user."
        warn "Some features (swap, systemd) still need sudo."
    fi

    check_system
    install_node
    setup_swap
    setup_env
    install_deps
    build_app
    run_migrations
    setup_systemd
    verify
    print_final
}

main "$@"
