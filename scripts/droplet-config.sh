#!/bin/bash

##
## Droplet Environment Configuration
##
## Central configuration for all TronRelic droplet environments.
## Eliminates hardcoded IPs, credentials, and duplicate configuration across scripts.
##
## Usage:
##   source "$(dirname "$0")/droplet-config.sh"
##   get_config "prod"  # or "dev"
##
## This exports environment-specific variables that scripts can use:
##   - DROPLET_IP: IP address of the droplet
##   - DROPLET_HOST: SSH connection string (root@IP)
##   - DEPLOY_DIR: Deployment directory on droplet (unified: /opt/tronrelic)
##   - ENV_TAG: Environment tag for Docker images (production or development)
##   - MONGO_CONTAINER: MongoDB container name
##   - REDIS_CONTAINER: Redis container name
##   - BACKEND_CONTAINER: Backend container name
##   - FRONTEND_CONTAINER: Frontend container name
##   - GITHUB_USERNAME: GitHub username for container registry
##   - GITHUB_REPO: GitHub repository name
##

set -euo pipefail

# Load droplet configuration from .env file
SCRIPT_DIR_FOR_CONFIG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${SCRIPT_DIR_FOR_CONFIG}/.env"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: Configuration file not found: $ENV_FILE" >&2
    echo "" >&2
    echo "Please create .env from the template:" >&2
    echo "  cp .env.example .env" >&2
    echo "  # Then edit .env with your droplet configuration" >&2
    echo "" >&2
    exit 1
fi

# Source the .env file
# shellcheck source=../.env
set -a  # Export all variables
source "$ENV_FILE"
set +a  # Stop exporting

# Validate required droplet configuration
if [[ -z "${PROD_DROPLET_IP:-}" ]] || [[ -z "${DEV_DROPLET_IP:-}" ]]; then
    echo "ERROR: Missing required droplet configuration in $ENV_FILE" >&2
    echo "Required variables: PROD_DROPLET_IP, DEV_DROPLET_IP" >&2
    echo "" >&2
    echo "Add these to your .env file:" >&2
    echo "  PROD_DROPLET_IP=your.prod.ip.here" >&2
    echo "  DEV_DROPLET_IP=your.dev.ip.here" >&2
    echo "" >&2
    exit 1
fi

if [[ -z "${GITHUB_USERNAME:-}" ]] || [[ -z "${GITHUB_REPO:-}" ]]; then
    echo "ERROR: Missing GitHub configuration in $ENV_FILE" >&2
    echo "Required variables: GITHUB_USERNAME, GITHUB_REPO" >&2
    echo "" >&2
    echo "Add these to your .env file:" >&2
    echo "  GITHUB_USERNAME=your-github-username" >&2
    echo "  GITHUB_REPO=your-repo-name" >&2
    echo "" >&2
    exit 1
fi

# Define environments using values from .env
declare -A ENVIRONMENTS=(
    [prod]="$PROD_DROPLET_IP"
    [dev]="$DEV_DROPLET_IP"
)

##
## Retrieves configuration for the specified environment and exports
## environment-specific variables for use in droplet scripts.
##
## @param {string} env - Environment name (prod, dev)
##
get_config() {
    local env=$1

    # Validate environment
    local ip=${ENVIRONMENTS[$env]:-}
    if [[ -z "$ip" ]]; then
        echo "ERROR: Unknown environment '$env'. Available: ${!ENVIRONMENTS[*]}" >&2
        exit 1
    fi

    # Export base configuration
    export ENV="$env"
    export DROPLET_IP="$ip"
    export DROPLET_HOST="root@$ip"

    # Unified deployment directory for all environments
    export DEPLOY_DIR="/opt/tronrelic"

    # Unified Docker compose file
    export COMPOSE_FILE="docker-compose.yml"

    # Environment-specific Docker image tag
    if [[ "$env" == "prod" ]]; then
        export ENV_TAG="production"
    else
        export ENV_TAG="development"
    fi

    # Unified container names (no suffixes)
    export MONGO_CONTAINER="tronrelic-mongo"
    export REDIS_CONTAINER="tronrelic-redis"
    export BACKEND_CONTAINER="tronrelic-backend"
    export FRONTEND_CONTAINER="tronrelic-frontend"

    # Export GitHub configuration
    export GITHUB_USERNAME
    export GITHUB_REPO
}

##
## Executes a command on the remote droplet via SSH.
## Must call get_config() before using this function.
##
## @param {string} command - Command to execute remotely
## @returns {number} Exit code from remote command
##
remote_exec() {
    if [[ -z "${DROPLET_HOST:-}" ]]; then
        echo "ERROR: DROPLET_HOST not set. Call get_config() first." >&2
        exit 1
    fi
    ssh "$DROPLET_HOST" "$1"
}

##
## Retrieves MongoDB password from the remote droplet's .env file.
## Must call get_config() before using this function.
##
## @returns {string} MongoDB root password
##
get_mongo_password() {
    if [[ -z "${DEPLOY_DIR:-}" ]]; then
        echo "ERROR: DEPLOY_DIR not set. Call get_config() first." >&2
        exit 1
    fi
    remote_exec "grep '^MONGO_ROOT_PASSWORD=' $DEPLOY_DIR/.env | cut -d'=' -f2 | tr -d '\"'"
}

##
## Executes a command in the MongoDB container with proper authentication.
## Automatically retrieves credentials from the remote .env file.
## Must call get_config() before using this function.
##
## @param {string} command - MongoDB command to execute
## @param {string} database - Optional database name (defaults to admin)
## @returns {number} Exit code from mongosh command
##
mongo_exec() {
    local command=$1
    local database=${2:-admin}
    local mongo_password

    mongo_password=$(get_mongo_password)

    # Pass password via environment variable to prevent exposure in process lists
    remote_exec "docker exec -i -e MONGO_PASSWORD='$mongo_password' $MONGO_CONTAINER sh -c 'mongosh \
        --username admin \
        --password \"\$MONGO_PASSWORD\" \
        --authenticationDatabase admin \
        --quiet \
        $([[ "$database" != "admin" ]] && echo "$database") \
        --eval \"$command\"'"
}

##
## Displays available environments and their configuration.
## Useful for debugging and understanding what environments are configured.
##
show_environments() {
    echo "Available environments:"
    echo ""
    for env in "${!ENVIRONMENTS[@]}"; do
        local ip=${ENVIRONMENTS[$env]}
        echo "  $env:"
        echo "    IP:         $ip"
        echo "    SSH:        root@$ip"
        echo "    Deploy dir: /opt/tronrelic (unified)"
        if [[ "$env" == "prod" ]]; then
            echo "    Image tag:  production"
        else
            echo "    Image tag:  development"
        fi
        echo ""
    done
}