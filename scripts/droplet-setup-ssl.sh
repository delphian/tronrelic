#!/bin/bash

##
## SSL Certificate Setup Script
##
## Can be used in two ways:
##
## 1. As a standalone script:
##    ./scripts/droplet-setup-ssl.sh <env>
##    Example: ./scripts/droplet-setup-ssl.sh dev
##
## 2. As a sourced function (used by other scripts):
##    source scripts/droplet-setup-ssl.sh
##    setup_ssl_certificates "$ENV" "$DOMAIN" "$EMAIL"
##
## What this does:
##   1. Installs Certbot if not present
##   2. Obtains SSL certificate from Let's Encrypt
##   3. Sets up automatic certificate renewal
##   Note: Nginx configuration is handled separately by droplet-setup-nginx.sh
##

set -e  # Exit on error

# Function to setup SSL certificates
# Arguments:
#   $1 - Environment (prod, dev)
#   $2 - Domain name
#   $3 - Email for Let's Encrypt notifications
setup_ssl_certificates() {
    local ENV="$1"
    local DOMAIN="$2"
    local EMAIL="$3"

    log_info "Setting up SSL certificates for $DOMAIN..."

    # Step 1: Install Certbot if not present
    if remote_exec "command -v certbot" > /dev/null 2>&1; then
        log_success "Certbot is already installed"
    else
        log_info "Installing Certbot..."
        remote_exec "apt update -qq && apt install -y certbot python3-certbot-nginx"
        log_success "Certbot installed successfully"
    fi

    # Step 2: Check if certificates already exist
    if remote_exec "test -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem"; then
        log_info "SSL certificates already exist for $DOMAIN"
        log_info "Certificate will be renewed automatically before expiration"
        return 0
    fi

    # Step 3: Obtain SSL certificate
    log_info "Requesting SSL certificate from Let's Encrypt..."
    if remote_exec "certbot certonly --nginx -d $DOMAIN --non-interactive --agree-tos --email $EMAIL"; then
        log_success "SSL certificate obtained successfully"
    else
        log_error "Failed to obtain SSL certificate"
        log_error "Common issues:"
        log_error "  1. Domain not pointing to correct IP (check DNS)"
        log_error "  2. Port 80 blocked by firewall (check UFW)"
        log_error "  3. Nginx not running (check systemctl status nginx)"
        return 1
    fi

    # Step 4: Setup automatic renewal
    log_info "Testing automatic renewal..."
    if remote_exec "certbot renew --dry-run"; then
        log_success "Certificate renewal test passed"
    else
        log_warning "Certificate renewal test failed (non-critical)"
    fi

    log_success "SSL certificates setup complete for $DOMAIN"
    return 0
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

    # Determine domain based on environment
    if [[ "$ENV" == "prod" ]]; then
        DOMAIN="tronrelic.com"
        EMAIL="${SSL_EMAIL:-admin@tronrelic.com}"
    else
        DOMAIN="dev.tronrelic.com"
        EMAIL="${SSL_EMAIL:-admin@tronrelic.com}"
    fi

    # Check SSH connection
    log_info "Checking SSH connection to ${ENV} droplet..."
    if ! remote_exec "echo 'Connection successful'" > /dev/null 2>&1; then
        log_error "Failed to connect to $DROPLET_HOST"
        log_error "Please ensure SSH is configured correctly"
        exit 1
    fi
    log_success "SSH connection verified"

    echo ""
    log_info "Setting up SSL for $DOMAIN..."
    echo ""

    # Call the function
    if setup_ssl_certificates "$ENV" "$DOMAIN" "$EMAIL"; then
        echo ""
        log_success "SSL setup completed successfully!"
        echo ""
        log_info "Certificate details:"
        remote_exec "certbot certificates -d $DOMAIN | grep -A 5 'Certificate Name'"
        echo ""
        log_info "Next steps:"
        echo "  1. Run: ./scripts/droplet-setup-nginx.sh $ENV"
        echo "  2. This will configure Nginx to use the new SSL certificates"
        echo ""
        exit 0
    else
        echo ""
        log_error "Failed to setup SSL certificates"
        exit 1
    fi
fi
