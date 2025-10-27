#!/bin/bash

##
## Droplet Resource Statistics Script
##
## Displays comprehensive resource usage statistics for a TronRelic
## droplet including CPU, memory, disk, and Docker container metrics.
##
## Usage:
##   ./scripts/droplet-stats.sh [env]
##
## Arguments:
##   env    Environment (prod, dev) - defaults to prod
##
## Examples:
##   ./scripts/droplet-stats.sh
##   ./scripts/droplet-stats.sh prod
##   ./scripts/droplet-stats.sh dev
##

set -e  # Exit on error

# Source environment configuration
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/../droplet-config.sh"

# Parse arguments
ENV="${1:-prod}"

# Load environment configuration
get_config "$ENV"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Function to print colored output
print_header() {
    echo ""
    echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║  $1${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_section() {
    echo ""
    echo -e "${BLUE}▶ $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

print_good() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Function to calculate percentage bar
print_bar() {
    local percent=$1
    local width=30
    local filled=$((percent * width / 100))
    local empty=$((width - filled))

    # Color based on usage
    local color=$GREEN
    if [ $percent -gt 80 ]; then
        color=$RED
    elif [ $percent -gt 60 ]; then
        color=$YELLOW
    fi

    echo -ne "${color}"
    printf '█%.0s' $(seq 1 $filled)
    echo -ne "${NC}"
    printf '░%.0s' $(seq 1 $empty)
    echo -ne " ${color}${percent}%%${NC}"
}

# Check SSH connection
if ! remote_exec "echo 'test'" > /dev/null 2>&1; then
    echo -e "${RED}Error: Cannot connect to $DROPLET_HOST${NC}"
    echo "Please ensure SSH is configured correctly"
    exit 1
fi

# Print header
clear
print_header "TronRelic ${ENV^^} Droplet Resource Statistics - $(date '+%Y-%m-%d %H:%M:%S')"

echo -e "${CYAN}Environment:${NC} ${ENV^^}"
echo -e "${CYAN}Host:${NC} $DROPLET_IP"
echo -e "${CYAN}Uptime:${NC} $(remote_exec 'uptime -p')"

# System Information
print_section "SYSTEM INFORMATION"

CORES=$(remote_exec 'nproc')
TOTAL_DISK=$(remote_exec "df -h / | awk 'NR==2 {print \$2}'")
TOTAL_RAM=$(remote_exec "free -h | awk 'NR==2 {print \$2}'")
OS_INFO=$(remote_exec "cat /etc/os-release | grep PRETTY_NAME | cut -d'\"' -f2")

echo "  CPU Cores:      $CORES"
echo "  Total RAM:      $TOTAL_RAM"
echo "  Total Disk:     $TOTAL_DISK"
echo "  OS:             $OS_INFO"

# Disk Usage
print_section "DISK USAGE"

DISK_DATA=$(remote_exec "df -h / | awk 'NR==2 {print \$3,\$2,\$5}'")
DISK_USED=$(echo $DISK_DATA | awk '{print $1}')
DISK_TOTAL=$(echo $DISK_DATA | awk '{print $2}')
DISK_PERCENT=$(echo $DISK_DATA | awk '{print $3}' | sed 's/%//')

echo "  Used: $DISK_USED / $TOTAL_DISK"
echo -n "  "
print_bar $DISK_PERCENT
echo ""

# Disk usage assessment
if [ $DISK_PERCENT -gt 80 ]; then
    print_error "Disk usage is critical (>80%)"
elif [ $DISK_PERCENT -gt 60 ]; then
    print_warning "Disk usage is high (>60%)"
else
    print_good "Disk usage is healthy"
fi

# Memory Usage
print_section "MEMORY USAGE"

RAM_DATA=$(remote_exec "free -h | awk 'NR==2 {print \$3,\$2,\$7}'")
RAM_USED=$(echo $RAM_DATA | awk '{print $1}')
RAM_TOTAL=$(echo $RAM_DATA | awk '{print $2}')
RAM_AVAILABLE=$(echo $RAM_DATA | awk '{print $3}')

# Calculate percentage (need to convert to MB for calculation)
RAM_USED_MB=$(remote_exec "free -m | awk 'NR==2 {print \$3}'")
RAM_TOTAL_MB=$(remote_exec "free -m | awk 'NR==2 {print \$2}'")
RAM_PERCENT=$((RAM_USED_MB * 100 / RAM_TOTAL_MB))

echo "  Used: $RAM_USED / $RAM_TOTAL (Available: $RAM_AVAILABLE)"
echo -n "  "
print_bar $RAM_PERCENT
echo ""

# Memory usage assessment
if [ $RAM_PERCENT -gt 85 ]; then
    print_error "Memory usage is critical (>85%)"
elif [ $RAM_PERCENT -gt 70 ]; then
    print_warning "Memory usage is high (>70%)"
else
    print_good "Memory usage is healthy"
fi

# CPU Load Average
print_section "CPU LOAD AVERAGE"

LOAD_AVG=$(remote_exec "uptime | awk -F'load average:' '{print \$2}'")
LOAD_1MIN=$(echo $LOAD_AVG | awk -F',' '{print $1}' | xargs)
LOAD_5MIN=$(echo $LOAD_AVG | awk -F',' '{print $2}' | xargs)
LOAD_15MIN=$(echo $LOAD_AVG | awk -F',' '{print $3}' | xargs)

echo "  1 min:  $LOAD_1MIN"
echo "  5 min:  $LOAD_5MIN"
echo "  15 min: $LOAD_15MIN"

# Load assessment (for 2 cores, load > 2 is concerning)
LOAD_1MIN_INT=$(echo $LOAD_1MIN | awk '{print int($1+0.5)}')
if [ $LOAD_1MIN_INT -gt 2 ]; then
    print_warning "Load is high for ${CORES}-core system"
else
    print_good "Load is normal"
fi

# Docker Container Stats
print_section "DOCKER CONTAINERS"

echo ""
remote_exec 'docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}" | column -t'

# Docker Disk Usage
print_section "DOCKER DISK USAGE"

echo ""
DOCKER_STATS=$(remote_exec 'docker system df --format "{{.Type}}\t{{.Size}}\t{{.Reclaimable}}"')

echo "$DOCKER_STATS" | while IFS=$'\t' read -r type size reclaimable; do
    if [ -n "$type" ]; then
        echo "  $type:"
        echo "    Total:       $size"
        echo "    Reclaimable: $reclaimable"
    fi
done

RECLAIMABLE_TOTAL=$(remote_exec 'docker system df --format "{{.Reclaimable}}" | awk "{sum += \$1} END {print sum}"')
if [ -n "$RECLAIMABLE_TOTAL" ] && [ "$RECLAIMABLE_TOTAL" != "0" ]; then
    echo ""
    print_warning "Run 'docker image prune -a' to reclaim space"
fi

# Database Volumes
print_section "DATABASE VOLUMES"

MONGO_SIZE=$(remote_exec "docker exec $MONGO_CONTAINER du -sh /data/db 2>/dev/null | awk '{print \$1}'" || echo "N/A")
REDIS_SIZE=$(remote_exec "docker exec $REDIS_CONTAINER du -sh /data 2>/dev/null | awk '{print \$1}'" || echo "N/A")

echo "  MongoDB: $MONGO_SIZE"
echo "  Redis:   $REDIS_SIZE"

# Service Health
print_section "SERVICE HEALTH"

# Check backend
if remote_exec "curl -sf http://localhost:4000/api/health > /dev/null 2>&1"; then
    print_good "Backend API is healthy"
else
    print_error "Backend API health check failed"
fi

# Check frontend
if remote_exec "curl -sf http://localhost:3000 > /dev/null 2>&1"; then
    print_good "Frontend is healthy"
else
    print_error "Frontend health check failed"
fi

# Container status
print_section "CONTAINER STATUS"
remote_exec "cd $DEPLOY_DIR && docker compose -f $COMPOSE_FILE ps --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null" || echo "  Unable to fetch container status"

# Summary & Recommendations
print_section "RECOMMENDATIONS"

SHOW_RECOMMENDATIONS=false

if [ $DISK_PERCENT -gt 60 ]; then
    print_warning "Consider cleaning up old Docker images"
    echo "    Command: ssh $DROPLET_HOST 'docker image prune -a'"
    SHOW_RECOMMENDATIONS=true
fi

if [ $RAM_PERCENT -gt 70 ]; then
    print_warning "Memory usage is high - consider upgrading RAM"
    SHOW_RECOMMENDATIONS=true
fi

if [ $LOAD_1MIN_INT -gt 2 ]; then
    print_warning "CPU load is high - consider upgrading CPU cores"
    SHOW_RECOMMENDATIONS=true
fi

if [ "$SHOW_RECOMMENDATIONS" = false ]; then
    print_good "All systems operating normally"
fi

# Footer
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
