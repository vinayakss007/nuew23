#!/bin/sh
# NuCRM Production Entrypoint
# 1. Validates env vars
# 2. Checks DB connectivity
# 3. Auto-applies schema if missing or incomplete (NEVER drops data)
# 4. Starts the server

set -e

echo "=========================================="
echo "  NuCRM SaaS v2 - Production Startup"
echo "=========================================="
echo ""

# ── 1. Environment Variable Validation ──────────────────
echo "🔍 Checking environment variables..."
MISSING=""
REQUIRED_VARS="DATABASE_URL JWT_SECRET NEXT_PUBLIC_APP_URL SETUP_KEY CRON_SECRET REDIS_URL ALLOWED_ORIGINS"

for var in $REQUIRED_VARS; do
  eval val=\$$var
  if [ -z "$val" ]; then
    MISSING="$MISSING $var"
  fi
done

if [ -n "$MISSING" ]; then
  echo "❌ Missing required environment variables:$MISSING"
  exit 1
fi

if [ ${#JWT_SECRET} -lt 32 ]; then
  echo "❌ JWT_SECRET must be at least 32 characters"
  exit 1
fi

if [ ${#SETUP_KEY} -lt 20 ]; then
  echo "❌ SETUP_KEY must be at least 20 characters"
  exit 1
fi

echo "   ✅ All required env vars are set"
echo ""

# ── 2. Database Connectivity Check ──────────────────────
echo "🔍 Checking database connectivity..."
DB_OK=$(npx tsx -e "
const { Pool } = require('pg');
const sslMode = process.env.DATABASE_SSL === 'false';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslMode ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
pool.query('SELECT 1').then(() => { console.log('ok'); pool.end(); }).catch(() => { console.log('fail'); pool.end(); });
" 2>/dev/null || echo "fail")

if [ "$DB_OK" != "ok" ]; then
  echo "❌ Cannot connect to database at $(echo $DATABASE_URL | sed 's/.*@//' | sed 's|/.*||')"
  echo "   Check DATABASE_URL and ensure Postgres is running."
  exit 1
fi

echo "   ✅ Database is reachable"
echo ""

# ── 3. Auto Schema Check & Apply ───────────────────────
echo "🔍 Checking database schema..."
SCHEMA_STATUS=$(npx tsx -e "
const { Pool } = require('pg');
const sslMode = process.env.DATABASE_SSL === 'false';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslMode ? false : { rejectUnauthorized: false } });
const required = ['users','sessions','tenants','plans','contacts'];
pool.query(
  \"SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY(\$1)\",
  [required]
).then(r => {
  const existing = r.rows.map(row => row.tablename);
  const missing = required.filter(t => !existing.includes(t));
  console.log(missing.length === 0 ? 'ready' : missing.join(','));
  pool.end();
}).catch(() => { console.log('error'); pool.end(); });
" 2>/dev/null || echo "error")

if [ "$SCHEMA_STATUS" = "ready" ]; then
  echo "   ✅ Schema is up to date — no migrations needed"
else
  echo "   ⚠️  Schema missing or incomplete: $SCHEMA_STATUS"
  echo "   Running migrations..."
  echo ""
  npx tsx scripts/push-db.mts 2>&1 || {
    echo ""
    echo "❌ Schema migration failed!"
    echo "   The database is untouched (all migrations run in transactions)."
    echo "   Check DATABASE_URL and try again."
    exit 1
  }
  echo ""
fi

# ── 4. Summary ──────────────────────────────────────────
echo "=========================================="
echo "  ✅ All preflight checks passed"
echo "=========================================="
echo ""
echo "  Database:  $(echo $DATABASE_URL | sed 's/.*@//' | sed 's|/.*||')"
echo "  Redis:     $(echo $REDIS_URL)"
echo "  Node:      $(node -v)"
echo "  JWT:       $(echo ${#JWT_SECRET}) chars"
echo "  SETUP_KEY: $(echo ${#SETUP_KEY}) chars"
echo ""
echo "  Starting server..."
echo ""

# ── 5. Start the application ────────────────────────────
exec "$@"
