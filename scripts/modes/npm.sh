#!/bin/bash
# npm.sh - Start TronRelic in npm-based development mode
# MongoDB and Redis run in Docker, backend and frontend run via npm

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
RUN_DIR="${PROJECT_ROOT}/.run"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Parse options
FORCE_BUILD=false
FORCE_DOCKER=false

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
        *)
            shift
            ;;
    esac
done

# Ensure .run directory exists
mkdir -p "${RUN_DIR}"

echo -e "${GREEN}Starting TronRelic in npm development mode...${NC}"
echo -e "${YELLOW}Mode: MongoDB/Redis in Docker + Backend/Frontend via npm${NC}"

# Ensure npm dependencies are installed
if [[ ! -d "${PROJECT_ROOT}/node_modules" ]]; then
    echo -e "\n${YELLOW}node_modules not found. Installing dependencies...${NC}"
    cd "${PROJECT_ROOT}"
    npm install
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "\n${GREEN}✓ Dependencies already installed${NC}"
fi

# Handle --force-build: clean all caches and dist directories
if [[ "$FORCE_BUILD" == "true" ]]; then
    echo -e "\n${YELLOW}--force-build specified: Cleaning all build artifacts...${NC}"

    # Clean TypeScript build info caches
    echo -e "  Removing .tsbuildinfo files..."
    find "${PROJECT_ROOT}" -name "*.tsbuildinfo" -type f -delete 2>/dev/null || true

    # Clean all dist directories
    echo -e "  Removing dist/ directories..."
    find "${PROJECT_ROOT}/apps" -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true
    find "${PROJECT_ROOT}/packages" -name "dist" -type d -exec rm -rf {} + 2>/dev/null || true

    # Clean Next.js cache
    echo -e "  Removing Next.js cache..."
    rm -rf "${PROJECT_ROOT}/apps/frontend/.next" 2>/dev/null || true

    # Clean node_modules/.cache
    echo -e "  Removing node_modules cache..."
    find "${PROJECT_ROOT}" -path "*/node_modules/.cache" -type d -exec rm -rf {} + 2>/dev/null || true

    echo -e "${GREEN}✓ Build artifacts cleaned${NC}"

    # Rebuild all workspaces
    echo -e "\n${GREEN}Rebuilding all workspaces...${NC}"
    cd "${PROJECT_ROOT}"
    # Load .env file for build process (required by Next.js config)
    set -a
    source "${PROJECT_ROOT}/.env" 2>/dev/null || true
    set +a
    npm run build --workspaces --if-present
    echo -e "${GREEN}✓ All workspaces rebuilt${NC}"
fi

# Start MongoDB and Redis containers
echo -e "\n${GREEN}Starting MongoDB and Redis containers...${NC}"
cd "${PROJECT_ROOT}"

# Handle --force-docker: recreate containers and volumes
if [[ "$FORCE_DOCKER" == "true" ]]; then
    echo -e "${YELLOW}--force-docker specified: Recreating containers and volumes...${NC}"
    docker-compose -f docker-compose.npm.yml down -v
fi

docker-compose -f docker-compose.npm.yml up -d

# Wait for containers to be healthy
echo -e "\n${GREEN}Waiting for containers to be healthy...${NC}"
max_attempts=30
attempts=0

while [[ $attempts -lt $max_attempts ]]; do
    mongo_health=$(docker inspect --format='{{.State.Health.Status}}' tronrelic-mongo 2>/dev/null || echo "starting")
    redis_health=$(docker inspect --format='{{.State.Health.Status}}' tronrelic-redis 2>/dev/null || echo "starting")
    clickhouse_health=$(docker inspect --format='{{.State.Health.Status}}' tronrelic-clickhouse 2>/dev/null || echo "starting")

    if [[ "$mongo_health" == "healthy" && "$redis_health" == "healthy" && "$clickhouse_health" == "healthy" ]]; then
        echo -e "${GREEN}✓ All containers are healthy${NC}"
        break
    fi

    echo "  MongoDB: $mongo_health, Redis: $redis_health, ClickHouse: $clickhouse_health (attempt $((attempts + 1))/$max_attempts)"
    sleep 2
    attempts=$((attempts + 1))
done

if [[ $attempts -eq $max_attempts ]]; then
    echo -e "${RED}✗ Containers did not become healthy in time${NC}"
    exit 1
fi

# Validate .env has localhost connection strings
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
    if ! grep -q "mongodb://127.0.0.1:27017" "${PROJECT_ROOT}/.env" 2>/dev/null; then
        echo -e "${YELLOW}Warning: .env may not have localhost MongoDB connection string${NC}"
        echo -e "${YELLOW}Expected: MONGODB_URI=mongodb://127.0.0.1:27017/tronrelic${NC}"
    fi
    if ! grep -q "redis://127.0.0.1:6379" "${PROJECT_ROOT}/.env" 2>/dev/null; then
        echo -e "${YELLOW}Warning: .env may not have localhost Redis connection string${NC}"
        echo -e "${YELLOW}Expected: REDIS_URL=redis://127.0.0.1:6379${NC}"
    fi
else
    echo -e "${RED}✗ .env file not found. Please copy .env.example to .env and configure it.${NC}"
    exit 1
fi

