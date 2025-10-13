#!/usr/bin/env bash
set -euo pipefail

# Bootstraps the TronRelic migration stack locally:
#   • ensures MongoDB and Redis Docker containers are running
#   • installs dependencies and builds backend/frontend apps
#   • optionally refreshes the data pipeline (Cloudflare export → Mongo/Redis)
#   • launches the backend API and Next.js frontend (dev mode by default, prod with --prod)
#   • auto-stops any existing listeners on ports 4000/3000 and waits on the launched processes (Ctrl+C to stop)
#
# Options:
#   --force         Recreate Docker containers/volumes, rerun ETL pipeline, rebuild targets, and relaunch services.
#   --force-docker  Recreate Docker containers/volumes only (no ETL or rebuild).
#   --force-build   Remove build artifacts before rebuilding backend/frontend targets.
#   --prod          Run frontend in production mode (default: development mode).
#   -h, --help      Show this help message and exit.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${MONO_ROOT}/.run"

MONGO_CONTAINER="tronrelic-mongo"
REDIS_CONTAINER="tronrelic-redis"
MONGO_IMAGE="mongo:6"
REDIS_IMAGE="redis:7"
MONGO_VOLUME="tronrelic-mongo-data"
REDIS_VOLUME="tronrelic-redis-data"
BACKEND_PORT=4000
FRONTEND_PORT=3000

FORCE=false
FORCE_DOCKER=false
FORCE_BUILD=false
PRODUCTION=false

usage() {
  cat <<'USAGE'
Usage: scripts/start.sh [OPTIONS]

Bootstraps the TronRelic migration stack locally. Clears ports 4000/3000 when needed, runs in the foreground, and stops the spawned services when you exit.

Options:
  --force         Recreate Docker containers/volumes, rerun ETL pipeline, rebuild targets, and relaunch services.
  --force-docker  Recreate Docker containers/volumes only (no ETL or rebuild).
  --force-build   Remove build artifacts and rebuild backend/frontend targets.
  --prod          Run frontend in production mode (default: development mode).
  -h, --help      Show this help message and exit.
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
    log ERROR "run.sh exited with status ${exit_code}"
  fi
}

trap on_exit EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
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

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log ERROR "Required command '$1' not found on PATH"
    exit 1
  fi
}

require_cmd docker
require_cmd node
require_cmd npm
require_cmd curl
require_cmd lsof

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

mkdir -p "${LOG_DIR}"

# Reset corrupt block log on startup
: > "${LOG_DIR}/backend_corrupt_block.log"
: > "${LOG_DIR}/backend_corrupt_transaction.log"

container_exists() {
  docker ps -a --format '{{.Names}}' | grep -Fq "$1"
}

container_running() {
  docker ps --format '{{.Names}}' | grep -Fq "$1"
}

remove_container() {
  local name="$1"
  if container_exists "${name}"; then
    log INFO "Removing container ${name}"
    docker rm -f "${name}" >/dev/null
  fi
}

remove_volume() {
  local name="$1"
  if docker volume inspect "${name}" >/dev/null 2>&1; then
    log INFO "Removing volume ${name}"
    docker volume rm -f "${name}" >/dev/null
  fi
}

remove_image() {
  local image="$1"
  if docker image inspect "${image}" >/dev/null 2>&1; then
    log INFO "Removing image ${image}"
    docker image rm -f "${image}" >/dev/null 2>&1 || true
  fi
}

pull_image() {
  local image="$1"
  log INFO "Ensuring Docker image ${image} is available"
  docker pull "${image}" >/dev/null
}

ensure_volume() {
  local name="$1"
  if ! docker volume inspect "${name}" >/dev/null 2>&1; then
    log INFO "Creating volume ${name}"
    docker volume create "${name}" >/dev/null
  fi
}

