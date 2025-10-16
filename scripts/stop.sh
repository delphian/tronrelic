#!/usr/bin/env bash
set -euo pipefail

# Stops all TronRelic Docker containers:
#   • Stops all 4 containers: Frontend, Backend, MongoDB, Redis
#   • Optionally removes volumes (with --volumes flag)
#
# Options:
#   --volumes      Also remove Docker volumes (WARNING: deletes all data)
#   --prod         Use production Docker Compose configuration
#   -h, --help     Show this help message and exit.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

REMOVE_VOLUMES=false
PRODUCTION=false

usage() {
  cat <<'USAGE'
Usage: scripts/stop.sh [OPTIONS]

Stops all TronRelic Docker containers.

Options:
  --volumes      Also remove Docker volumes (WARNING: deletes all data)
  --prod         Use production Docker Compose configuration
  -h, --help     Show this help message and exit.

Examples:
  scripts/stop.sh                # Stop containers, keep data
  scripts/stop.sh --volumes      # Stop containers and delete all data
  scripts/stop.sh --prod         # Stop production containers
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

cleanup_ports() {
    # Kill any processes still running on ports 3000 and 4000
    log INFO "Checking for processes on ports 3000 and 4000..."
    for port in 3000 4000; do
        if lsof -ti:${port} >/dev/null 2>&1; then
            log WARN "Found process on port ${port}, killing it"
            lsof -ti:${port} | xargs kill -9 2>/dev/null || true
        fi
    done
}

# Ensure port cleanup happens even if script is interrupted
trap cleanup_ports EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --volumes)
      REMOVE_VOLUMES=true
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

# Check if docker command exists
if ! command -v docker >/dev/null 2>&1; then
  log ERROR "Docker not found. Please install Docker and try again."
  exit 1
fi

# Change to project root for docker compose commands
cd "${MONO_ROOT}"

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

# Check if any containers are running
if ! docker compose -f "${COMPOSE_FILE}" ps -q 2>/dev/null | grep -q .; then
  log INFO "No TronRelic containers are running"
  exit 0
fi

# Stop containers
if [[ "${REMOVE_VOLUMES}" == true ]]; then
  log WARN "Stopping containers and removing volumes (this will delete all data)"
  docker compose -f "${COMPOSE_FILE}" down -v
  log SUCCESS "Containers stopped and volumes removed"
else
  log INFO "Stopping TronRelic containers"
  docker compose -f "${COMPOSE_FILE}" down
  log SUCCESS "All containers stopped (data preserved)"
fi

log INFO ""
log INFO "To start services again, run:"
log INFO "  ./scripts/start.sh"
