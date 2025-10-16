#!/bin/bash

##
## SSL Certificate Setup Script
##
## Sets up Let's Encrypt SSL certificates for TronRelic using Certbot
## and configures Nginx to serve HTTPS traffic with automatic HTTP to HTTPS redirect.
##
## Usage:
##   ./scripts/droplet-setup-ssl.sh <env> <domain> <email>
##
## Arguments:
##   env       Environment (prod, dev)
##   domain    Your domain name (e.g., tronrelic.com, dev.tronrelic.com)
##   email     Email for Let's Encrypt notifications (e.g., admin@tronrelic.com)
##
## Examples:
##   ./scripts/droplet-setup-ssl.sh prod tronrelic.com admin@tronrelic.com
##   ./scripts/droplet-setup-ssl.sh dev dev.tronrelic.com admin@tronrelic.com
##
## Requirements:
##   - DNS A record pointing domain to droplet IP
##   - Nginx already installed and configured
##   - Port 80 and 443 open in firewall
##
## What this script does:
##   1. Verifies DNS resolution for the domain
##   2. Installs Certbot and Nginx plugin
##   3. Obtains SSL certificate from Let's Encrypt
##   4. Configures Nginx with SSL and security headers
##   5. Sets up automatic certificate renewal
##   6. Tests HTTPS configuration
##

set -e  # Exit on error