# Kill any stale processes on ports 3000 and 4000
echo -e "\n${GREEN}Checking for stale processes on ports 3000 and 4000...${NC}"
for port in 3000 4000; do
    if lsof -ti:${port} >/dev/null 2>&1; then
        echo -e "  ${YELLOW}Killing process on port ${port}${NC}"
        lsof -ti:${port} | xargs kill -9 2>/dev/null || true
        sleep 0.5
    fi
done

# Start backend npm process
echo -e "\n${GREEN}Starting backend via npm...${NC}"
cd "${PROJECT_ROOT}"
# Set DOTENV_CONFIG_PATH to load .env from project root
DOTENV_CONFIG_PATH="${PROJECT_ROOT}/.env" npm run dev --workspace apps/backend > "${RUN_DIR}/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "${RUN_DIR}/backend.pid"
echo -e "  Backend PID: $BACKEND_PID (logs: .run/backend.log)"

# Start frontend npm process
echo -e "\n${GREEN}Starting frontend via npm...${NC}"
# Export .env variables for Next.js config evaluation (needs SITE_BACKEND before loading)
set -a
source "${PROJECT_ROOT}/.env" 2>/dev/null || true
set +a
npm run dev --workspace apps/frontend > "${RUN_DIR}/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "${RUN_DIR}/frontend.pid"
echo -e "  Frontend PID: $FRONTEND_PID (logs: .run/frontend.log)"

# Function to wait for port to be available
wait_for_port() {
    local port=$1
    local service=$2
    local max_attempts=120  # Increased from 60 to 120 seconds
    local attempts=0

    echo -e "\n${GREEN}Waiting for $service on port $port...${NC}"

    while [[ $attempts -lt $max_attempts ]]; do
        # Check if port is listening using ss (works in WSL) with fallback to lsof
        if ss -tln 2>/dev/null | grep -q ":${port} "; then
            # Port is listening, give it a moment to fully initialize
            sleep 2
            echo -e "${GREEN}✓ $service is ready on port $port${NC}"
            return 0
        elif lsof -Pi :${port} -sTCP:LISTEN -t >/dev/null 2>&1; then
            # Port is listening, give it a moment to fully initialize
            sleep 2
            echo -e "${GREEN}✓ $service is ready on port $port${NC}"
            return 0
        fi

        # Check if process is still running
        if [[ "$service" == "backend" ]] && ! kill -0 $BACKEND_PID 2>/dev/null; then
            echo -e "${RED}✗ Backend process died. Check .run/backend.log for errors${NC}"
            tail -20 "${RUN_DIR}/backend.log"
            return 1
        fi
        if [[ "$service" == "frontend" ]] && ! kill -0 $FRONTEND_PID 2>/dev/null; then
            echo -e "${RED}✗ Frontend process died. Check .run/frontend.log for errors${NC}"
            tail -20 "${RUN_DIR}/frontend.log"
            return 1
        fi

        # Check log file for "Ready" message (Next.js specific)
        if [[ "$service" == "frontend" && -f "${RUN_DIR}/frontend.log" ]]; then
            if grep -q "Ready in" "${RUN_DIR}/frontend.log" 2>/dev/null; then
                # Next.js says it's ready, wait a bit for port to be detectable
                sleep 3
                if ss -tln 2>/dev/null | grep -q ":${port} " || lsof -Pi :${port} -sTCP:LISTEN -t >/dev/null 2>&1; then
                    echo -e "${GREEN}✓ $service is ready on port $port${NC}"
                    return 0
                fi
            fi
        fi

        if [[ $((attempts % 5)) -eq 0 ]]; then
            echo "  Waiting for $service... (attempt $((attempts + 1))/$max_attempts)"
        fi
        sleep 1
        attempts=$((attempts + 1))
    done

    echo -e "${RED}✗ Timeout waiting for $service on port $port${NC}"
    echo -e "${YELLOW}Checking logs for startup status...${NC}"
    tail -10 "${RUN_DIR}/${service}.log"
    return 1
}

# Wait for backend to be ready
if ! wait_for_port 4000 "backend"; then
    echo -e "${RED}✗ Backend failed to start${NC}"
    exit 1
fi

# Wait for frontend to be ready
if ! wait_for_port 3000 "frontend"; then
    echo -e "${RED}✗ Frontend failed to start${NC}"
    exit 1
fi

# Success message
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}TronRelic is now running!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Frontend: ${YELLOW}http://localhost:3000${NC}"
echo -e "Backend:  ${YELLOW}http://localhost:4000${NC}"
echo -e ""
echo -e "Logs:"
echo -e "  Backend:  ${YELLOW}tail -f .run/backend.log${NC}"
echo -e "  Frontend: ${YELLOW}tail -f .run/frontend.log${NC}"
echo -e ""
echo -e "Containers:"
echo -e "  MongoDB:    ${YELLOW}docker logs -f tronrelic-mongo${NC}"
echo -e "  Redis:      ${YELLOW}docker logs -f tronrelic-redis${NC}"
echo -e "  ClickHouse: ${YELLOW}docker logs -f tronrelic-clickhouse${NC}"
echo -e ""
echo -e "Stop: ${YELLOW}./scripts/stop.sh${NC}"
echo -e "${GREEN}========================================${NC}"
