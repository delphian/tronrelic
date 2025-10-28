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

set -e  # Exit on error

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
log_step "STEP 1: Verifying SSH Connection"
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
    log_warning "  Image tag: $IMAGE_TAG"
    echo ""
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Setup cancelled"
        exit 0
    fi
fi

# Collect required credentials
log_step "STEP 2: Collecting Configuration"

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
log_step "STEP 3: Installing Docker"
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
log_step "STEP 4: Installing and Configuring Nginx"
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
log_step "STEP 5: Configuring Firewall"
log_info "Setting up UFW firewall rules..."

remote_exec "ufw allow 22/tcp comment 'SSH'"
remote_exec "ufw allow 80/tcp comment 'HTTP'"
remote_exec "ufw allow 443/tcp comment 'HTTPS'"
remote_exec "ufw --force enable"

log_success "Firewall configured (only SSH, HTTP, HTTPS exposed)"
log_info "Application ports 3000/4000 are NOT exposed - Nginx proxies all traffic"
remote_exec "ufw status"

# Authenticate with GitHub Container Registry
log_step "STEP 6: Authenticating with GitHub Container Registry"
log_info "Logging into ghcr.io..."

if printf '%s\n' "$GITHUB_TOKEN" | ssh "$DROPLET_HOST" "docker login ghcr.io -u $GITHUB_USERNAME --password-stdin"; then
    log_success "Successfully authenticated with GHCR"
else
    log_error "Failed to authenticate with GitHub Container Registry"
    log_error "Please verify your token has 'read:packages' scope"
    exit 1
fi

# Create project directory
log_step "STEP 7: Creating Project Directory"
log_info "Creating $DEPLOY_DIR..."

remote_exec "mkdir -p $DEPLOY_DIR"
log_success "Project directory created"

# Generate secure secrets
log_step "STEP 8: Generating Secure Credentials"
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
log_step "STEP 9: Creating ${ENV^^} Environment File"
log_info "Writing .env file..."

remote_exec "cat > $DEPLOY_DIR/.env << 'EOF'
# TronRelic ${ENV^^} Environment

# Required - API Security
ADMIN_API_TOKEN=$ADMIN_TOKEN

# Required - TronGrid API Keys
TRONGRID_API_KEY=$TRONGRID_KEY_1
TRONGRID_API_KEY_2=$TRONGRID_KEY_2
TRONGRID_API_KEY_3=$TRONGRID_KEY_3

# ${ENV^^} - Database Security
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=$MONGO_PASSWORD
REDIS_PASSWORD=$REDIS_PASSWORD

# Public URLs (via Nginx on port 80)
NEXT_PUBLIC_API_URL=http://$DROPLET_IP/api
NEXT_PUBLIC_SOCKET_URL=http://$DROPLET_IP
NEXT_PUBLIC_SITE_URL=http://$DROPLET_IP
EOF"

remote_exec "chmod 600 $DEPLOY_DIR/.env"

log_success "Environment file created"

# Create docker-compose.yml
log_step "STEP 10: Creating Docker Compose Configuration"
log_info "Writing docker-compose.yml..."

remote_exec "cat > $DEPLOY_DIR/docker-compose.yml << 'EOF'
version: \"3.8\"

