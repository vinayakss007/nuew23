#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# NuCRM SaaS — Post-Installation Test Script
# Run this after every deployment to verify everything works
# Usage: ./scripts/test-after-install.sh
# ──────────────────────────────────────────────────────────────

# Do NOT use set -e — we track pass/fail ourselves

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BASE_URL="${BASE_URL:-http://localhost:3000}"
PASS=0
FAIL=0
WARN=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Helpers ──────────────────────────────────────────────────
log() { echo -e "${BLUE}[TEST]${NC} $1"; }
pass() { echo -e "${GREEN}  ✅ PASS${NC}  $1"; ((PASS++)); }
fail() { echo -e "${RED}  ❌ FAIL${NC}  $1"; ((FAIL++)); }
warn() { echo -e "${YELLOW}  ⚠️  WARN${NC}  $1"; ((WARN++)); }

separator() { echo -e "\n${BLUE}──────────────────────────────────────────────────${NC}"; }

# ── Welcome ─────────────────────────────────────────────────
separator
echo -e "${BLUE}  NuCRM SaaS — Post-Installation Test Suite${NC}"
echo -e "  Base URL: ${BASE_URL}"
separator

# ── 1. Docker Container Health ─────────────────────────────
log "Checking Docker containers..."
if command -v docker &>/dev/null && docker compose ps 2>/dev/null | grep -q "nucrm-app"; then
  APP_STATUS=$(docker compose ps --format json 2>/dev/null | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line)
        if 'app' in d.get('Service',''):
            print(d.get('State','unknown'))
    except: pass
" 2>/dev/null || echo "unknown")
  if [ "$APP_STATUS" = "running" ]; then
    pass "nucrm-app container is running"
  else
    fail "nucrm-app container status: $APP_STATUS"
  fi

  if docker compose ps 2>/dev/null | grep -q "postgres.*healthy"; then
    pass "PostgreSQL is healthy"
  else
    fail "PostgreSQL is not healthy"
  fi

  if docker compose ps 2>/dev/null | grep -q "redis.*healthy"; then
    pass "Redis is healthy"
  else
    fail "Redis is not healthy"
  fi
else
  warn "Docker compose not found or nucrm not running — skipping container checks"
fi

# ── 2. Health API ──────────────────────────────────────────
log "Checking /api/health..."
HEALTH_RESPONSE=$(curl -sf "${BASE_URL}/api/health" 2>/dev/null || echo '{"error":"timeout"}')
DB_STATUS=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('db','fail'))" 2>/dev/null || echo "fail")
REDIS_STATUS=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('redis','fail'))" 2>/dev/null || echo "fail")
SCHEMA_STATUS=$(echo "$HEALTH_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('schema_ready','fail'))" 2>/dev/null || echo "fail")
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/health" 2>/dev/null || echo "000")

if [ "$DB_STATUS" = "connected" ]; then
  pass "Database connected ($DB_STATUS)"
else
  fail "Database not connected: $DB_STATUS"
fi

if [ "$REDIS_STATUS" = "connected" ]; then
  pass "Redis connected"
else
  warn "Redis not connected: $REDIS_STATUS"
fi

if [ "$STATUS_CODE" = "200" ]; then
  pass "Health endpoint returns HTTP 200"
else
  fail "Health endpoint returns HTTP $STATUS_CODE"
fi

# ── 3. Homepage ────────────────────────────────────────────
log "Checking homepage (/)..."
HOME_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/" 2>/dev/null || echo "000")
HOME_CONTENT=$(curl -s "${BASE_URL}/" 2>/dev/null || echo "")

if [ "$HOME_CODE" = "200" ]; then
  pass "Homepage returns HTTP 200"
else
  fail "Homepage returns HTTP $HOME_CODE"
fi

if echo "$HOME_CONTENT" | grep -q "NuCRM"; then
  pass "Homepage contains NuCRM branding"
else
  fail "Homepage missing NuCRM branding"
fi

# ── 4. Setup Page ──────────────────────────────────────────
log "Checking setup page (/setup)..."
SETUP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/setup" 2>/dev/null || echo "000")

if [ "$SETUP_CODE" = "200" ]; then
  pass "Setup page returns HTTP 200"
else
  fail "Setup page returns HTTP $SETUP_CODE"
fi

# Check if setup is already done
SETUP_CHECK=$(curl -s "${BASE_URL}/api/setup/check" 2>/dev/null || echo '{}')
SETUP_DONE=$(echo "$SETUP_CHECK" | python3 -c "import sys,json; v=json.load(sys.stdin).get('setup_done','unknown'); print(str(v).lower())" 2>/dev/null || echo "unknown")

if [ "$SETUP_DONE" = "true" ]; then
  pass "Setup already completed (admin exists)"
  # Show existing admin
  if command -v docker &>/dev/null; then
    echo -e "${GREEN}  Existing super admins:${NC}"
    docker exec nucrm-postgres psql -U postgres -d nucrm -t -c "SELECT email, full_name FROM public.users WHERE is_super_admin = true;" 2>/dev/null | sed 's/^/    /'
  fi
