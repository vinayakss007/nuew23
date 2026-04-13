#!/bin/bash
# ===================================================================
# NuCRM SaaS - Docker Development Environment Setup
# ===================================================================
# Usage: ./scripts/setup-docker.sh [start|stop|restart|logs|clean]
# ===================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
COMPOSE_FILE="docker-compose.dev.yml"
PROJECT_NAME="nucrm-dev"

# Functions
print_header() {
    echo -e "${BLUE}=====================================${NC}"
    echo -e "${BLUE}  NuCRM Docker Setup${NC}"
    echo -e "${BLUE}=====================================${NC}"
    echo ""
}

print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    # Check for Docker Compose V2 plugin or standalone
    if command -v docker-compose &> /dev/null; then
        COMPOSE_CMD="docker-compose"
        print_status "Docker Compose (standalone) is installed"
    elif docker compose version &> /dev/null; then
        COMPOSE_CMD="docker compose"
        print_status "Docker Compose (plugin) is installed"
    else
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
}

check_ports() {
    local ports=("5432:PostgreSQL" "6379:Redis" "9000:Sentry" "3100:Grafana" "9090:Prometheus" "9100:Node Exporter" "8080:cAdvisor")
    
    for port_info in "${ports[@]}"; do
        port="${port_info%%:*}"
        service="${port_info##*:}"
        if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1 ; then
            print_warning "Port $port is in use ($service). Stopping any existing containers..."
            docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME stop 2>/dev/null || true
            break
        fi
    done
}

setup_directories() {
    print_status "Setting up directories..."
    
    # Create monitoring directories
    mkdir -p monitoring/grafana/dashboards
    mkdir -p monitoring/grafana/datasources
    mkdir -p monitoring/prometheus
    
    # Create Grafana datasources config
    cat > monitoring/grafana/datasources/datasources.yml << 'EOF'
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
EOF
    
    # Create Grafana dashboards config
    cat > monitoring/grafana/dashboards/dashboards.yml << 'EOF'
apiVersion: 1

providers:
  - name: 'NuCRM Dashboards'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    options:
      path: /etc/grafana/provisioning/dashboards
EOF
    
    # Create Prometheus config
    cat > monitoring/prometheus.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
  
  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
  
  - job_name: 'cadvisor'
    static_configs:
      - targets: ['cadvisor:8080']
  
  - job_name: 'grafana'
    static_configs:
      - targets: ['grafana:3000']
  
  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres:5432']
  
  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']
EOF
    
    print_status "Monitoring directories created"
}

start_services() {
    print_status "Starting Docker services..."
    
    # Pull images
    echo -e "${YELLOW}Pulling latest images...${NC}"
    $COMPOSE_CMD -f $COMPOSE_FILE -p $PROJECT_NAME pull
    
    # Start services
    echo -e "${YELLOW}Starting services...${NC}"
    $COMPOSE_CMD -f $COMPOSE_FILE -p $PROJECT_NAME up -d
    
    # Wait for services to be healthy
    echo -e "${YELLOW}Waiting for services to be healthy...${NC}"
    sleep 10
    
    # Check service status
    echo ""
    echo -e "${BLUE}Service Status:${NC}"
    $COMPOSE_CMD -f $COMPOSE_FILE -p $PROJECT_NAME ps
}

stop_services() {
    print_status "Stopping Docker services..."
    $COMPOSE_CMD -f $COMPOSE_FILE -p $PROJECT_NAME stop
}

restart_services() {
    stop_services
    sleep 2
    start_services
}

show_logs() {
    $COMPOSE_CMD -f $COMPOSE_FILE -p $PROJECT_NAME logs -f "$@"
}

clean_all() {
    print_warning "This will remove all containers, volumes, and data!"
    read -p "Are you sure? (yes/no): " confirm
    
    if [ "$confirm" = "yes" ]; then
        print_status "Cleaning up..."
        $COMPOSE_CMD -f $COMPOSE_FILE -p $PROJECT_NAME down -v --remove-orphans
        print_status "Cleanup complete"
    else
        print_status "Cleanup cancelled"
    fi
}

show_access_info() {
    echo ""
    echo -e "${GREEN}=====================================${NC}"
    echo -e "${GREEN}  Services Access Information${NC}"
    echo -e "${GREEN}=====================================${NC}"
    echo ""
    echo -e "${BLUE}PostgreSQL:${NC}"
    echo "  Host: localhost:5432"
    echo "  Database: nucrm"
    echo "  Username: postgres"
    echo "  Password: postgres123"
    echo "  Connection: postgresql://postgres:postgres123@localhost:5432/nucrm"
    echo ""
    echo -e "${BLUE}Redis:${NC}"
    echo "  Host: localhost:6379"
    echo "  Connection: redis://localhost:6379"
    echo ""
    echo -e "${BLUE}Sentry:${NC}"
    echo "  URL: http://localhost:9000"
    echo "  Note: Run setup command to initialize Sentry"
    echo "  Command: docker exec -it sentry-web sentry create superuser"
    echo ""
    echo -e "${BLUE}Grafana:${NC}"
    echo "  URL: http://localhost:3100"
    echo "  Username: admin"
    echo "  Password: admin123"
    echo ""
    echo -e "${BLUE}Prometheus:${NC}"
    echo "  URL: http://localhost:9090"
    echo ""
    echo -e "${BLUE}Node Exporter:${NC}"
    echo "  URL: http://localhost:9100"
    echo ""
    echo -e "${BLUE}cAdvisor:${NC}"
    echo "  URL: http://localhost:8080"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "1. Copy .env.docker to .env.local"
    echo "2. Run: npm run dev"
    echo "3. Access app at: http://localhost:3000"
    echo ""
}

# Main script
print_header
check_docker

case "${1:-start}" in
    start)
        check_ports
        setup_directories
        start_services
        show_access_info
        ;;
    stop)
        stop_services
        ;;
    restart)
        restart_services
        show_access_info
        ;;
    logs)
        shift
        show_logs "$@"
        ;;
    clean)
        clean_all
        ;;
    status)
        docker-compose -f $COMPOSE_FILE -p $PROJECT_NAME ps
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|logs|clean|status}"
        echo ""
        echo "Commands:"
        echo "  start   - Start all services"
        echo "  stop    - Stop all services"
        echo "  restart - Restart all services"
        echo "  logs    - Show service logs"
        echo "  clean   - Remove all containers and volumes"
        echo "  status  - Show service status"
        exit 1
        ;;
esac

print_status "Done!"
