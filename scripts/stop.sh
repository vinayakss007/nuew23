#!/bin/bash
# ===================================================================
# NuCRM SaaS - Stop Script
# ===================================================================
# Usage: ./scripts/stop.sh
# ===================================================================

set -e

echo "Stopping NuCRM development server..."

# Kill Next.js processes
pkill -f "next dev" 2>/dev/null || true
pkill -f "next-server" 2>/dev/null || true

# Wait for port to be released
sleep 2

# Check if port 3000 is still in use
if netstat -tlnp 2>/dev/null | grep -q ":3000" || ss -tlnp 2>/dev/null | grep -q ":3000"; then
    echo "Warning: Port 3000 still in use. Force killing..."
    pkill -9 -f "next" 2>/dev/null || true
    sleep 2
fi

echo "✓ Server stopped"