elif [ "$SETUP_DONE" = "false" ]; then
  pass "Setup page ready for first-time registration"
  echo -e "${YELLOW}  Setup Key: ${NC}$(echo $SETUP_KEY)"
else
  warn "Could not determine setup status: $SETUP_DONE"
fi

# ── 5. Static Assets ───────────────────────────────────────
log "Checking static assets (CSS/JS)..."
CSS_FILES=$(curl -s "${BASE_URL}/" 2>/dev/null | grep -oP '_next/static/chunks/[^"]+\.css' | sort -u | head -1)

if [ -n "$CSS_FILES" ]; then
  CSS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/${CSS_FILES}" 2>/dev/null || echo "000")
  CSS_SIZE=$(curl -s "${BASE_URL}/${CSS_FILES}" 2>/dev/null | wc -c)
  if [ "$CSS_CODE" = "200" ] && [ "$CSS_SIZE" -gt 1000 ]; then
    pass "CSS loaded: $CSS_FILES ($CSS_SIZE bytes)"
  else
    fail "CSS failed: $CSS_FILES (HTTP $CSS_CODE, $CSS_SIZE bytes)"
  fi

  # Check for uncompiled @tailwind directives
  TAILWIND_RAW=$(curl -s "${BASE_URL}/${CSS_FILES}" 2>/dev/null | grep -c "@tailwind" || true)
  if [ "$TAILWIND_RAW" -eq 0 ]; then
    pass "CSS is properly compiled (no raw @tailwind)"
  else
    fail "CSS contains uncompiled @tailwind directives!"
  fi
else
  warn "No CSS files found in homepage"
fi

JS_FILES=$(curl -s "${BASE_URL}/" 2>/dev/null | grep -oP '_next/static/chunks/[^"]+\.js' | sort -u | head -5)
if [ -n "$JS_FILES" ]; then
  JS_FAIL=0
  for f in $JS_FILES; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/${f}" 2>/dev/null || echo "000")
    if [ "$code" != "200" ]; then
      fail "JS chunk failed: $f"
      ((JS_FAIL++))
    fi
  done
  if [ "$JS_FAIL" -eq 0 ]; then
    pass "All JS chunks loaded successfully ($(echo "$JS_FILES" | wc -l) checked)"
  fi
else
  warn "No JS files found in homepage"
fi

# ── 6. Database Schema Validation ──────────────────────────
log "Checking database schema..."
if command -v docker &>/dev/null && docker compose ps 2>/dev/null | grep -q "postgres.*healthy"; then
  # Check required tables
  REQUIRED_TABLES="users tenants plans tenant_members contacts leads deals sessions"
  for table in $REQUIRED_TABLES; do
    EXISTS=$(docker exec nucrm-postgres psql -U postgres -d nucrm -t -c "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$table');" 2>/dev/null | tr -d '[:space:]')
    if [ "$EXISTS" = "t" ]; then
      pass "Table '$table' exists"
    else
      fail "Table '$table' is MISSING"
    fi
  done

  # Check required columns in tenants
  REQUIRED_COLS="current_users current_contacts current_deals plan_id"
  for col in $REQUIRED_COLS; do
    EXISTS=$(docker exec nucrm-postgres psql -U postgres -d nucrm -t -c "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='$col');" 2>/dev/null | tr -d '[:space:]')
    if [ "$EXISTS" = "t" ]; then
      pass "Column 'tenants.$col' exists"
    else
      fail "Column 'tenants.$col' is MISSING"
    fi
  done

  # Check plans exist
  PLAN_COUNT=$(docker exec nucrm-postgres psql -U postgres -d nucrm -t -c "SELECT count(*) FROM public.plans;" 2>/dev/null | tr -d '[:space:]')
  if [ "$PLAN_COUNT" -gt 0 ]; then
    pass "Plans table has $PLAN_COUNT plans"
  else
    fail "Plans table is empty"
  fi
else
  warn "PostgreSQL not available — skipping schema checks"
fi

# ── 7. ngrok Status (if applicable) ────────────────────────
if curl -sf http://127.0.0.1:4040/api/tunnels &>/dev/null; then
  log "Checking ngrok tunnel..."
  NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['tunnels'][0]['public_url'])" 2>/dev/null || echo "unknown")
  if [ "$NGROK_URL" != "unknown" ]; then
    pass "ngrok tunnel active: $NGROK_URL"
  else
    warn "Could not determine ngrok URL"
  fi
fi

# ── Summary ────────────────────────────────────────────────
separator
echo -e "${BLUE}  Test Summary${NC}"
separator
echo -e "  ${GREEN}✅ Passed: $PASS${NC}"
echo -e "  ${RED}❌ Failed: $FAIL${NC}"
echo -e "  ${YELLOW}⚠️  Warnings: $WARN${NC}"
separator

if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}  🎉 All critical tests passed! NuCRM is ready to use.${NC}"
  echo -e "${GREEN}  URL: ${BASE_URL}${NC}"
  exit 0
else
  echo -e "${RED}  🚨 $FAIL test(s) failed. Please review the errors above.${NC}"
  exit 1
fi
