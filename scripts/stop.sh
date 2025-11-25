#!/usr/bin/env bash
set -euo pipefail

# Stops all TronRelic services:
#   • Stops npm processes (if running in npm mode)
#   • Stops Docker containers (all modes)
#   • Optionally removes volumes (with --volumes flag)
#
# Options:
#   --volumes      Also remove Docker volumes (WARNING: deletes all data)
#   --prod         Use production Docker Compose configuration
#   -h, --help     Show this help message and exit.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_DIR="${MONO_ROOT}/.run"

REMOVE_VOLUMES=false
PRODUCTION=false

usage() {
  cat <<'USAGE'
Usage: scripts/stop.sh [OPTIONS]

Stops all TronRelic services (npm processes and Docker containers).

Options:
  --volumes      Also remove Docker volumes (WARNING: deletes all data)
  --prod         Use production Docker Compose configuration
  -h, --help     Show this help message and exit.

Examples:
  scripts/stop.sh                # Stop all services, keep data
  scripts/stop.sh --volumes      # Stop services and delete all data
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

stop_npm_processes() {
    # Stop npm processes using PID files (if they exist)
    local stopped_any=false

    if [[ -f "${RUN_DIR}/backend.pid" ]]; then
        local backend_pid=$(cat "${RUN_DIR}/backend.pid")
        if kill -0 "$backend_pid" 2>/dev/null; then
            log INFO "Stopping backend npm process (PID: $backend_pid)"
            kill "$backend_pid" 2>/dev/null || true
            stopped_any=true
        fi
        rm -f "${RUN_DIR}/backend.pid"
    fi

    if [[ -f "${RUN_DIR}/frontend.pid" ]]; then
        local frontend_pid=$(cat "${RUN_DIR}/frontend.pid")
        if kill -0 "$frontend_pid" 2>/dev/null; then
            log INFO "Stopping frontend npm process (PID: $frontend_pid)"
            kill "$frontend_pid" 2>/dev/null || true
            stopped_any=true
        fi
        rm -f "${RUN_DIR}/frontend.pid"
    fi

    if [[ "$stopped_any" == true ]]; then
        log SUCCESS "npm processes stopped"
    fi
}

cleanup_orphaned_tsx() {
    # Kill any orphaned tsx watch processes from previous runs
    log INFO "Checking for orphaned tsx watch processes..."
    local tsx_pids=$(pgrep -f "tsx watch src/index.ts" 2>/dev/null || true)

    if [[ -n "$tsx_pids" ]]; then
        log WARN "Found orphaned tsx watch processes, cleaning up"
        pkill -9 -f "tsx watch src/index.ts" 2>/dev/null || true
        log SUCCESS "Orphaned tsx processes cleaned up"
    fi
}

cleanup_ports() {
    # Kill any processes still running on ports 3000 and 4000 (failsafe)
    log INFO "Checking for processes on ports 3000 and 4000..."
    local killed_any=false

    # Use multiple methods to find processes (lsof sometimes misses them)
    for port in 3000 4000; do
        # Method 1: lsof
        if lsof -ti:${port} >/dev/null 2>&1; then
            log WARN "Found process on port ${port} (via lsof), killing it"
            lsof -ti:${port} | xargs kill -9 2>/dev/null || true
            killed_any=true
        fi

        # Method 2: fuser (more reliable for some cases)
        if command -v fuser >/dev/null 2>&1; then
            if fuser ${port}/tcp >/dev/null 2>&1; then
                log WARN "Found process on port ${port} (via fuser), killing it"
                fuser -k ${port}/tcp >/dev/null 2>&1 || true
                killed_any=true
            fi
        fi
    done

    if [[ "$killed_any" == true ]]; then
        log SUCCESS "Port cleanup completed"
    fi
}

# Ensure cleanup happens even if script is interrupted
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

# Stop npm processes first (if running in npm mode)
stop_npm_processes

# Clean up any orphaned tsx processes from previous runs
cleanup_orphaned_tsx

# Use unified docker-compose.yml
COMPOSE_FILES=()
if [[ -f docker-compose.yml ]]; then
  COMPOSE_FILES+=("docker-compose.yml")
fi

# Stop containers for each compose file
stopped_any=false
for compose_file in "${COMPOSE_FILES[@]}"; do
  # Check if any containers are running for this compose file
  if docker-compose -f "${compose_file}" ps -q 2>/dev/null | grep -q .; then
    stopped_any=true

    if [[ "${REMOVE_VOLUMES}" == true ]]; then
      log WARN "Stopping containers and removing volumes for ${compose_file}"
      docker-compose -f "${compose_file}" down -v
    else
      log INFO "Stopping containers for ${compose_file}"
      docker-compose -f "${compose_file}" down
    fi
  fi
done

if [[ "$stopped_any" == true ]]; then
  if [[ "${REMOVE_VOLUMES}" == true ]]; then
    log SUCCESS "All containers stopped and volumes removed"
  else
    log SUCCESS "All containers stopped (data preserved)"
  fi
else
  log INFO "No TronRelic containers were running"
fi

# Clean up dangling images (always runs, even if no containers were stopped)
log INFO "Cleaning up dangling Docker images (runs unconditionally)..."
if docker image prune -f >/dev/null 2>&1; then
  log SUCCESS "Dangling images removed"
else
  log WARN "Failed to prune images (this is usually safe to ignore)"
fi

log INFO ""
log INFO "Docker daemon left running (uses ~150-250MB RAM when idle)"
log INFO "To start services again, run:"
log INFO "  ./scripts/start.sh          # npm mode (default)"
log INFO "  ./scripts/start.sh --docker # Docker mode"
