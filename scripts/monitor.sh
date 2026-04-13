#!/bin/bash
# ===================================================================
# NuCRM SaaS - Process Monitor & Auto-Restart
# ===================================================================
# This script monitors the app and restarts it if it dies
# Run in background: nohup ./scripts/monitor.sh &
# ===================================================================

set -e

# Configuration
APP_DIR="/project/workspace/nucrm-saas-nucrm-saas-backup"
LOG_FILE="/tmp/nucrm-monitor.log"
APP_LOG_FILE="/tmp/nucrm-dev.log"
MAX_RESTARTS=10
RESTART_DELAY=5
CHECK_INTERVAL=10

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

start_app() {
    log "${BLUE}Starting NuCRM application...${NC}"
    
    cd "$APP_DIR"
    
    # Set environment
    export PATH="/usr/bin:$PATH"
    export NODE_OPTIONS="--max-old-space-size=4096"
    
    # Kill any existing processes
    pkill -9 -f "next-server" 2>/dev/null || true
    pkill -9 -f "next dev" 2>/dev/null || true
    sleep 2
    
    # Start app in background
    nohup npm run dev > "$APP_LOG_FILE" 2>&1 &
    APP_PID=$!
    
    log "${GREEN}App started with PID: $APP_PID${NC}"
    
    # Wait for app to be ready
    sleep 10
    
    # Check if app is running
    if ps -p $APP_PID > /dev/null 2>&1; then
        log "${GREEN}App is running${NC}"
        return 0
    else
        log "${RED}App failed to start${NC}"
        return 1
    fi
}

check_app() {
    # Check if process is running
    if ! pgrep -f "next-server" > /dev/null 2>&1; then
        return 1
    fi
    
    # Check if process is zombie
    if ps aux | grep "next-server" | grep -v grep | grep "defunct" > /dev/null 2>&1; then
        return 1
    fi
    
    # Check if port is listening
    if ! (netstat -tlnp 2>/dev/null | grep -q ":3000" || ss -tlnp 2>/dev/null | grep -q ":3000"); then
        return 1
    fi
    
    return 0
}

# Main monitoring loop
RESTART_COUNT=0
START_TIME=$(date +%s)

log "${GREEN}=====================================${NC}"
log "${GREEN}  NuCRM Process Monitor Started${NC}"
log "${GREEN}=====================================${NC}"

# Initial start
start_app || exit 1

while true; do
    sleep $CHECK_INTERVAL
    
    if ! check_app; then
        log "${RED}App is not running! Attempting restart...${NC}"
        
        # Check restart count
        if [ $RESTART_COUNT -ge $MAX_RESTARTS ]; then
            ELAPSED=$(($(date +%s) - START_TIME))
            if [ $ELAPSED -gt 3600 ]; then
                # Reset counter after 1 hour
                RESTART_COUNT=0
                START_TIME=$(date +%s)
                log "${YELLOW}Reset restart counter${NC}"
            else
                log "${RED}Max restarts ($MAX_RESTARTS) reached. Giving up.${NC}"
                exit 1
            fi
        fi
        
        # Wait before restart
        sleep $RESTART_DELAY
        
        # Try to restart
        if start_app; then
            RESTART_COUNT=$((RESTART_COUNT + 1))
            log "${GREEN}Restart $RESTART_COUNT/$MAX_RESTARTS successful${NC}"
        else
            log "${RED}Failed to restart app${NC}"
        fi
    else
        # Log status every 5 minutes
        if [ $(($(date +%s) % 300)) -eq 0 ]; then
            log "${GREEN}App is healthy${NC}"
        fi
    fi
done
