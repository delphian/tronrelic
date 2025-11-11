#!/bin/bash

##
## Droplet Deployment Update Script
##
## Connects to a droplet and updates TronRelic application
## by pulling the latest Docker images from GitHub Container Registry
## and restarting all containers.
##
## Usage:
##   ./scripts/droplet-update.sh <env> [--force]
##
## Arguments:
##   env    Environment (prod, dev)
##
## Options:
##   --force    Skip confirmation prompt
##
## Requirements:
##   - SSH access configured for the droplet
##   - Docker and docker-compose installed on droplet
##   - GitHub Container Registry authentication configured on droplet
##
## Examples:
##   ./scripts/droplet-update.sh prod
##   ./scripts/droplet-update.sh dev --force
##

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Source environment configuration
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/droplet-config.sh"
source "$SCRIPT_DIR/droplet-setup-ssl.sh"
source "$SCRIPT_DIR/droplet-setup-nginx.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <env> [--force]"
    echo ""
    echo "Environments: prod, dev"
    echo ""
    echo "Examples:"
    echo "  $0 prod"
    echo "  $0 dev --force"
    echo ""
    exit 1
fi

ENV="$1"
FORCE_DEPLOY=false

# Check for optional --force flag
if [[ ${2:-} == "--force" ]]; then
    FORCE_DEPLOY=true
fi

# Load environment configuration
get_config "$ENV"

# Function to print colored output
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check SSH connection
log_info "Checking SSH connection to ${ENV} droplet..."
if ! remote_exec "echo 'Connection successful'" > /dev/null 2>&1; then
    log_error "Failed to connect to $DROPLET_HOST"
    log_error "Please ensure SSH is configured correctly"
    exit 1
fi
log_success "SSH connection verified"

# Confirmation prompt
if [[ "$FORCE_DEPLOY" != true ]]; then
    echo ""
    log_warning "This will deploy the latest :$ENV_TAG images to ${ENV^^} at $DROPLET_HOST"
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Deployment cancelled"
        exit 0
    fi
fi

echo ""
log_info "Starting ${ENV} deployment..."
echo ""

# Step 0a: Setup SSL certificates (if domain is configured)
if [[ "$ENV" == "prod" ]]; then
    DOMAIN="tronrelic.com"
elif [[ "$ENV" == "dev" ]]; then
    DOMAIN="dev.tronrelic.com"
else
    DOMAIN=""
fi

if [[ -n "$DOMAIN" ]]; then
    EMAIL="${SSL_EMAIL:-admin@tronrelic.com}"
    log_info "Checking SSL certificates for $DOMAIN..."
    setup_ssl_certificates "$ENV" "$DOMAIN" "$EMAIL" || log_warning "SSL setup skipped (certificates may already exist)"
    echo ""
fi

# Step 0b: Update Nginx configuration
update_nginx_config "$ENV" "$DROPLET_IP" "$DEPLOY_DIR"
echo ""

# Step 0c: Update docker-compose configuration
log_info "Updating docker-compose.yml configuration..."
if scp "$SCRIPT_DIR/../docker-compose.yml" "$DROPLET_HOST:$DEPLOY_DIR/"; then
    log_success "Docker compose configuration updated"
else
    log_error "Failed to copy docker-compose configuration"
    exit 1
fi
echo ""

# Step 1: Check current container status
log_info "Checking current container status..."
remote_exec "cd $DEPLOY_DIR && docker compose -f $COMPOSE_FILE ps"
echo ""

# Step 2: Pull latest images
log_info "Pulling latest :$ENV_TAG Docker images from GitHub Container Registry..."
if remote_exec "cd $DEPLOY_DIR && docker compose -f $COMPOSE_FILE pull"; then
    log_success "Images pulled successfully"
else
    log_error "Failed to pull images"
    exit 1
fi
echo ""

# Step 3: Restart containers
log_info "Restarting containers with new images..."
if [[ "$ENV" == "dev" ]]; then
    # For dev, do a full down/up to ensure clean state
    if remote_exec "cd $DEPLOY_DIR && docker compose -f $COMPOSE_FILE down && docker compose -f $COMPOSE_FILE up -d"; then
        log_success "Containers restarted successfully"
    else
        log_error "Failed to restart containers"
        exit 1
    fi
else
    # For prod, use rolling restart to minimize downtime
    if remote_exec "cd $DEPLOY_DIR && docker compose -f $COMPOSE_FILE up -d"; then
        log_success "Containers restarted successfully"
    else
        log_error "Failed to restart containers"
        exit 1
    fi
fi
echo ""

# Step 4: Cleanup dangling images
log_info "Cleaning up dangling Docker images..."
if remote_exec "docker image prune -f"; then
    log_success "Dangling images cleaned up"
else
    log_warning "Failed to cleanup images (non-critical)"
fi
echo ""

# Step 5: Wait for containers to start
log_info "Waiting for containers to start (15 seconds)..."
sleep 15

# Step 6: Check container health
log_info "Checking container health..."
remote_exec "cd $DEPLOY_DIR && docker compose -f $COMPOSE_FILE ps"
echo ""

# Step 7: Verify backend health
log_info "Verifying backend API health (max 60s)..."
MAX_ATTEMPTS=12
ATTEMPT=0
BACKEND_HEALTHY=false

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))

    if curl -sf "http://$DROPLET_IP/api/health" > /dev/null 2>&1; then
        log_success "Backend is healthy (attempt $ATTEMPT/$MAX_ATTEMPTS)"
        BACKEND_HEALTHY=true
        break
    fi

    if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
        echo "  Attempt $ATTEMPT/$MAX_ATTEMPTS failed, retrying in 5s..."
        sleep 5
    fi
done

if [ "$BACKEND_HEALTHY" = false ]; then
    log_error "Backend health check failed after $MAX_ATTEMPTS attempts (60s)"
    log_warning "Check backend logs: ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker compose -f $COMPOSE_FILE logs backend'"
    exit 1
fi

# Step 8: Verify frontend health
log_info "Verifying frontend health (max 60s)..."
ATTEMPT=0
FRONTEND_HEALTHY=false

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))

    if curl -sf "http://$DROPLET_IP/" > /dev/null 2>&1; then
        log_success "Frontend is healthy (attempt $ATTEMPT/$MAX_ATTEMPTS)"
        FRONTEND_HEALTHY=true
        break
    fi

    if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
        echo "  Attempt $ATTEMPT/$MAX_ATTEMPTS failed, retrying in 5s..."
        sleep 5
    fi
done

if [ "$FRONTEND_HEALTHY" = false ]; then
    log_error "Frontend health check failed after $MAX_ATTEMPTS attempts (60s)"
    log_warning "Check frontend logs: ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker compose -f $COMPOSE_FILE logs frontend'"
    exit 1
fi

echo ""
log_success "${ENV^^} deployment complete!"
echo ""
log_info "Application URLs:"
echo "  Frontend: http://$DROPLET_IP/"
echo "  Backend:  http://$DROPLET_IP/api"
echo "  System:   http://$DROPLET_IP/system"
echo ""
log_info "View logs with:"
echo "  ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker compose -f $COMPOSE_FILE logs -f'"
echo ""
