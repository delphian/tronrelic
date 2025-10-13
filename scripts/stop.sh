#!/usr/bin/env bash
set -euo pipefail

# Stops all TronRelic services:
#   • kills backend and frontend processes
#   • optionally stops Docker containers

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${MONO_ROOT}/.run"

BACKEND_PORT=4000
FRONTEND_PORT=3000
MONGO_CONTAINER="tronrelic-mongo"
REDIS_CONTAINER="tronrelic-redis"

STOP_DOCKER=false

usage() {
  cat <<'USAGE'
Usage: scripts/stop.sh [--docker]

Stops all TronRelic services.

Options:
  --docker       Also stop MongoDB and Redis Docker containers
  -h, --help     Show this help message and exit.
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

while [[ $# -gt 0 ]]; do
  case "$1" in
    --docker)
      STOP_DOCKER=true
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

# Kill processes on specific ports
kill_port() {
  local port="$1"
  local name="$2"
  local found=false

  # Try lsof first
  if command -v lsof >/dev/null 2>&1; then
    if pids=$(lsof -ti tcp:"${port}" 2>/dev/null); then
      if [[ -n "${pids}" ]]; then
        found=true
        log INFO "Stopping ${name} on port ${port} (pids: ${pids})"
        # shellcheck disable=SC2086
        kill ${pids} >/dev/null 2>&1 || true
        sleep 1
        # Force kill if still running
        if lsof -ti tcp:"${port}" >/dev/null 2>&1; then
          # shellcheck disable=SC2086
          kill -9 ${pids} >/dev/null 2>&1 || true
        fi
      fi
    fi
  fi

  # Try fuser as fallback
  if [[ "${found}" == false ]] && command -v fuser >/dev/null 2>&1; then
    if fuser -s "${port}/tcp" 2>/dev/null; then
      found=true
      log INFO "Stopping ${name} on port ${port} (using fuser)"
      fuser -k -TERM "${port}/tcp" >/dev/null 2>&1 || true
      sleep 1
      # Force kill if still running
      if fuser -s "${port}/tcp" 2>/dev/null; then
        fuser -k -KILL "${port}/tcp" >/dev/null 2>&1 || true
      fi
    fi
  fi

  if [[ "${found}" == true ]]; then
    log SUCCESS "${name} stopped"
  else
    log INFO "No ${name} process found on port ${port}"
  fi
}

container_running() {
  docker ps --format '{{.Names}}' 2>/dev/null | grep -Fq "$1"
}

stop_container() {
  local name="$1"
  if container_running "${name}"; then
    log INFO "Stopping container ${name}"
    docker stop "${name}" >/dev/null 2>&1 || true
    log SUCCESS "Container ${name} stopped"
  else
    log INFO "Container ${name} not running"
  fi
}

log INFO "Stopping TronRelic services"

# Kill processes by port
kill_port "${BACKEND_PORT}" "Backend API"
kill_port "${FRONTEND_PORT}" "Frontend"

# Extra safety: kill any lingering Next.js dev/start processes
if command -v pkill >/dev/null 2>&1; then
  if pkill -f "next (dev|start)" >/dev/null 2>&1; then
    log INFO "Killed lingering Next.js processes"
    sleep 1
  fi
  # Kill any node processes running from our workspace
  if pkill -f "node.*apps/(backend|frontend)" >/dev/null 2>&1; then
    log INFO "Killed lingering Node processes"
    sleep 1
  fi
fi

if [[ "${STOP_DOCKER}" == true ]]; then
  if command -v docker >/dev/null 2>&1; then
    stop_container "${MONGO_CONTAINER}"
    stop_container "${REDIS_CONTAINER}"
  else
    log WARN "Docker not found, skipping container shutdown"
  fi
fi

log SUCCESS "All services stopped"
