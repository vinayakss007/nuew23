#!/bin/bash
# ===================================================================
# NuCRM SaaS - Start Script with Node 25
# ===================================================================
# This script ensures Node.js 25+ is used to run the application
# Usage: ./scripts/start.sh
# ===================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}  NuCRM SaaS - Starting${NC}"
echo -e "${BLUE}=====================================${NC}"
echo ""

# Check for Node.js 25+
NODE_PATH=""
if [ -f "/usr/bin/node" ]; then
    NODE_VERSION=$(/usr/bin/node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge "25" ] 2>/dev/null; then
        NODE_PATH="/usr/bin"
        echo -e "${GREEN}✓${NC} Found Node.js 25+ at /usr/bin/node"
    fi
fi

if [ -f "/usr/local/bin/node" ]; then
    NODE_VERSION=$(/usr/local/bin/node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge "25" ] 2>/dev/null && [ -z "$NODE_PATH" ]; then
        NODE_PATH="/usr/local/bin"
        echo -e "${GREEN}✓${NC} Found Node.js 25+ at /usr/local/bin/node"
    fi
fi

# Fallback to PATH
if [ -z "$NODE_PATH" ]; then
    NODE_VERSION=$(node --version 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge "25" ] 2>/dev/null; then
        NODE_PATH=$(which node | xargs dirname)
        echo -e "${GREEN}✓${NC} Found Node.js 25+ in PATH"
    fi
fi

# If no Node 25+ found, check if we can install it
if [ -z "$NODE_PATH" ]; then
    echo -e "${YELLOW}⚠${NC} Node.js 25+ not found. Current version:"
    node --version 2>/dev/null || echo "Node.js not found"
    echo ""
    echo -e "${YELLOW}Installing Node.js 25...${NC}"
    
    if command -v apt &> /dev/null; then
        # Add NodeSource repository
        curl -fsSL https://deb.nodesource.com/setup_25.x | bash - > /dev/null 2>&1
        apt install nodejs -y > /dev/null 2>&1
        
        if [ -f "/usr/bin/node" ]; then
            NODE_PATH="/usr/bin"
            echo -e "${GREEN}✓${NC} Node.js 25 installed successfully"
        fi
    fi
fi

# Final check
if [ -z "$NODE_PATH" ]; then
    echo -e "${RED}✗${NC} Could not find or install Node.js 25+"
    echo ""
    echo "Please install Node.js 25+ manually:"
    echo "  curl -fsSL https://deb.nodesource.com/setup_25.x | bash -"
    echo "  apt install nodejs -y"
    exit 1
fi

echo ""
echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}  Node.js Version:${NC} $($NODE_PATH/node --version)"
echo -e "${GREEN}  npm Version:${NC} $($NODE_PATH/npm --version)"
echo -e "${GREEN}=====================================${NC}"
echo ""

# Export PATH with Node 25 first
export PATH="$NODE_PATH:$PATH"

# Change to app directory
cd "$(dirname "$0")/.."

# Check if .env.local exists
if [ ! -f ".env.local" ]; then
    echo -e "${YELLOW}⚠${NC} .env.local not found. Creating from .env.docker..."
    cp -n .env.docker .env.local 2>/dev/null || cp -n .env.local.example .env.local 2>/dev/null || true
fi

# Start the application
echo -e "${BLUE}Starting NuCRM development server...${NC}"
echo ""

# Use nohup to keep process running
nohup npm run dev > /tmp/nucrm-dev.log 2>&1 &
PID=$!

echo -e "${GREEN}✓${NC} Server starting (PID: $PID)"
echo ""

# Wait for server to be ready
echo -e "${YELLOW}Waiting for server to start...${NC}"
for i in {1..30}; do
    if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null | grep -q "307\|200"; then
        echo -e "${GREEN}✓${NC} Server is ready!"
        echo ""
        echo -e "${GREEN}=====================================${NC}"
        echo -e "${GREEN}  NuCRM is running!${NC}"
        echo -e "${GREEN}=====================================${NC}"
        echo ""
        echo "Access the application:"
        echo "  http://localhost:3000"
        echo ""
        echo "First-time setup:"
        echo "  http://localhost:3000/setup"
        echo ""
        echo "View logs:"
        echo "  tail -f /tmp/nucrm-dev.log"
        echo ""
        echo "Stop server:"
        echo "  ./scripts/stop.sh"
        echo "  or: pkill -f 'next dev'"
        echo ""
        exit 0
    fi
    sleep 1
done

echo -e "${RED}✗${NC} Server failed to start. Check logs:"
echo "  tail -f /tmp/nucrm-dev.log"
exit 1
