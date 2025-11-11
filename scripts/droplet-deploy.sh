#!/bin/bash

##
## Droplet Initial Setup Script
##
## Takes a fresh Digital Ocean droplet from bare Ubuntu to fully configured
## TronRelic environment ready for droplet-update.sh to run.
##
## Usage:
##   ./scripts/droplet-deploy.sh <env> [--force]
##
## Arguments:
##   env           Environment (prod, dev)
##
## Options:
##   --force       Skip confirmation prompts
##
## Requirements:
##   - Fresh Ubuntu 22.04+ droplet
##   - Root SSH access configured
##   - GitHub Personal Access Token with read:packages scope
##
## What this script does:
##   1. Installs Docker and Docker Compose
##   2. Installs and configures Nginx reverse proxy
##   3. Configures firewall (UFW)
##   4. Authenticates with GitHub Container Registry
##   5. Creates project directory structure
##   6. Creates environment .env file with secure secrets
##   7. Creates docker-compose.yml for environment
##   8. Pulls and starts Docker containers
##   9. Verifies deployment
##

set -euo pipefail  # Exit on error, undefined variables, and pipe failures

# Track current operation for error reporting
CURRENT_STEP="Initialization"

# Source environment configuration
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/droplet-config.sh"
source "$SCRIPT_DIR/droplet-setup-nginx.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Error handler - called when script fails
cleanup_on_error() {
    local exit_code=$?

    # Don't run cleanup for successful exits or user cancellations
    if [ $exit_code -eq 0 ] || [ $exit_code -eq 130 ]; then
        return 0
    fi

    echo ""
    echo -e "${RED}===================================================${NC}"
    echo -e "${RED}  DEPLOYMENT FAILED${NC}"
    echo -e "${RED}===================================================${NC}"
    echo ""
    echo -e "${RED}[ERROR]${NC} Deployment failed during: ${YELLOW}${CURRENT_STEP}${NC}"
    echo -e "${RED}[ERROR]${NC} Exit code: $exit_code"
    echo ""
    echo -e "${YELLOW}Troubleshooting steps:${NC}"
    echo "  1. Check the error messages above for specific details"
    echo "  2. Verify the droplet is accessible: ssh $DROPLET_HOST"
    echo "  3. Check droplet logs: ssh $DROPLET_HOST 'journalctl -xe'"
    echo ""
    echo -e "${YELLOW}Recovery options:${NC}"
    echo "  • Retry deployment: $0 $ENV --force"
    echo "  • Manual inspection: ssh $DROPLET_HOST"
    echo "  • View recent errors: ssh $DROPLET_HOST 'dmesg | tail -50'"
    echo ""
    echo -e "${YELLOW}Common issues by step:${NC}"
    case "$CURRENT_STEP" in
        *"SSH"*)
            echo "  - Verify SSH key is configured for the droplet"
            echo "  - Check firewall allows port 22"
            echo "  - Ensure droplet IP is correct in .env"
            ;;
        *"Docker"*)
            echo "  - Check if apt is locked by another process"
            echo "  - Verify droplet has internet connectivity"
            echo "  - Ensure sufficient disk space: ssh $DROPLET_HOST 'df -h'"
            ;;
        *"GHCR"*|*"GitHub"*)
            echo "  - Verify GitHub token has 'read:packages' scope"
            echo "  - Check token hasn't expired"
            echo "  - Ensure images exist: ghcr.io/$GITHUB_USERNAME/$GITHUB_REPO"
            ;;
        *"Container"*|*"compose"*)
            echo "  - Check .env file has all required variables"
            echo "  - Verify images were pulled successfully"
            echo "  - Check container logs: ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker compose logs'"
            ;;
    esac
    echo ""

    exit $exit_code
}

# Set up error trap
trap cleanup_on_error EXIT

# Parse arguments
if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <env> [--force]"
    echo ""
    echo "Environments: prod, dev"
    echo ""
    echo "Example:"
    echo "  $0 prod"
    echo "  $0 dev --force"
    echo ""
    exit 1
fi

ENV="$1"
FORCE_DEPLOY=false

if [[ "$2" == "--force" ]]; then
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

log_step() {
    echo ""
    echo -e "${CYAN}===================================================${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}===================================================${NC}"
    echo ""
}

