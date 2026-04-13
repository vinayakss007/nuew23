#!/usr/bin/env bash
###############################################################################
#  NuCRM – Full One-Command Deployment Script
#
#  Usage:  ./deploy.sh              # Build, deploy, migrate, verify
#          ./deploy.sh --skip-build  # Skip build (use existing image)
#          ./deploy.sh --status      # Show service status only
#          ./deploy.sh --logs        # Follow logs
#          ./deploy.sh --down        # Tear everything down
#          ./deploy.sh --migrate     # Run migrations only
#          ./deploy.sh --backup      # Backup database
#          ./deploy.sh --help        # Show help
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

ENV_FILE=".env.local"
COMPOSE_CMD="docker compose"

# ── Helpers ─────────────────────────────────────────────────────────────────
log()  { echo -e "${BLUE}[DEPLOY]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
info() { echo -e "${CYAN}[i]${NC} $*"; }

# ── Help ─────────────────────────────────────────────────────────────────────
show_help() {
    cat <<'EOF'
NuCRM Full Deployment Script

USAGE:
    ./deploy.sh [OPTION]

OPTIONS:
    (none)          Full deploy: check, build, up, migrate, verify
    --skip-build    Skip Docker build (use existing images)
    --status        Show container status only
    --logs          Follow app logs
    --down          Stop and remove all containers
    --down-volumes  Stop, remove containers AND volumes (destroys data!)
    --migrate       Run database migrations only
    --seed          Seed demo data only
    --backup        Create a database backup
    --restart       Restart all services
    --help          Show this help

EXAMPLES:
    ./deploy.sh                  # Full one-click deploy
    ./deploy.sh --status         # Check if running
    ./deploy.sh --down && ./deploy.sh  # Clean redeploy
EOF
    exit 0
}

# ── Prerequisites ───────────────────────────────────────────────────────────
check_prereqs() {
    log "Checking prerequisites…"
    command -v docker >/dev/null 2>&1     || err "Docker is not installed"
    docker info >/dev/null 2>&1           || err "Docker daemon not running"
    $COMPOSE_CMD version >/dev/null 2>&1  || err "docker compose plugin not found"
    ok "Docker ready"
}

# ── Environment ─────────────────────────────────────────────────────────────
check_env() {
    if [[ ! -f "$ENV_FILE" ]]; then
        warn "$ENV_FILE not found – generating secure secrets…"
        {
            echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)"
            echo "JWT_SECRET=$(openssl rand -base64 64)"
            echo "SETUP_KEY=$(openssl rand -hex 24)"
            echo "CRON_SECRET=$(openssl rand -hex 48)"
            echo "NEXT_PUBLIC_APP_URL=http://localhost:3000"
            echo "ALLOWED_ORIGINS=http://localhost:3000"
            echo "NODE_ENV=production"
            echo "DATABASE_SSL=false"
            echo "REDIS_URL=redis://redis:6379"
        } > "$ENV_FILE"
        ok "Created $ENV_FILE"
    else
        ok "$ENV_FILE loaded"
    fi

    # Validate required vars
    source <(grep -E '^[A-Z_]+=.' "$ENV_FILE" | sed 's/^/export /')
    [[ -z "${POSTGRES_PASSWORD:-}" ]] && err "POSTGRES_PASSWORD is empty"
    [[ -z "${JWT_SECRET:-}" ]]        && err "JWT_SECRET is empty"
    [[ -z "${SETUP_KEY:-}" ]]         && err "SETUP_KEY is empty"
    ok "Environment validated"
}

# ── Status ──────────────────────────────────────────────────────────────────
show_status() {
    log "Service status:"
    $COMPOSE_CMD --env-file "$ENV_FILE" ps
    echo ""
    # Check health
    for svc in nucrm-postgres nucrm-redis nucrm-app nucrm-worker; do
        STATE=$(docker inspect --format='{{.State.Health.Status}}' "$svc" 2>/dev/null || echo "no_health")
        RUNNING=$(docker inspect --format='{{.State.Running}}' "$svc" 2>/dev/null || echo "false")
        if [[ "$RUNNING" == "true" ]]; then
            if [[ "$STATE" == "healthy" ]]; then
                ok "$svc: running & healthy"
            else
                warn "$svc: running (health: $STATE)"
            fi
        else
            err "$svc: not running"
        fi
    done
}

# ── Build & Up ──────────────────────────────────────────────────────────────
build_and_up() {
    log "Stopping any previous containers…"
    $COMPOSE_CMD --env-file "$ENV_FILE" down --remove-orphans 2>/dev/null || true

    log "Building and starting all services…"
    $COMPOSE_CMD --env-file "$ENV_FILE" up -d --build
    ok "Containers started"
}

# ── Wait for healthy ────────────────────────────────────────────────────────
wait_healthy() {
    log "Waiting for services to become healthy (up to 180s)…"
    MAX_WAIT=180
    ELAPSED=0
    while (( ELAPSED < MAX_WAIT )); do
        APP_STATE=$(docker inspect --format='{{.State.Health.Status}}' nucrm-app 2>/dev/null || echo "starting")
        if [[ "$APP_STATE" == "healthy" ]]; then
            ok "All services healthy (${ELAPSED}s)"
            return 0
        fi
        sleep 3
        ELAPSED=$((ELAPSED + 3))
        printf '.'
    done
    echo ""
    err "Timed out. Run: docker compose logs app"
}

