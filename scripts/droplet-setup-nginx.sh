#!/bin/bash

##
## Nginx Configuration Setup Script
##
## Can be used in two ways:
##
## 1. As a standalone script:
##    ./scripts/droplet-setup-nginx.sh <env>
##    Example: ./scripts/droplet-setup-nginx.sh dev
##
## 2. As a sourced function (used by other scripts):
##    source scripts/droplet-setup-nginx.sh
##    update_nginx_config "$ENV" "$DROPLET_IP" "$DEPLOY_DIR"
##

# Function to update Nginx configuration on remote droplet
# Arguments:
#   $1 - Environment (prod, dev)
#   $2 - Droplet IP address
#   $3 - Deploy directory path
update_nginx_config() {
    local ENV="$1"
    local DROPLET_IP="$2"
    local DEPLOY_DIR="$3"

    # Determine Nginx site name and domain
    local NGINX_SITE
    local SERVER_NAME
    if [[ "$ENV" == "prod" ]]; then
        NGINX_SITE="tronrelic"
        SERVER_NAME="tronrelic.com"
    else
        NGINX_SITE="tronrelic-$ENV"
        SERVER_NAME="dev.tronrelic.com"
    fi

    log_info "Updating Nginx configuration for $NGINX_SITE..."

    # Backup existing config if it exists
    if remote_exec "test -f /etc/nginx/sites-available/$NGINX_SITE"; then
        remote_exec "cp /etc/nginx/sites-available/$NGINX_SITE /etc/nginx/sites-available/$NGINX_SITE.backup-\$(date +%Y%m%d-%H%M%S)"
        log_info "Backed up existing configuration"
    fi

    # Check if SSL certificates exist
    local HAS_SSL=false
    if remote_exec "test -f /etc/letsencrypt/live/$SERVER_NAME/fullchain.pem"; then
        HAS_SSL=true
        log_info "SSL certificates found for $SERVER_NAME"
    fi

    # Create Nginx configuration based on SSL availability
    if [[ "$HAS_SSL" == true ]]; then
        # HTTPS configuration with SSL
        remote_exec "cat > /etc/nginx/sites-available/$NGINX_SITE << 'NGINXEOF'
# HTTP - Redirect to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME;

    # Let's Encrypt validation
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all other HTTP traffic to HTTPS
    location / {
        return 301 https://\\\$server_name\\\$request_uri;
    }
}

# HTTPS
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $SERVER_NAME;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/$SERVER_NAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$SERVER_NAME/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header X-Frame-Options \"SAMEORIGIN\" always;
    add_header X-Content-Type-Options \"nosniff\" always;
    add_header X-XSS-Protection \"1; mode=block\" always;
    add_header Strict-Transport-Security \"max-age=31536000; includeSubDomains\" always;

    # Increase timeouts for long-running requests
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;

    # Static file serving for uploads (highest priority)
    location /uploads/ {
        alias $DEPLOY_DIR/public/uploads/;

        # Enable caching for uploaded files
        expires 7d;
        add_header Cache-Control \"public, immutable\";

        # Prevent directory listing
        autoindex off;

        # Security headers
        add_header X-Content-Type-Options \"nosniff\";
        add_header X-Frame-Options \"SAMEORIGIN\";
    }

    # Backend API
    location /api {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }

    # WebSocket connections
    location /socket.io {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_cache_bypass \\\$http_upgrade;
    }

    # Frontend (Next.js)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }
}
NGINXEOF"
    else
        # HTTP-only configuration (no SSL yet)
        remote_exec "cat > /etc/nginx/sites-available/$NGINX_SITE << 'NGINXEOF'
server {
    listen 80;
    listen [::]:80;
    server_name $SERVER_NAME $DROPLET_IP;

    # Security headers
    add_header X-Frame-Options \"SAMEORIGIN\" always;
    add_header X-Content-Type-Options \"nosniff\" always;
    add_header X-XSS-Protection \"1; mode=block\" always;

    # Increase timeouts for long-running requests
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;

    # Static file serving for uploads (highest priority)
    location /uploads/ {
        alias $DEPLOY_DIR/public/uploads/;

        # Enable caching for uploaded files
        expires 7d;
        add_header Cache-Control \"public, immutable\";

        # Prevent directory listing
        autoindex off;

        # Security headers
        add_header X-Content-Type-Options \"nosniff\";
        add_header X-Frame-Options \"SAMEORIGIN\";
    }

    # Backend API
    location /api {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }

    # WebSocket connections
    location /socket.io {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_cache_bypass \\\$http_upgrade;
    }

    # Frontend (Next.js)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
    }
}
NGINXEOF"
    fi  # End of SSL check

    # Enable site if not already enabled
    if ! remote_exec "test -L /etc/nginx/sites-enabled/$NGINX_SITE"; then
        log_info "Enabling Nginx site..."
        remote_exec "ln -sf /etc/nginx/sites-available/$NGINX_SITE /etc/nginx/sites-enabled/$NGINX_SITE"
    fi

    # Remove default site if it exists
    remote_exec "rm -f /etc/nginx/sites-enabled/default" 2>/dev/null || true

    # Test Nginx configuration
    log_info "Testing Nginx configuration..."
    if remote_exec "nginx -t"; then
        log_success "Nginx configuration is valid"
        remote_exec "systemctl reload nginx"
        log_success "Nginx reloaded with updated configuration"
        return 0
    else
        log_error "Nginx configuration test failed"
        # Restore backup if update failed
        if remote_exec "test -f /etc/nginx/sites-available/$NGINX_SITE.backup-*"; then
            log_warning "Restoring backup configuration..."
            remote_exec "mv /etc/nginx/sites-available/$NGINX_SITE.backup-* /etc/nginx/sites-available/$NGINX_SITE"
            remote_exec "systemctl reload nginx"
        fi
        return 1
    fi
}

# ============================================
# Standalone Script Mode
# ============================================

# Check if script is being executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    # Source required dependencies
    SCRIPT_DIR="$(dirname "$0")"
    source "$SCRIPT_DIR/droplet-config.sh"

    # Colors for output
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m' # No Color

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

    # Parse arguments
    if [[ $# -lt 1 ]]; then
        echo "Usage: $0 <env>"
        echo ""
        echo "Environments: prod, dev"
        echo ""
        echo "Examples:"
        echo "  $0 prod"
        echo "  $0 dev"
        echo ""
        exit 1
    fi

    ENV="$1"

    # Load environment configuration
    get_config "$ENV"

    # Check SSH connection
    log_info "Checking SSH connection to ${ENV} droplet..."
    if ! remote_exec "echo 'Connection successful'" > /dev/null 2>&1; then
        log_error "Failed to connect to $DROPLET_HOST"
        log_error "Please ensure SSH is configured correctly"
        exit 1
    fi
    log_success "SSH connection verified"

    echo ""
    log_info "Updating Nginx configuration for ${ENV^^}..."
    echo ""

    # Call the function
    if update_nginx_config "$ENV" "$DROPLET_IP" "$DEPLOY_DIR"; then
        echo ""
        log_success "Nginx configuration updated successfully!"
        echo ""
        log_info "Test the configuration:"
        echo "  curl -I http://$DROPLET_IP/uploads/path/to/file.png"
        echo ""
        exit 0
    else
        echo ""
        log_error "Failed to update Nginx configuration"
        exit 1
    fi
fi