# Check SSH connection
CURRENT_STEP="STEP 1: Verifying SSH Connection"
log_step "$CURRENT_STEP"
log_info "Testing connection to $DROPLET_HOST..."
if ! remote_exec "echo 'SSH connection successful'" > /dev/null 2>&1; then
    log_error "Failed to connect to $DROPLET_HOST"
    log_error "Please ensure:"
    log_error "  1. The droplet IP is correct"
    log_error "  2. SSH key is configured"
    log_error "  3. You can run: ssh $DROPLET_HOST"
    exit 1
fi
log_success "SSH connection verified"

# Show droplet info
log_info "Droplet information:"
remote_exec "echo '  OS: ' && cat /etc/os-release | grep PRETTY_NAME | cut -d'\"' -f2"
remote_exec "echo '  Hostname: ' && hostname"
remote_exec "echo '  IP: ' && hostname -I"

# Confirmation prompt
if [[ "$FORCE_DEPLOY" != true ]]; then
    echo ""
    log_warning "This will install Docker, configure firewall, and deploy TronRelic ${ENV^^} on:"
    log_warning "  Host: $DROPLET_HOST"
    log_warning "  Deploy directory: $DEPLOY_DIR"
    log_warning "  Environment: ${ENV^^}"
    log_warning "  Image tag: $ENV_TAG"
    echo ""
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Setup cancelled"
        exit 0
    fi
fi

# Collect required credentials
CURRENT_STEP="STEP 2: Collecting Configuration"
log_step "$CURRENT_STEP"

echo ""
log_info "You will need:"
log_info "  1. GitHub Personal Access Token (classic) with 'read:packages' scope"
log_info "  2. Three TronGrid API keys from https://www.trongrid.io/"
echo ""

read -r -s -p "GitHub Personal Access Token: " GITHUB_TOKEN
echo ""
if [[ -z "$GITHUB_TOKEN" ]]; then
    log_error "GitHub token is required"
    exit 1
fi

# Validate GitHub token format (should be alphanumeric, typical length 40-255 chars)
if [[ ! "$GITHUB_TOKEN" =~ ^[a-zA-Z0-9_-]{20,}$ ]]; then
    log_error "GitHub token format appears invalid (expected alphanumeric string)"
    log_error "If you believe this is an error, please report it"
    exit 1
fi

echo ""
log_info "Enter your TronGrid API keys:"
read -r -s -p "TronGrid API Key 1: " TRONGRID_KEY_1
echo ""
read -r -s -p "TronGrid API Key 2: " TRONGRID_KEY_2
echo ""
read -r -s -p "TronGrid API Key 3: " TRONGRID_KEY_3
echo ""

if [[ -z "$TRONGRID_KEY_1" ]] || [[ -z "$TRONGRID_KEY_2" ]] || [[ -z "$TRONGRID_KEY_3" ]]; then
    log_error "All three TronGrid API keys are required"
    exit 1
fi

# Validate TronGrid API keys format (alphanumeric strings)
for key_var in "TRONGRID_KEY_1" "TRONGRID_KEY_2" "TRONGRID_KEY_3"; do
    key_value="${!key_var}"
    if [[ ! "$key_value" =~ ^[a-zA-Z0-9_-]{10,}$ ]]; then
        log_error "$key_var format appears invalid (expected alphanumeric string)"
        log_error "If you believe this is an error, please report it"
        exit 1
    fi
done

# Install Docker
CURRENT_STEP="STEP 3: Installing Docker"
log_step "$CURRENT_STEP"
log_info "Updating system packages..."
remote_exec "apt update -qq"

log_info "Installing Docker..."
if remote_exec "command -v docker" > /dev/null 2>&1; then
    log_success "Docker is already installed"
    remote_exec "docker --version"
else
    remote_exec "curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh && rm get-docker.sh"
    log_success "Docker installed successfully"
    remote_exec "docker --version"
fi

log_info "Verifying Docker Compose..."
remote_exec "docker compose version"
log_success "Docker Compose is available"

# Install and configure Nginx
CURRENT_STEP="STEP 4: Installing and Configuring Nginx"
log_step "$CURRENT_STEP"
log_info "Installing Nginx..."

if remote_exec "command -v nginx" > /dev/null 2>&1; then
    log_success "Nginx is already installed"
else
    remote_exec "apt install -y nginx"
    log_success "Nginx installed successfully"
fi

log_info "Configuring Nginx for TronRelic ${ENV^^}..."
update_nginx_config "$ENV" "$DROPLET_IP" "$DEPLOY_DIR"