start_mongo() {
  ensure_volume "${MONGO_VOLUME}"
  if container_exists "${MONGO_CONTAINER}"; then
    if ! container_running "${MONGO_CONTAINER}"; then
      log INFO "Starting MongoDB container"
      docker start "${MONGO_CONTAINER}" >/dev/null
    else
      log INFO "MongoDB container already running"
    fi
  else
    log INFO "Creating MongoDB container"
    docker run -d --name "${MONGO_CONTAINER}" \
      --restart unless-stopped \
      -p 27017:27017 \
      -v "${MONGO_VOLUME}:/data/db" \
      "${MONGO_IMAGE}" >/dev/null
  fi
}

start_redis() {
  ensure_volume "${REDIS_VOLUME}"
  if container_exists "${REDIS_CONTAINER}"; then
    if ! container_running "${REDIS_CONTAINER}"; then
      log INFO "Starting Redis container"
      docker start "${REDIS_CONTAINER}" >/dev/null
    else
      log INFO "Redis container already running"
    fi
  else
    log INFO "Creating Redis container"
    docker run -d --name "${REDIS_CONTAINER}" \
      --restart unless-stopped \
      -p 6379:6379 \
      -v "${REDIS_VOLUME}:/data" \
      "${REDIS_IMAGE}" >/dev/null
  fi
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local name="$3"
  local attempts=0
  local max_attempts=${4:-60}
  log INFO "Waiting for ${name} on ${host}:${port}"
  until (echo >"/dev/tcp/${host}/${port}") >/dev/null 2>&1; do
    if (( attempts >= max_attempts )); then
      log ERROR "Timed out waiting for ${name} on ${host}:${port}"
      exit 1
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  log SUCCESS "${name} is available"
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local attempts=0
  local max_attempts=${3:-60}
  printf "\033[1;34m[INFO]\033[0m Probing ${name}"
  until curl --silent --fail --max-time 5 "${url}" >/dev/null; do
    if (( attempts >= max_attempts )); then
      echo ""
      log ERROR "Timed out waiting for ${name}"
      exit 1
    fi
    printf "."
    attempts=$((attempts + 1))
    sleep 5
  done
  echo ""
  log SUCCESS "${name} responded (${url})"
}

ensure_port_free() {
  local port="$1"
  local label="$2"
  if pids=$(lsof -ti tcp:"${port}" 2>/dev/null); then
    if [[ -n "${pids}" ]]; then
      log WARN "Port ${port} already in use (pids: ${pids}); attempting to terminate before starting ${label}"
      # shellcheck disable=SC2086
      kill ${pids} >/dev/null 2>&1 || true
      sleep 2
      if lsof -ti tcp:"${port}" >/dev/null 2>&1; then
        log ERROR "Failed to free port ${port} for ${label}. Stop the conflicting process and rerun."
        exit 1
      fi
      log INFO "Port ${port} cleared for ${label}"
    fi
  fi
}

run_npm_install() {
  local path="$1"
  local label="$2"
  pushd "${path}" >/dev/null
  if [[ "${FORCE}" == true ]]; then
    log INFO "Installing ${label} dependencies (force)"
    npm install
  else
    # Check if package.json has changed since last install
    if [[ -f package-lock.json ]] && [[ -d node_modules ]]; then
      if [[ package.json -ot package-lock.json ]] && [[ package.json -ot node_modules ]]; then
        log INFO "Dependencies for ${label} up to date (skipping install)"
        popd >/dev/null
        return
      fi
    fi

    if [[ -d node_modules ]]; then
      log INFO "Dependencies for ${label} changed, reinstalling"
    else
      log INFO "Installing ${label} dependencies"
    fi
    npm install
  fi
  popd >/dev/null
}

needs_rebuild() {
  local workspace="$1"
  local src_dir="${MONO_ROOT}/${workspace}/src"
  local build_marker=""

  # Determine build output marker file
  if [[ "${workspace}" == "packages/shared" ]] || [[ "${workspace}" == "packages/types" ]] || [[ "${workspace}" == "apps/backend" ]]; then
    build_marker="${MONO_ROOT}/${workspace}/dist/index.js"
  elif [[ "${workspace}" == "packages/plugins" ]]; then
    build_marker="${MONO_ROOT}/${workspace}/index.js"
  elif [[ "${workspace}" == "apps/frontend" ]]; then
    build_marker="${MONO_ROOT}/${workspace}/.next/BUILD_ID"
  fi

  # No build output exists
  if [[ ! -f "${build_marker}" ]]; then
    return 0
  fi

  # Check if any source files are newer than build output
  if [[ -d "${src_dir}" ]]; then
    if find "${src_dir}" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) -newer "${build_marker}" 2>/dev/null | grep -q .; then
      return 0
    fi
  fi

  return 1
}