# Source environment configuration
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/droplet-config.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments
if [[ $# -lt 3 ]]; then
    echo "Usage: $0 <env> <domain> <email>"
    echo ""
    echo "Environments: prod, dev"
    echo ""
    echo "Examples:"
    echo "  $0 prod tronrelic.com admin@tronrelic.com"
    echo "  $0 dev dev.tronrelic.com admin@tronrelic.com"
    echo ""
    exit 1
fi

ENV="$1"
DOMAIN="$2"
EMAIL="$3"

# Load environment configuration
get_config "$ENV"

# Determine Nginx site name
if [[ "$ENV" == "prod" ]]; then
    NGINX_SITE="tronrelic"
else
    NGINX_SITE="tronrelic-$ENV"
fi

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

# Step 1: Verify SSH connection
log_step "STEP 1: Verifying SSH Connection"
log_info "Testing connection to $DROPLET_HOST..."
if ! remote_exec "echo 'SSH connection successful'" > /dev/null 2>&1; then
    log_error "Failed to connect to $DROPLET_HOST"
    exit 1
fi
log_success "SSH connection verified"

# Step 2: Verify DNS resolution
log_step "STEP 2: Verifying DNS Configuration"
log_info "Checking if $DOMAIN resolves to $DROPLET_IP..."

RESOLVED_IP=$(dig +short "$DOMAIN" @8.8.8.8 | tail -n1)
if [[ -z "$RESOLVED_IP" ]]; then
    log_error "Domain $DOMAIN does not resolve to any IP"
    log_error "Please create a DNS A record pointing $DOMAIN to $DROPLET_IP"
    exit 1
fi

if [[ "$RESOLVED_IP" != "$DROPLET_IP" ]]; then
    log_error "Domain $DOMAIN resolves to $RESOLVED_IP, but expected $DROPLET_IP"
    log_error "Please update your DNS A record to point to $DROPLET_IP"
    log_error "Wait for DNS propagation (5-15 minutes) and try again"
    exit 1
fi

log_success "DNS verification passed: $DOMAIN → $DROPLET_IP"

# Step 3: Install Certbot
log_step "STEP 3: Installing Certbot"
log_info "Checking if Certbot is installed..."

if remote_exec "command -v certbot" > /dev/null 2>&1; then
    log_success "Certbot is already installed"
    remote_exec "certbot --version"
else
    log_info "Installing Certbot and Nginx plugin..."
    remote_exec "apt update -qq && apt install -y certbot python3-certbot-nginx"
    log_success "Certbot installed successfully"
    remote_exec "certbot --version"
fi

# Step 4: Obtain SSL certificate
log_step "STEP 4: Obtaining SSL Certificate"
log_info "Requesting certificate from Let's Encrypt for $DOMAIN..."
log_warning "This will modify your Nginx configuration automatically"

echo ""
log_info "Certbot will:"
log_info "  1. Verify you control $DOMAIN by creating a challenge file"
log_info "  2. Issue an SSL certificate (valid for 90 days)"
log_info "  3. Configure Nginx to use the certificate"
log_info "  4. Set up automatic HTTP → HTTPS redirect"
echo ""

# Run certbot in non-interactive mode
if remote_exec "certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email $EMAIL --redirect"; then
    log_success "SSL certificate obtained and installed!"
else
    log_error "Failed to obtain SSL certificate"
    log_error "Common issues:"
    log_error "  1. Domain not pointing to correct IP (check DNS)"
    log_error "  2. Port 80 blocked by firewall (check UFW)"
    log_error "  3. Nginx not running (check systemctl status nginx)"
    exit 1
fi

# Step 4.5: Verify Nginx site configuration exists
log_step "STEP 4.5: Verifying Nginx Site Configuration"
log_info "Checking if Nginx site configuration exists..."

if ! remote_exec "test -f /etc/nginx/sites-available/$NGINX_SITE"; then
    log_error "Nginx site configuration not found at /etc/nginx/sites-available/$NGINX_SITE"
    log_error ""
    log_error "This typically means droplet-deploy.sh was not run or did not complete successfully."
    log_error ""
    log_error "You have two options:"
    log_error "  1. Run droplet-deploy.sh to create the initial deployment configuration"
    log_error "  2. Manually create the Nginx configuration file"
    log_error ""
    log_error "After fixing, run this SSL setup script again:"
    log_error "  ./scripts/droplet-setup-ssl.sh $ENV $DOMAIN $EMAIL"
    exit 1
fi

if ! remote_exec "test -L /etc/nginx/sites-enabled/$NGINX_SITE"; then
    log_warning "Nginx site is not enabled (no symlink in sites-enabled/)"
    log_info "Creating symlink to enable site..."
    remote_exec "ln -sf /etc/nginx/sites-available/$NGINX_SITE /etc/nginx/sites-enabled/$NGINX_SITE"
    remote_exec "systemctl reload nginx"
    log_success "Nginx site enabled"
else
    log_success "Nginx site configuration exists and is enabled"
fi

# Step 5: Enhance Nginx SSL configuration
log_step "STEP 5: Enhancing Nginx SSL Configuration"
log_info "Adding security headers and SSL optimizations..."

# Backup current configuration
remote_exec "cp /etc/nginx/sites-available/$NGINX_SITE /etc/nginx/sites-available/$NGINX_SITE.backup"

# Create enhanced SSL configuration
remote_exec "cat > /etc/nginx/sites-available/$NGINX_SITE << 'NGINXEOF'
# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # Allow Let's Encrypt ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all other traffic to HTTPS
    location / {
        return 301 https://\\\$server_name\\\$request_uri;
    }
}

# HTTPS Server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;

    # SSL Configuration (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_session_timeout 1d;
    ssl_session_cache shared:MozSSL:10m;
    ssl_session_tickets off;

    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    # OCSP Stapling
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/letsencrypt/live/$DOMAIN/chain.pem;
    resolver 8.8.8.8 8.8.4.4 valid=300s;
    resolver_timeout 5s;

    # Security Headers
    add_header Strict-Transport-Security \"max-age=63072000; includeSubDomains; preload\" always;
    add_header X-Frame-Options \"SAMEORIGIN\" always;
    add_header X-Content-Type-Options \"nosniff\" always;
    add_header X-XSS-Protection \"1; mode=block\" always;
    add_header Referrer-Policy \"strict-origin-when-cross-origin\" always;

    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml font/truetype font/opentype application/vnd.ms-fontobject image/svg+xml;

    # Client body size limit
    client_max_body_size 10M;

    # Proxy timeout settings (important for WebSocket)
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    # Backend API
    location /api {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_set_header X-Forwarded-Host \\\$host;
        proxy_set_header X-Forwarded-Port \\\$server_port;
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

        # WebSocket-specific timeouts
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;

        # Disable buffering for WebSockets
        proxy_buffering off;
    }

    # Frontend (Next.js)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_set_header X-Forwarded-Host \\\$host;
        proxy_set_header X-Forwarded-Port \\\$server_port;
    }
}
NGINXEOF"

