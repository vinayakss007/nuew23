#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# NuCRM SaaS - Cleanup Script
# Kills zombie processes and frees up ports (3000, 5432, 6379)
# ═══════════════════════════════════════════════════════════════

set -e

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         NuCRM SaaS - Process & Port Cleanup              ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Ports to check
PORTS=(3000 5432 6379)

# Track if we killed anything
KILLED_COUNT=0

# Function to kill process on a port
kill_port() {
    local port=$1
    echo -n "Checking port ${port}... "
    
    # Try different methods to find the process
    PID=$(lsof -t -i:${port} 2>/dev/null || true)
    
    if [ -z "$PID" ]; then
        # Try netstat
        PID=$(netstat -tlnp 2>/dev/null | grep ":${port}" | grep -oP '\d+(?=/)' | head -1 || true)
    fi
    
    if [ -z "$PID" ]; then
        # Try ss
        PID=$(ss -tlnp 2>/dev/null | grep ":${port}" | grep -oP 'pid=\K\d+' | head -1 || true)
    fi
    
    if [ -n "$PID" ]; then
        echo -e "${YELLOW}Found process: $PID${NC}"
        
        # Get process name
        PROC_NAME=$(ps -p $PID -o comm= 2>/dev/null || echo "unknown")
        echo "  └─ Process: $PROC_NAME (PID: $PID)"
        
        # Kill the process
        echo -n "  Killing... "
        kill -9 $PID 2>/dev/null && sleep 1
        echo -e "${GREEN}✓ Killed${NC}"
        KILLED_COUNT=$((KILLED_COUNT + 1))
    else
        echo -e "${GREEN}Free${NC}"
    fi
}

# Function to cleanup Docker containers
cleanup_docker() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Docker Cleanup"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Check if docker is available
    if ! command -v docker &> /dev/null; then
        echo -e "${YELLOW}Docker not found, skipping Docker cleanup${NC}"
        return
    fi
    
    # Stop and remove NuCRM containers
    echo "Stopping NuCRM containers..."
    docker compose -f docker-compose.yml down --remove-orphans 2>/dev/null || true
    
    # Remove dangling images
    echo "Removing dangling Docker images..."
    docker image prune -f 2>/dev/null || true
    
    echo -e "${GREEN}✓ Docker cleanup complete${NC}"
}

# Function to cleanup zombie processes
cleanup_zombies() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Zombie Process Cleanup"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Find zombie processes
    ZOMBIES=$(ps aux 2>/dev/null | awk '$8 ~ /^Z/ {print $2}' || true)
    
    if [ -n "$ZOMBIES" ]; then
        echo "Found zombie processes:"
        echo "$ZOMBIES" | while read -r pid; do
            echo -n "  Killing zombie PID $pid... "
            kill -9 $pid 2>/dev/null && echo -e "${GREEN}✓${NC}" || echo "failed"
            KILLED_COUNT=$((KILLED_COUNT + 1))
        done
    else
        echo -e "${GREEN}No zombie processes found${NC}"
    fi
}

# Function to cleanup Node processes related to Next.js
cleanup_node() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Node.js Process Cleanup"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Find Next.js related processes
    NEXT_PIDS=$(pgrep -f "next-server\|next dev\|next build\|next start" 2>/dev/null || true)
    
    if [ -n "$NEXT_PIDS" ]; then
        echo "Found Next.js processes:"
        echo "$NEXT_PIDS" | while read -r pid; do
            PROC_NAME=$(ps -p $pid -o comm= 2>/dev/null || echo "unknown")
            echo -n "  Killing $PROC_NAME (PID: $pid)... "
            kill -9 $pid 2>/dev/null && sleep 0.5 && echo -e "${GREEN}✓${NC}" || echo "failed"
            KILLED_COUNT=$((KILLED_COUNT + 1))
        done
    else
        echo -e "${GREEN}No Next.js processes found${NC}"
    fi
}

# Main execution
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Port Cleanup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

for port in "${PORTS[@]}"; do
    kill_port $port
done

# Cleanup Node.js processes
cleanup_node

# Cleanup zombie processes
cleanup_zombies

# Cleanup Docker
cleanup_docker

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $KILLED_COUNT -gt 0 ]; then
    echo -e "${GREEN}✓ Cleaned up $KILLED_COUNT process(es)${NC}"
else
    echo -e "${GREEN}✓ No cleanup needed - all ports are free${NC}"
fi

echo ""
echo "Ports status:"
for port in "${PORTS[@]}"; do
    if lsof -i:${port} &>/dev/null; then
        echo -e "  ${RED}✗ Port $port: STILL IN USE${NC}"
    else
        echo -e "  ${GREEN}✓ Port $port: Free${NC}"
    fi
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Cleanup complete! You can now start fresh."
echo "═══════════════════════════════════════════════════════════"