run_monorepo_build() {
  pushd "${MONO_ROOT}" >/dev/null

  if [[ "${FORCE_BUILD}" == true ]]; then
    log INFO "Force rebuild: cleaning previous build artifacts"
    rm -rf apps/backend/dist apps/frontend/.next packages/shared/dist packages/types/dist packages/plugins/*.js packages/plugins/*.d.ts
    rm -f apps/backend/.tsbuildinfo apps/frontend/tsconfig.tsbuildinfo packages/shared/tsconfig.tsbuildinfo packages/types/tsconfig.tsbuildinfo packages/plugins/.tsbuildinfo

    if [[ "${PRODUCTION}" == true ]]; then
      log INFO "Building all workspaces for production (parallel builds)"
      npm run build:parallel
    else
      log INFO "Building types, shared, plugins, and backend (frontend will compile on-demand in dev mode)"
      npm run build --workspace packages/types && npm run build --workspace packages/shared && npm run build:plugin-backends -- --force-build && npm run build:plugin-frontends -- --force-build && npm run build --workspace apps/backend
    fi
  else
    # Smart incremental rebuild
    local needs_shared_rebuild=false
    local needs_backend_rebuild=false
    local needs_frontend_rebuild=false

    if needs_rebuild "packages/shared"; then
      needs_shared_rebuild=true
    fi

    if needs_rebuild "apps/backend"; then
      needs_backend_rebuild=true
    fi

    if [[ "${PRODUCTION}" == true ]] && needs_rebuild "apps/frontend"; then
      needs_frontend_rebuild=true
    fi

    if [[ "${needs_shared_rebuild}" == false ]] && [[ "${needs_backend_rebuild}" == false ]] && [[ "${needs_frontend_rebuild}" == false ]]; then
      log INFO "Build outputs are up to date (use --force-build to rebuild anyway)"
      popd >/dev/null
      return
    fi

    log INFO "Running incremental rebuild (preserving build cache)"

    # Build types first (dependency for plugins, backend, and shared)
    if needs_rebuild "packages/types"; then
      log INFO "Rebuilding packages/types (source files changed)"
      npm run build --workspace packages/types
    fi

    # Build shared (dependency for backend/frontend)
    if [[ "${needs_shared_rebuild}" == true ]]; then
      log INFO "Rebuilding packages/shared (source files changed)"
      npm run build --workspace packages/shared
    fi

    # Build plugins (dependency for backend and frontend)
    # Use centralized plugin build scripts for auto-discovery
    log INFO "Checking for plugin rebuilds (incremental)"
    npm run build:plugin-backends
    npm run build:plugin-frontends

    # Build backend and frontend in parallel (both depend on shared)
    local build_commands=()
    if [[ "${needs_backend_rebuild}" == true ]]; then
      build_commands+=("npm run build --workspace apps/backend")
    fi

    if [[ "${PRODUCTION}" == true ]] && [[ "${needs_frontend_rebuild}" == true ]]; then
      build_commands+=("npm run build --workspace apps/frontend")
    fi

    if [[ ${#build_commands[@]} -gt 0 ]]; then
      if [[ ${#build_commands[@]} -gt 1 ]]; then
        log INFO "Rebuilding backend and frontend in parallel"
        # Join commands with space for concurrently
        local concurrent_cmd=$(printf ' "%s"' "${build_commands[@]}")
        eval "npx concurrently${concurrent_cmd}"
      else
        log INFO "Rebuilding ${build_commands[0]}"
        eval "${build_commands[0]}"
      fi
    fi
  fi

  popd >/dev/null
}

run_etl_pipeline() {
  local etl_dir="${MONO_ROOT}/etl"
  if [[ ! -d "${etl_dir}" ]]; then
    log WARN "ETL toolkit not found at ${etl_dir}, skipping data refresh"
    return
  fi
  if [[ ! -f "${etl_dir}/.env" ]]; then
    if [[ "${FORCE}" == true ]]; then
      log ERROR "Missing ${etl_dir}/.env. Configure ETL credentials before running with --force."
      exit 1
    fi
    log WARN "ETL .env missing; skipping export/transform. Create ${etl_dir}/.env to enable data refresh."
    return
  fi
  run_npm_install "${etl_dir}" "ETL toolkit"
  pushd "${etl_dir}" >/dev/null
  log INFO "Exporting latest Cloudflare datasets"
  npm run export
  log INFO "Transforming datasets into MongoDB"
  npm run transform
  log INFO "Seeding Redis caches"
  npm run seed:redis
  popd >/dev/null
}

start_backend() {
  pushd "${MONO_ROOT}" >/dev/null
  ensure_port_free "${BACKEND_PORT}" "backend"
  log INFO "Starting backend API"
  npm run start --workspace apps/backend >"${LOG_DIR}/backend.log" 2>&1 &
  popd >/dev/null
  log INFO "Backend logs: ${LOG_DIR}/backend.log"
}

start_frontend() {
  pushd "${MONO_ROOT}" >/dev/null
  ensure_port_free "${FRONTEND_PORT}" "frontend"

  if [[ "${PRODUCTION}" == true ]]; then
    log INFO "Starting Next.js frontend in production mode"
    PORT=${FRONTEND_PORT} npm run start --workspace apps/frontend >"${LOG_DIR}/frontend.log" 2>&1 &
  else
    log INFO "Starting Next.js frontend in development mode"
    PORT=${FRONTEND_PORT} npm run dev --workspace apps/frontend >"${LOG_DIR}/frontend.log" 2>&1 &
  fi

  popd >/dev/null
  log INFO "Frontend logs: ${LOG_DIR}/frontend.log"
}

# ----- Execution flow -----

# Always stop any running services first
if [[ -x "${SCRIPT_DIR}/stop.sh" ]]; then
  log INFO "Stopping any existing services"
  "${SCRIPT_DIR}/stop.sh"
else
  log WARN "stop.sh not found or not executable, skipping pre-cleanup"
fi

log INFO "Preparing local infrastructure"

if [[ "${FORCE_DOCKER}" == true ]]; then
  if [[ "${FORCE}" == true ]]; then
    log WARN "--force specified: resetting Docker containers, volumes, and images"
  else
    log WARN "--force-docker specified: resetting Docker containers, volumes, and images"
  fi
  remove_container "${MONGO_CONTAINER}"
  remove_container "${REDIS_CONTAINER}"
  remove_volume "${MONGO_VOLUME}"
  remove_volume "${REDIS_VOLUME}"
  remove_image "${MONGO_IMAGE}"
  remove_image "${REDIS_IMAGE}"
fi

pull_image "${MONGO_IMAGE}"
pull_image "${REDIS_IMAGE}"
start_mongo
start_redis
wait_for_port 127.0.0.1 27017 "MongoDB"
wait_for_port 127.0.0.1 6379 "Redis"

run_npm_install "${MONO_ROOT}" "monorepo"

if [[ "${FORCE}" == true ]]; then
  run_etl_pipeline
else
  log INFO "Skipping ETL refresh (use --force to export/transform data)"
fi

run_monorepo_build

start_backend
wait_for_http "http://localhost:${BACKEND_PORT}/health" "Backend health endpoint" 120

start_frontend
wait_for_http "http://localhost:${FRONTEND_PORT}" "Frontend" 120

log SUCCESS "All services are up!"
log INFO "Backend: http://localhost:${BACKEND_PORT}"
log INFO "Frontend: http://localhost:${FRONTEND_PORT}"
log INFO "Services are running in the background"
log INFO "To stop services, run: scripts/stop.sh"
