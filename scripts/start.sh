#!/usr/bin/env bash
set -euo pipefail

# Starts the TronRelic application stack in one of two modes:
#
# npm mode (--npm):
#   • MongoDB and Redis run in Docker containers
#   • Backend and frontend run via npm on the host (lower resource usage)
#
# Docker mode (default):
#   • All 4 services run in Docker containers
#   • Use this for full containerization or production deployments
#
# Options:
#   --npm           Use npm-based development mode (MongoDB/Redis in Docker, backend/frontend via npm)
#   --docker        Explicitly use full Docker mode (all services in containers)
#   --prod          Use production Docker Compose configuration
#   --force-build   Rebuild Docker images without cache
#   --force-docker  Recreate Docker containers and volumes
#   --force         Full reset (all of the above)
#   -h, --help      Show this help message and exit.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

MONGO_CONTAINER="tronrelic-mongo"
REDIS_CONTAINER="tronrelic-redis"
BACKEND_CONTAINER="tronrelic-backend"
FRONTEND_CONTAINER="tronrelic-frontend"

FORCE=false
FORCE_DOCKER=false
FORCE_BUILD=false
PRODUCTION=false
NPM_MODE=true  # Default to npm mode
DOCKER_MODE=false

usage() {
  cat <<'USAGE'
Usage: scripts/start.sh [OPTIONS]

Starts the TronRelic application stack in one of two modes:

Development Modes:
  (default)       Use npm-based mode (MongoDB/Redis in Docker, backend/frontend via npm)
                  Default for local development (lower resource usage, faster hot reload)

  --npm           Explicitly use npm-based mode (same as default)

  --docker        Use full Docker mode (all services in containers)
                  Use when you need full containerization

Deployment Modes:
  --prod          Use production Docker Compose configuration (forces --docker mode)

Force Options:
  --force-build   Rebuild Docker images without cache
  --force-docker  Recreate Docker containers and volumes
  --force         Full reset (combines all force options)

Help:
  -h, --help      Show this help message and exit

Examples:
  scripts/start.sh                    # Start in npm mode (default)
  scripts/start.sh --docker           # Start all services in Docker containers
  scripts/start.sh --prod             # Start in production mode (Docker)
  scripts/start.sh --force            # Full clean rebuild
USAGE
}

log() {
  local level="$1"; shift
  local color
  case "$level" in
    INFO) color="\033[1;34m" ;;
    WARN) color="\033[1;33m" ;;
    ERROR) color="\033[1;31m" ;;
    SUCCESS) color="\033[1;32m" ;;
    *) color="" ;;
  esac
  printf "%b[%s]%b %s\n" "${color}" "${level}" "\033[0m" "$*"
}

on_exit() {
  local exit_code=$?
  if (( exit_code != 0 )); then
    log ERROR "start.sh exited with status ${exit_code}"
  fi
}

trap on_exit EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --npm)
      NPM_MODE=true
      DOCKER_MODE=false
      shift
      ;;
    --docker)
      NPM_MODE=false
      DOCKER_MODE=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --force-docker)
      FORCE_DOCKER=true
      shift
      ;;
    --force-build)
      FORCE_BUILD=true
      shift
      ;;
    --prod)
      PRODUCTION=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log ERROR "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

if [[ "${FORCE}" == true ]]; then
  FORCE_DOCKER=true
  FORCE_BUILD=true
fi

# Validate mode selection
if [[ "${NPM_MODE}" == true && "${DOCKER_MODE}" == true ]]; then
  log ERROR "Cannot specify both --npm and --docker modes"
  usage
  exit 1
fi

if [[ "${NPM_MODE}" == true && "${PRODUCTION}" == true ]]; then
  log ERROR "Cannot use --npm mode with --prod (production requires Docker)"
  usage
  exit 1
fi

# Production mode forces Docker mode
if [[ "${PRODUCTION}" == true ]]; then
  NPM_MODE=false
  DOCKER_MODE=true
fi

# If npm mode (default unless --docker specified), delegate to npm.sh helper
if [[ "${NPM_MODE}" == true ]]; then
  log INFO "Starting in npm mode (use --docker for full containerization)..."
  exec "${SCRIPT_DIR}/modes/npm.sh"
  # exec replaces this process, so we never reach here
fi

# Otherwise, use Docker mode (explicit --docker flag)
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log ERROR "Required command '$1' not found on PATH"
    exit 1
  fi
}

require_cmd docker

ensure_docker_running() {
  if docker info >/dev/null 2>&1; then
    return
  fi

  log WARN "Docker daemon is not running; attempting to start it"
  local started=false

  if command -v systemctl >/dev/null 2>&1; then
    if systemctl start docker >/dev/null 2>&1; then
      started=true
    elif sudo systemctl start docker >/dev/null 2>&1; then
      started=true
    fi
  elif command -v service >/dev/null 2>&1; then
    if service docker start >/dev/null 2>&1; then
      started=true
    elif sudo service docker start >/dev/null 2>&1; then
      started=true
    fi
  elif command -v open >/dev/null 2>&1; then
    # macOS: ask Docker Desktop to launch in the background
    if open --background -a Docker >/dev/null 2>&1; then
      started=true
    fi
  fi

  if [[ "${started}" == true ]]; then
    log INFO "Docker daemon start command issued; waiting for readiness"
    local attempts=0
    local max_attempts=30
    until docker info >/dev/null 2>&1; do
      if (( attempts >= max_attempts )); then
        log ERROR "Docker daemon did not become ready after attempting to start it"
        exit 1
      fi
      attempts=$((attempts + 1))
      sleep 2
    done
    log SUCCESS "Docker daemon is now running"
    return
  fi

  if ! docker info >/dev/null 2>&1; then
    log ERROR "Docker daemon does not appear to be running. Start Docker manually and rerun."
    exit 1
  fi
}