log_info "Ensuring Nginx is enabled and started..."
remote_exec "systemctl enable nginx"
remote_exec "systemctl start nginx || systemctl restart nginx"
log_success "Nginx configured and started"

# Configure firewall
CURRENT_STEP="STEP 5: Configuring Firewall"
log_step "$CURRENT_STEP"
log_info "Setting up UFW firewall rules..."

remote_exec "ufw allow 22/tcp comment 'SSH'"
remote_exec "ufw allow 80/tcp comment 'HTTP'"
remote_exec "ufw allow 443/tcp comment 'HTTPS'"
remote_exec "ufw --force enable"

log_success "Firewall configured (only SSH, HTTP, HTTPS exposed)"
log_info "Application ports 3000/4000 are NOT exposed - Nginx proxies all traffic"
remote_exec "ufw status"

# Authenticate with GitHub Container Registry
CURRENT_STEP="STEP 6: Authenticating with GitHub Container Registry"
log_step "$CURRENT_STEP"
log_info "Logging into ghcr.io..."

if printf '%s\n' "$GITHUB_TOKEN" | ssh "$DROPLET_HOST" "docker login ghcr.io -u $GITHUB_USERNAME --password-stdin"; then
    log_success "Successfully authenticated with GHCR"
else
    log_error "Failed to authenticate with GitHub Container Registry"
    log_error "Please verify your token has 'read:packages' scope"
    exit 1
fi

# Create project directory
CURRENT_STEP="STEP 7: Creating Project Directory"
log_step "$CURRENT_STEP"
log_info "Creating $DEPLOY_DIR..."

remote_exec "mkdir -p $DEPLOY_DIR"
log_success "Project directory created"

# Generate secure secrets
CURRENT_STEP="STEP 8: Generating Secure Credentials"
log_step "$CURRENT_STEP"
log_info "Generating random secrets..."

ADMIN_TOKEN=$(openssl rand -hex 32)
MONGO_PASSWORD=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 32)

log_success "Secrets generated"
echo ""
log_warning "═══════════════════════════════════════════════════════════════"
log_warning "       CREDENTIALS (also stored in $DEPLOY_DIR/.env)"
log_warning "═══════════════════════════════════════════════════════════════"
echo ""
echo "  ADMIN_API_TOKEN:      $ADMIN_TOKEN"
echo "  MONGO_ROOT_PASSWORD:  $MONGO_PASSWORD"
echo "  REDIS_PASSWORD:       $REDIS_PASSWORD"
echo ""
log_warning "IMPORTANT:"
log_warning "  • Save ADMIN_API_TOKEN to access /system endpoint"
log_warning "  • Credentials are stored in $DEPLOY_DIR/.env on the server"
log_warning "  • To retrieve later: ssh $DROPLET_HOST 'cat $DEPLOY_DIR/.env'"
echo ""
log_warning "SECURITY: Clear terminal history after this script completes:"
log_warning "  bash:  history -c && history -w"
log_warning "  zsh:   history -c"
echo ""

if [[ "$FORCE_DEPLOY" != true ]]; then
    read -p "Press ENTER to continue after saving ADMIN_API_TOKEN..."
fi

# Create .env file
CURRENT_STEP="STEP 9: Creating ${ENV^^} Environment File"
log_step "$CURRENT_STEP"
log_info "Writing .env file..."

# Determine SITE_URL based on environment
if [[ "$ENV" == "prod" ]]; then
    SITE_URL="https://tronrelic.com"
else
    SITE_URL="https://dev.tronrelic.com"
fi

remote_exec "cat > $DEPLOY_DIR/.env << 'EOF'
# TronRelic ${ENV^^} Environment

# Environment Identifier (controls Docker image tag and NODE_ENV)
ENV=$ENV_TAG

# Docker Image Configuration (required for docker-compose.yml)
GITHUB_USERNAME=$GITHUB_USERNAME
GITHUB_REPO=$GITHUB_REPO
IMAGE_TAG=$ENV_TAG

# Site URL
SITE_URL=$SITE_URL

# Required - API Security
ADMIN_API_TOKEN=$ADMIN_TOKEN

# Required - TronGrid API Keys
TRONGRID_API_KEY=$TRONGRID_KEY_1
TRONGRID_API_KEY_2=$TRONGRID_KEY_2
TRONGRID_API_KEY_3=$TRONGRID_KEY_3

# Database Security
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=$MONGO_PASSWORD
REDIS_PASSWORD=$REDIS_PASSWORD

