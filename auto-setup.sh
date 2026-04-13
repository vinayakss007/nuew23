#!/bin/bash
# ============================================
# 🚀 NuCRM One-Click Auto Setup
# Clean. Lean. Automatic.
# ============================================
set -e

NGROK="/teamspace/studios/this_studio/.ngrok/ngrok"
DIR="/teamspace/studios/this_studio/NUCRM"
cd "$DIR"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║   🚀 NuCRM One-Click Setup          ║"
echo "╚══════════════════════════════════════╝"
echo ""

# 1. Load env
echo "🔑 Loading environment..."
export POSTGRES_PASSWORD=$(grep '^POSTGRES_PASSWORD=' .env.local | cut -d= -f2-)
export JWT_SECRET=$(grep '^JWT_SECRET=' .env.local | cut -d= -f2-)
export SETUP_KEY=$(grep '^SETUP_KEY=' .env.local | cut -d= -f2-)
export CRON_SECRET=$(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)

# 2. Fresh start
echo "🧹 Cleaning old data..."
docker compose down -v 2>/dev/null || true
pkill -f "next start" 2>/dev/null || true
pkill -f "ngrok" 2>/dev/null || true
sleep 2

# 3. Docker
echo "🐳 Starting databases..."
docker compose up -d postgres redis
echo "⏳ Waiting for databases..."
sleep 8

# 4. Node setup
echo "📦 Setting up Node.js..."
export NVM_DIR="/teamspace/studios/this_studio/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22.22.2 > /dev/null 2>&1

# 5. DB Schema
DB_URL="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/nucrm"
echo "🗄️  Pushing database schema..."
DATABASE_URL="$DB_URL" npm run db:auto 2>&1 | grep -E "Applied|Skipped|Failed|ready" || true

# 6. Seed data
echo "📊 Seeding demo data (1000 contacts max)..."
DATABASE_URL="$DB_URL" node scripts/setup-demo-data.js 2>&1 | grep -E "Creating|Seeding|Inserted|complete|Summary|Tenant|User|Password|contacts" || true

# 7. Build & Start App
echo "🔨 Building Next.js app..."
npm run build > /dev/null 2>&1
echo "🌐 Starting app server on port 3000..."
npm run start &
sleep 3

# 8. ngrok
echo ""
echo "🔗 Starting ngrok tunnel..."
$NGROK http 3000 --log=stdout > /tmp/ngrok.log 2>&1 &
sleep 4

# 9. Get URL
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║          ✅ NuCRM IS LIVE!                      ║"
echo "╠══════════════════════════════════════════════════╣"
curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for t in data.get('tunnels', []):
        print(f'║  🌍 Public URL: {t[\"public_url\"]}' + ' ' * max(0, 44-len(t['public_url']))) + '║')
    print(f'║  📊 Dashboard: http://127.0.0.1:4040' + ' ' * 17 + '║')
except:
    print('║  🌍 Check ngrok dashboard below             ║')
" 2>/dev/null || echo "║  🌍 Check ngrok dashboard below             ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  👤 Login: admin@demo.com                       ║"
echo "║  🔑 Password: Demo123!@#                        ║"
echo "║  🛑 Stop: Ctrl+C                                ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

wait