log_info "Testing Nginx configuration..."
if remote_exec "nginx -t"; then
    log_success "Nginx configuration is valid"
    remote_exec "systemctl reload nginx"
    log_success "Nginx reloaded with new SSL configuration"
else
    log_error "Nginx configuration test failed"
    log_warning "Restoring backup configuration..."
    remote_exec "cp /etc/nginx/sites-available/$NGINX_SITE.backup /etc/nginx/sites-available/$NGINX_SITE"
    remote_exec "systemctl reload nginx"
    exit 1
fi

# Step 6: Update environment variables
log_step "STEP 6: Updating Environment Variables"
log_info "Updating .env file with HTTPS URLs..."

remote_exec "sed -i 's|NEXT_PUBLIC_API_URL=http://|NEXT_PUBLIC_API_URL=https://|g' $DEPLOY_DIR/.env"
remote_exec "sed -i 's|NEXT_PUBLIC_SOCKET_URL=http://|NEXT_PUBLIC_SOCKET_URL=https://|g' $DEPLOY_DIR/.env"
remote_exec "sed -i 's|NEXT_PUBLIC_SITE_URL=http://|NEXT_PUBLIC_SITE_URL=https://|g' $DEPLOY_DIR/.env"

log_success "Environment variables updated"
log_info "Restarting containers to apply changes..."
remote_exec "cd $DEPLOY_DIR && docker compose restart frontend"
log_success "Frontend restarted"

# Step 7: Test automatic renewal
log_step "STEP 7: Testing Certificate Renewal"
log_info "Verifying automatic renewal configuration..."

if remote_exec "certbot renew --dry-run"; then
    log_success "Certificate renewal test passed"
    log_success "Certificates will auto-renew before expiration"
else
    log_warning "Certificate renewal test failed"
    log_warning "You may need to manually renew with: certbot renew"
fi

# Step 8: Verify HTTPS
log_step "STEP 8: Verifying HTTPS Configuration"

log_info "Testing HTTPS connection..."
sleep 3

if curl -sSf "https://$DOMAIN/api/health" > /dev/null 2>&1; then
    log_success "HTTPS is working correctly!"
else
    log_warning "HTTPS connection test failed (may need a few more seconds)"
fi

# Final summary
log_step "SSL SETUP COMPLETE!"

echo ""
log_success "TronRelic is now secured with HTTPS!"
echo ""
echo -e "${CYAN}Application URLs:${NC}"
echo "  Frontend:     https://$DOMAIN/"
echo "  Backend API:  https://$DOMAIN/api"
echo "  System:       https://$DOMAIN/system"
echo ""
echo -e "${CYAN}SSL Certificate Info:${NC}"
remote_exec "certbot certificates | grep -A 5 '$DOMAIN'"
echo ""
echo -e "${CYAN}Security Features:${NC}"
echo "  ✓ TLS 1.2/1.3 encryption"
echo "  ✓ HTTP Strict Transport Security (HSTS)"
echo "  ✓ Automatic HTTP → HTTPS redirect"
echo "  ✓ OCSP Stapling"
echo "  ✓ Security headers enabled"
echo "  ✓ Automatic certificate renewal"
echo ""
echo -e "${CYAN}Certificate Management:${NC}"
echo "  Renewal check:   certbot renew --dry-run"
echo "  Force renewal:   certbot renew --force-renewal"
echo "  Certificate info: certbot certificates"
echo ""
echo -e "${CYAN}Next Steps:${NC}"
echo "  1. Visit https://$DOMAIN/ to verify HTTPS"
echo "  2. Check for SSL issues at https://www.ssllabs.com/ssltest/"
echo "  3. (Optional) Add www subdomain: certbot --nginx -d $DOMAIN -d www.$DOMAIN"
echo ""
log_success "SSL setup completed successfully!"