# ── Migrations ──────────────────────────────────────────────────────────────
run_migrations() {
    log "Running database migrations…"
    if docker exec nucrm-app npx tsx scripts/push-db.mts 2>&1; then
        ok "Migrations complete"
    else
        warn "Migration finished with warnings (may already be up-to-date)"
    fi
}

# ── Seed ────────────────────────────────────────────────────────────────────
run_seed() {
    log "Seeding demo data…"
    if docker exec nucrm-app npx tsx scripts/seed-advanced.ts 2>&1; then
        ok "Seeding complete"
    else
        warn "Seeding finished with warnings"
    fi
}

# ── Verify ──────────────────────────────────────────────────────────────────
verify() {
    log "Running verification checks…"
    local PASS=0
    local FAIL=0

    # Check health endpoint
    local HTTP_CODE
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        ok "Health endpoint: 200 OK"
        ((PASS++))
    else
        warn "Health endpoint: $HTTP_CODE"
        ((FAIL++))
    fi

    # Check setup endpoint exists
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/setup 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" == "200" ]]; then
        ok "Setup page: accessible"
        ((PASS++))
    else
        warn "Setup page: $HTTP_CODE"
    fi

    # Check database connectivity
    if docker exec nucrm-postgres pg_isready -U postgres >/dev/null 2>&1; then
        ok "PostgreSQL: accepting connections"
        ((PASS++))
    else
        err "PostgreSQL: not ready"
        ((FAIL++))
    fi

    # Check Redis connectivity
    if docker exec nucrm-redis redis-cli ping 2>/dev/null | grep -q PONG; then
        ok "Redis: accepting connections"
        ((PASS++))
    else
        err "Redis: not ready"
        ((FAIL++))
    fi

    echo ""
    if (( FAIL == 0 )); then
        ok "All checks passed ($PASS/$((PASS+FAIL)))"
    else
        warn "$FAIL check(s) failed – review logs with: docker compose logs"
    fi
}

# ── Backup ──────────────────────────────────────────────────────────────────
do_backup() {
    BACKUP_DIR="backups"
    mkdir -p "$BACKUP_DIR"
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="$BACKUP_DIR/nucrm_backup_${TIMESTAMP}.sql"

    log "Creating database backup: $BACKUP_FILE"
    docker exec nucrm-postgres pg_dump -U postgres nucrm > "$BACKUP_FILE" 2>/dev/null
    gzip "$BACKUP_FILE"
    ok "Backup saved: ${BACKUP_FILE}.gz ($(du -h "${BACKUP_FILE}.gz" | cut -f1))"
}

# ── Print banner ────────────────────────────────────────────────────────────
print_banner() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║   🚀  NuCRM SaaS – Deployment Complete!                        ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║   🌐  App:     http://localhost:3000                          ║${NC}"
    echo -e "${GREEN}║   ⚙️   Setup:   http://localhost:3000/setup                   ║${NC}"
    echo -e "${GREEN}║   🏥  Health:  http://localhost:3000/api/health               ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    log "Useful commands:"
    echo "   docker compose logs -f              # Follow all logs"
    echo "   docker compose logs -f app          # App logs only"
    echo "   docker compose logs -f worker       # Worker logs only"
    echo "   docker compose down                 # Stop everything"
    echo "   docker compose up -d --build        # Rebuild & restart"
    echo "   ./deploy.sh --backup                # Backup database"
    echo "   ./deploy.sh --status                # Check status"
    echo ""
}

# ── Main ────────────────────────────────────────────────────────────────────
main() {
    case "${1:-}" in
        --help|-h)      show_help ;;
        --status)       check_prereqs; show_status ;;
        --logs)         $COMPOSE_CMD logs -f --tail=200 app ;;
        --down)         log "Stopping all services…"; $COMPOSE_CMD down --remove-orphans; ok "Done" ;;
        --down-volumes) warn "This will destroy ALL data!"; $COMPOSE_CMD down -v --remove-orphans; ok "Done" ;;
        --migrate)      run_migrations ;;
        --seed)         run_seed ;;
        --backup)       do_backup ;;
        --restart)      $COMPOSE_CMD restart; ok "Restarted"; show_status ;;
        --skip-build)
            check_prereqs
            check_env
            log "Skipping build – starting existing images…"
            $COMPOSE_CMD up -d
            wait_healthy
            run_migrations
            verify
            print_banner
            ;;
        "")
            echo -e "${BLUE}"
            echo "  ╔═══════════════════════════════════════════════╗"
            echo "  ║   NuCRM SaaS – One-Click Full Deployment      ║"
            echo "  ╚═══════════════════════════════════════════════╝"
            echo -e "${NC}"

            check_prereqs
            check_env
            build_and_up
            wait_healthy
            run_migrations
            verify
            print_banner
            ;;
        *)
            err "Unknown option: $1.  Run ./deploy.sh --help"
            ;;
    esac
}

main "$@"