ensure_docker_running

# Clean up any stray processes on ports 3000 and 4000 before starting
log INFO "Checking for processes on ports 3000 and 4000..."
for port in 3000 4000; do
    if lsof -ti:${port} >/dev/null 2>&1; then
        log WARN "Found process on port ${port}, killing it"
        lsof -ti:${port} | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
done

# Change to project root for docker compose commands
cd "${MONO_ROOT}"

# Clear log files to ensure fresh logs for this run
log INFO "Clearing log files..."
mkdir -p .run
> .run/backend.log
> .run/frontend.log
log SUCCESS "Log files cleared"

# Check for .env file
if [[ ! -f .env ]]; then
  log ERROR "Missing .env file. Copy .env.example to .env and fill in your configuration."
  exit 1
fi

# Determine which docker-compose file to use
COMPOSE_FILE="docker-compose.yml"
if [[ "${PRODUCTION}" == true ]]; then
  if [[ -f docker-compose.prod.yml ]]; then
    COMPOSE_FILE="docker-compose.prod.yml"
    log INFO "Using production configuration: ${COMPOSE_FILE}"
  else
    log WARN "Production compose file not found, using default: ${COMPOSE_FILE}"
  fi
else
  log INFO "Using development configuration: ${COMPOSE_FILE}"
fi

# Handle force-docker: stop and remove containers/volumes
if [[ "${FORCE_DOCKER}" == true ]]; then
  if [[ "${FORCE}" == true ]]; then
    log WARN "--force specified: removing all Docker containers and volumes"
  else
    log WARN "--force-docker specified: removing all Docker containers and volumes"
  fi

  log INFO "Stopping and removing containers"
  docker compose -f "${COMPOSE_FILE}" down -v

  log INFO "Removing all TronRelic Docker images"
  # Remove images matching both naming patterns (old and new)
  docker images --format "{{.Repository}}:{{.Tag}}" | grep -E 'tronrelic|tronreliccom' | xargs -r docker rmi -f 2>/dev/null || true
fi

# Handle force-build: rebuild images without cache
if [[ "${FORCE_BUILD}" == true ]]; then
  log INFO "Removing all TronRelic Docker images"
  docker images --format "{{.Repository}}:{{.Tag}}" | grep -E 'tronrelic|tronreliccom' | xargs -r docker rmi -f 2>/dev/null || true

  log INFO "Building Docker images with docker compose (no cache)"
  docker compose -f "${COMPOSE_FILE}" build --no-cache
elif [[ "${FORCE_DOCKER}" == true ]]; then
  log INFO "Building Docker images with docker compose"
  docker compose -f "${COMPOSE_FILE}" build
else
  # Check if images exist by looking for built images matching the project name
  # Docker Compose generates image names like: tronreliccom-beta-backend:latest
  if docker images --format "{{.Repository}}" | grep -q "tronrelic.*-backend"; then
    log INFO "Using existing Docker images (use --force-build to rebuild)"
  else
    log INFO "Building Docker images with docker compose"
    docker compose -f "${COMPOSE_FILE}" build
  fi
fi

# Start all services
log INFO "Starting Docker Compose stack"
docker compose -f "${COMPOSE_FILE}" up -d

# Wait for services to become healthy
log INFO "Waiting for services to become healthy..."

wait_for_healthy() {
  local container="$1"
  local max_attempts=60
  local attempts=0

  printf "\033[1;34m[INFO]\033[0m Waiting for %s" "${container}"

  # First check if container has a health check defined
  local has_healthcheck=$(docker inspect --format='{{if .State.Health}}true{{else}}false{{end}}' "${container}" 2>/dev/null || echo "false")

  if [[ "${has_healthcheck}" == "false" ]]; then
    # No health check, just verify container is running
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
      echo ""
      log SUCCESS "${container} is running (no health check)"
      return 0
    else
      echo ""
      log ERROR "${container} is not running"
      return 1
    fi
  fi

  # Container has health check, wait for it to become healthy
  while [[ $attempts -lt $max_attempts ]]; do
    local health_status=$(docker inspect --format='{{.State.Health.Status}}' "${container}" 2>/dev/null || echo "unknown")

    if [[ "${health_status}" == "healthy" ]]; then
      echo ""
      log SUCCESS "${container} is healthy"
      return 0
    fi

    printf "."
    attempts=$((attempts + 1))
    sleep 2
  done

  echo ""
  log ERROR "Timeout waiting for ${container} to become healthy"
  log INFO "Check logs with: docker compose -f ${COMPOSE_FILE} logs ${container}"
  return 1
}

# Wait for MongoDB
wait_for_healthy "${MONGO_CONTAINER}" || exit 1

# Wait for Redis
wait_for_healthy "${REDIS_CONTAINER}" || exit 1

# Wait for Backend
wait_for_healthy "${BACKEND_CONTAINER}" || exit 1

# Wait for Frontend (may not have health check in dev mode)
wait_for_healthy "${FRONTEND_CONTAINER}" || exit 1

log SUCCESS "All services are up!"
log INFO "Backend: http://localhost:4000"
log INFO "Frontend: http://localhost:3000"
log INFO ""
log INFO "View logs with:"
log INFO "  docker compose -f ${COMPOSE_FILE} logs -f"
log INFO ""
log INFO "Stop services with:"
log INFO "  ./scripts/stop.sh"