services:
    mongodb:
        image: mongo:6
        container_name: $MONGO_CONTAINER
        restart: always
        ports:
            - \"27017:27017\"
        environment:
            - MONGO_INITDB_ROOT_USERNAME=\${MONGO_ROOT_USERNAME:-admin}
            - MONGO_INITDB_ROOT_PASSWORD=\${MONGO_ROOT_PASSWORD}
        volumes:
            - ${ENV}-mongo-data:/data/db
        networks:
            - tronrelic-network
        command: [\"mongod\", \"--auth\"]
        healthcheck:
            test: [\"CMD\", \"mongosh\", \"--eval\", \"db.adminCommand('ping')\"]
            interval: 10s
            timeout: 5s
            retries: 5
            start_period: 10s

    redis:
        image: redis:7-alpine
        container_name: $REDIS_CONTAINER
        restart: always
        ports:
            - \"6379:6379\"
        environment:
            - REDIS_PASSWORD=\${REDIS_PASSWORD}
        volumes:
            - ${ENV}-redis-data:/data
        networks:
            - tronrelic-network
        command: [\"redis-server\", \"--requirepass\", \"\${REDIS_PASSWORD}\", \"--appendonly\", \"yes\"]
        healthcheck:
            test: [\"CMD\", \"redis-cli\", \"--no-auth-warning\", \"-a\", \"\${REDIS_PASSWORD}\", \"ping\"]
            interval: 10s
            timeout: 5s
            retries: 5
            start_period: 5s

    backend:
        image: ghcr.io/$GITHUB_USERNAME/$GITHUB_REPO/backend:$IMAGE_TAG
        container_name: $BACKEND_CONTAINER
        restart: always
        ports:
            - \"4000:4000\"
        environment:
            - NODE_ENV=production
            - PORT=4000
            - MONGODB_URI=mongodb://\${MONGO_ROOT_USERNAME:-admin}:\${MONGO_ROOT_PASSWORD}@mongodb:27017/tronrelic?authSource=admin
            - REDIS_URL=redis://:\${REDIS_PASSWORD}@redis:6379
            - ENABLE_SCHEDULER=true
            - ENABLE_WEBSOCKETS=true
            - ADMIN_API_TOKEN=\${ADMIN_API_TOKEN}
            - TRONGRID_API_KEY=\${TRONGRID_API_KEY}
            - TRONGRID_API_KEY_2=\${TRONGRID_API_KEY_2}
            - TRONGRID_API_KEY_3=\${TRONGRID_API_KEY_3}
            - NODE_OPTIONS=--max-old-space-size=2048
        depends_on:
            mongodb:
                condition: service_healthy
            redis:
                condition: service_healthy
        networks:
            - tronrelic-network
        healthcheck:
            test: [\"CMD\", \"node\", \"-e\", \"require('http').get('http://localhost:4000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });\"]
            interval: 30s
            timeout: 10s
            retries: 3
            start_period: 40s

    frontend:
        image: ghcr.io/$GITHUB_USERNAME/$GITHUB_REPO/frontend:$IMAGE_TAG
        container_name: $FRONTEND_CONTAINER
        restart: always
        ports:
            - \"3000:3000\"
        environment:
            - NODE_ENV=production
            - API_URL=http://backend:4000
            - NEXT_PUBLIC_API_URL=\${NEXT_PUBLIC_API_URL:-http://localhost:4000/api}
            - NEXT_PUBLIC_SOCKET_URL=\${NEXT_PUBLIC_SOCKET_URL:-http://localhost:4000}
            - NEXT_PUBLIC_SITE_URL=\${NEXT_PUBLIC_SITE_URL:-http://localhost:3000}
            - NODE_OPTIONS=--max-old-space-size=1024
        depends_on:
            backend:
                condition: service_healthy
        networks:
            - tronrelic-network
        healthcheck:
            test: [\"CMD\", \"node\", \"-e\", \"require('http').get('http://localhost:3000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });\"]
            interval: 30s
            timeout: 10s
            retries: 3
            start_period: 40s

networks:
    tronrelic-network:
        driver: bridge

volumes:
    ${ENV}-mongo-data:
        driver: local
    ${ENV}-redis-data:
        driver: local
EOF"

log_success "Docker Compose configuration created"

# Pull Docker images
log_step "STEP 11: Pulling Docker Images"
log_info "This may take several minutes..."

if remote_exec "cd $DEPLOY_DIR && docker compose pull"; then
    log_success "Docker images pulled successfully"
else
    log_error "Failed to pull Docker images"
    log_error "Please check:"
    log_error "  1. GitHub token has correct permissions"
    log_error "  2. Images exist at ghcr.io/$GITHUB_USERNAME/$GITHUB_REPO"
    log_error "  3. Images have been pushed with :$IMAGE_TAG tag"
    exit 1
fi

# Start containers
log_step "STEP 12: Starting Docker Containers"
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
log_step "STEP 13: Verifying Deployment"
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
echo "  Image tags:   :$IMAGE_TAG"
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