# Backend Configuration
PORT=4000
ENABLE_SCHEDULER=true
ENABLE_WEBSOCKETS=true
REDIS_NAMESPACE=tronrelic
EOF"

remote_exec "chmod 600 $DEPLOY_DIR/.env"

log_success "Environment file created"

# Copy docker-compose.yml from repo
CURRENT_STEP="STEP 10: Copying Docker Compose Configuration"
log_step "$CURRENT_STEP"
log_info "Copying unified $COMPOSE_FILE to server..."

# Copy the unified docker-compose.yml file from the local repo to the server
scp "$SCRIPT_DIR/../docker-compose.yml" "$DROPLET_HOST:$DEPLOY_DIR/"

log_success "Docker Compose configuration copied"

# Pull Docker images
CURRENT_STEP="STEP 11: Pulling Docker Images"
log_step "$CURRENT_STEP"
log_info "This may take several minutes..."

if remote_exec "cd $DEPLOY_DIR && docker compose pull"; then
    log_success "Docker images pulled successfully"
else
    log_error "Failed to pull Docker images"
    log_error "Please check:"
    log_error "  1. GitHub token has correct permissions"
    log_error "  2. Images exist at ghcr.io/$GITHUB_USERNAME/$GITHUB_REPO"
    log_error "  3. Images have been pushed with :$ENV_TAG tag"
    exit 1
fi

# Start containers
CURRENT_STEP="STEP 12: Starting Docker Containers"
log_step "$CURRENT_STEP"
log_info "Starting all services..."

if remote_exec "cd $DEPLOY_DIR && docker compose up -d"; then
    log_success "Containers started successfully"
else
    log_error "Failed to start containers"
    exit 1
fi

# Wait for startup
log_info "Waiting for services to initialize (30 seconds)..."
sleep 30

# Check container status
CURRENT_STEP="STEP 13: Verifying Deployment"
log_step "$CURRENT_STEP"
log_info "Container status:"
remote_exec "cd $DEPLOY_DIR && docker compose ps"
echo ""

# Test endpoints via Nginx
log_info "Testing backend API via Nginx..."
if curl -sf "http://$DROPLET_IP/api/health" > /dev/null; then
    log_success "Backend API is healthy (via Nginx)"
else
    log_warning "Backend health check failed (may still be starting)"
fi

log_info "Testing frontend via Nginx..."
if curl -sf "http://$DROPLET_IP/" > /dev/null; then
    log_success "Frontend is healthy (via Nginx)"
else
    log_warning "Frontend health check failed (may still be starting)"
fi

# Final summary
CURRENT_STEP="DEPLOYMENT COMPLETE"
log_step "DEPLOYMENT COMPLETE!"

echo ""
log_success "TronRelic ${ENV^^} has been successfully deployed!"
echo ""
echo -e "${CYAN}Application URLs (via Nginx on port 80):${NC}"
echo "  Frontend:     http://$DROPLET_IP/"
echo "  Backend API:  http://$DROPLET_IP/api"
echo "  System:       http://$DROPLET_IP/system"
echo ""
echo -e "${CYAN}Admin Credentials:${NC}"
echo "  ADMIN_API_TOKEN: $ADMIN_TOKEN"
echo ""
echo -e "${CYAN}Configuration:${NC}"
echo "  Environment:  ${ENV^^}"
echo "  Image tags:   :$ENV_TAG"
echo "  Nginx:        Reverse proxy on port 80"
echo "  Frontend:     Internal port 3000 (proxied)"
echo "  Backend:      Internal port 4000 (proxied)"
echo ""
echo -e "${CYAN}Next Steps:${NC}"
echo "  1. Access the frontend at http://$DROPLET_IP/"
echo "  2. Test the system monitor at http://$DROPLET_IP/system"
echo "  3. Use ./scripts/droplet-update.sh $ENV to deploy updates"
if [[ "$ENV" == "prod" ]]; then
    echo "  4. Set up SSL/HTTPS with: ./scripts/droplet-setup-ssl.sh prod yourdomain.com your-email@example.com"
fi
echo ""
echo -e "${CYAN}View Logs:${NC}"
echo "  ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker compose logs -f'"
echo ""
echo -e "${CYAN}Container Management:${NC}"
echo "  Restart:  ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker compose restart'"
echo "  Stop:     ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker compose down'"
echo "  Status:   ssh $DROPLET_HOST 'cd $DEPLOY_DIR && docker compose ps'"
echo ""
log_success "Setup script completed successfully!"
