#!/bin/bash
# ===================================================================
# Quick Restart Script - Use this when app dies
# ===================================================================
# Usage: ./scripts/restart.sh
# ===================================================================

cd /project/workspace/nucrm-saas/nucrm-saas-backup

echo "🔄 Restarting NuCRM..."

# Kill existing processes
echo "⏹️  Stopping existing processes..."
pkill -9 -f "next" 2>/dev/null || true
pkill -9 -f "next-server" 2>/dev/null || true
sleep 2

# Clean up zombie processes
echo "🧹 Cleaning zombie processes..."
for pid in $(ps aux | grep "next" | grep "defunct" | awk '{print $2}' 2>/dev/null); do
    kill -9 $pid 2>/dev/null || true
done
sleep 1

# Start fresh
echo "🚀 Starting app..."
export PATH="/usr/bin:$PATH"
export NODE_OPTIONS="--max-old-space-size=4096"

# Start in background
nohup npm run dev > /tmp/nucrm-dev.log 2>&1 &
NEW_PID=$!

echo "⏳ Waiting for app to start..."
sleep 20

# Verify
if ps -p $NEW_PID > /dev/null 2>&1; then
    echo ""
    echo "✅ App restarted successfully!"
    echo ""
    echo "📊 Status:"
    echo "   PID: $NEW_PID"
    echo "   URL: http://localhost:3000"
    echo "   Setup: http://localhost:3000/setup"
    echo ""
    echo "📝 View logs: tail -f /tmp/nucrm-dev.log"
    echo ""
    echo "🔄 If app dies again, run: ./scripts/restart.sh"
else
    echo ""
    echo "❌ App failed to start"
    echo ""
    echo "📝 Check logs: tail -50 /tmp/nucrm-dev.log"
fi
