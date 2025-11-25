#!/bin/bash
# docker.sh - Start TronRelic in full Docker mode
# All services (MongoDB, Redis, backend, frontend) run in Docker containers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse options passed from start.sh
COMPOSE_FILE="docker-compose.yml"
FORCE_BUILD=false
FORCE_DOCKER=false
PROD_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --force-build)
            FORCE_BUILD=true
            shift
            ;;
        --force-docker)
            FORCE_DOCKER=true
            shift
            ;;
        --prod)
            PROD_MODE=true
            export ENV=production
            shift
            ;;
        *)
            shift
            ;;
    esac
done

echo -e "${GREEN}Starting TronRelic in Docker mode...${NC}"
echo -e "${YELLOW}Mode: All services in Docker containers${NC}"
echo -e "${YELLOW}Compose file: ${COMPOSE_FILE}${NC}"

cd "${PROJECT_ROOT}"

# Handle force options
if [[ "$FORCE_DOCKER" == "true" ]]; then
    echo -e "\n${YELLOW}Force recreating containers...${NC}"
    docker-compose -f "${COMPOSE_FILE}" down -v
fi

# Start containers
if [[ "$FORCE_BUILD" == "true" ]]; then
    echo -e "\n${GREEN}Building and starting containers (--force-build)...${NC}"
    docker-compose -f "${COMPOSE_FILE}" up --build -d
else
    echo -e "\n${GREEN}Starting containers...${NC}"
    docker-compose -f "${COMPOSE_FILE}" up -d
fi

# Wait for backend health check
echo -e "\n${GREEN}Waiting for services to be healthy...${NC}"
max_attempts=60
attempts=0

while [[ $attempts -lt $max_attempts ]]; do
    # Check if backend container is healthy (if it exists in this compose file)
    if docker ps --format '{{.Names}}' | grep -q "tronrelic-backend"; then
        backend_health=$(docker inspect --format='{{.State.Health.Status}}' tronrelic-backend 2>/dev/null || echo "starting")

        if [[ "$backend_health" == "healthy" ]]; then
            echo -e "${GREEN}✓ Backend is healthy${NC}"
            break
        fi

        echo "  Backend: $backend_health (attempt $((attempts + 1))/$max_attempts)"
    else
        # No backend in this compose file (like docker-compose.dev.yml), just check MongoDB
        mongo_health=$(docker inspect --format='{{.State.Health.Status}}' tronrelic-mongo 2>/dev/null || echo "starting")

        if [[ "$mongo_health" == "healthy" ]]; then
            echo -e "${GREEN}✓ MongoDB is healthy${NC}"
            break
        fi

        echo "  MongoDB: $mongo_health (attempt $((attempts + 1))/$max_attempts)"
    fi

    sleep 2
    attempts=$((attempts + 1))
done

if [[ $attempts -eq $max_attempts ]]; then
    echo -e "${YELLOW}Warning: Services did not become healthy in time. Check logs.${NC}"
fi

# Success message
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}TronRelic is now running in Docker!${NC}"
echo -e "${GREEN}========================================${NC}"

if docker ps --format '{{.Names}}' | grep -q "tronrelic-frontend"; then
    echo -e "Frontend: ${YELLOW}http://localhost:3000${NC}"
fi

if docker ps --format '{{.Names}}' | grep -q "tronrelic-backend"; then
    echo -e "Backend:  ${YELLOW}http://localhost:4000${NC}"
fi

echo -e ""
echo -e "View logs:"
echo -e "  All:      ${YELLOW}docker-compose -f ${COMPOSE_FILE} logs -f${NC}"
if docker ps --format '{{.Names}}' | grep -q "tronrelic-backend"; then
    echo -e "  Backend:  ${YELLOW}docker-compose -f ${COMPOSE_FILE} logs -f backend${NC}"
fi
if docker ps --format '{{.Names}}' | grep -q "tronrelic-frontend"; then
    echo -e "  Frontend: ${YELLOW}docker-compose -f ${COMPOSE_FILE} logs -f frontend${NC}"
fi
echo -e ""
echo -e "Stop: ${YELLOW}./scripts/stop.sh${NC}"
echo -e "${GREEN}========================================${NC}"
