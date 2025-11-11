#!/bin/bash

###############################################################################
# Wildcard SSL Certificate Generation Script
#
# Purpose:
#   Generates a wildcard SSL certificate for *.dev-pr.tronrelic.com using
#   Let's Encrypt with DNS-01 challenge via Cloudflare. This single certificate
#   works for all PR environments simultaneously.
#
# Why this matters:
#   - Single certificate covers unlimited PR subdomains
#   - Avoids Let's Encrypt rate limit of 50 certs/week per domain
#   - No per-PR certificate generation delays
#   - Certificate can be distributed to all PR droplets
#
# Usage:
#   ./cloudflare-wildcard-ssl.sh <email>
#
# Example:
#   ./cloudflare-wildcard-ssl.sh admin@tronrelic.com
#
# Required Environment Variables:
#   CLOUDFLARE_API_TOKEN - API token with DNS edit permissions
#
# Output:
#   - Certificate: /etc/letsencrypt/live/dev-pr.tronrelic.com/fullchain.pem
#   - Private Key: /etc/letsencrypt/live/dev-pr.tronrelic.com/privkey.pem
#
# Certificate Renewal:
#   Let's Encrypt certificates are valid for 90 days. Run this script again
#   or use certbot renew to renew the certificate before expiration.
#
# Exit Codes:
#   0 - Success (certificate generated or renewed)
#   1 - Invalid arguments
#   2 - Missing dependencies
#   3 - Certificate generation failed
###############################################################################

set -euo pipefail

# Configuration
DOMAIN="dev-pr.tronrelic.com"
WILDCARD_DOMAIN="*.${DOMAIN}"
CERT_PATH="/etc/letsencrypt/live/${DOMAIN}"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions for colored output
error() {
    echo -e "${RED}❌ Error: $1${NC}" >&2
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

note() {
    echo -e "${BLUE}📝 Note: $1${NC}"
}

# Validate arguments
if [ $# -ne 1 ]; then
    error "Invalid number of arguments"
    echo "Usage: $0 <email>" >&2
    echo "Example: $0 admin@tronrelic.com" >&2
    exit 1
fi

EMAIL="$1"

# Validate email format (basic check)
if ! echo "$EMAIL" | grep -qE '^[^@]+@[^@]+\.[^@]+$'; then
    error "Invalid email format: $EMAIL"
    exit 1
fi

# Validate environment variables
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    error "CLOUDFLARE_API_TOKEN environment variable is not set"
    exit 2
fi

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    error "This script must be run as root (certificate files are stored in /etc/letsencrypt)"
    exit 2
fi

info "Generating wildcard SSL certificate for ${WILDCARD_DOMAIN}"

# Check for required dependencies
info "Checking dependencies..."
MISSING_DEPS=()

if ! command -v certbot &> /dev/null; then
    MISSING_DEPS+=("certbot")
fi

if ! command -v python3 &> /dev/null; then
    MISSING_DEPS+=("python3")
fi

if ! python3 -c "import certbot_dns_cloudflare" 2>/dev/null; then
    MISSING_DEPS+=("python3-certbot-dns-cloudflare")
fi

if [ ${#MISSING_DEPS[@]} -gt 0 ]; then
    error "Missing required dependencies: ${MISSING_DEPS[*]}"
    info "Installing dependencies..."
    
    apt-get update
    apt-get install -y certbot python3-certbot-dns-cloudflare
    
    success "Dependencies installed"
fi

# Create Cloudflare credentials file for certbot
CLOUDFLARE_CREDS_FILE="/root/.secrets/cloudflare.ini"
mkdir -p "$(dirname "$CLOUDFLARE_CREDS_FILE")"

cat > "$CLOUDFLARE_CREDS_FILE" <<EOF
# Cloudflare API token used by Certbot
dns_cloudflare_api_token = ${CLOUDFLARE_API_TOKEN}
EOF

chmod 600 "$CLOUDFLARE_CREDS_FILE"
success "Cloudflare credentials file created"

# Check if certificate already exists
if [ -f "${CERT_PATH}/fullchain.pem" ]; then
    info "Existing certificate found, checking expiration..."
    
    EXPIRY_DATE=$(openssl x509 -enddate -noout -in "${CERT_PATH}/fullchain.pem" | cut -d= -f2)
    EXPIRY_EPOCH=$(date -d "$EXPIRY_DATE" +%s)
    NOW_EPOCH=$(date +%s)
    DAYS_UNTIL_EXPIRY=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
    
    if [ $DAYS_UNTIL_EXPIRY -gt 30 ]; then
        success "Certificate is valid for ${DAYS_UNTIL_EXPIRY} more days"
        note "Certificate will auto-renew when less than 30 days remain"
        note "Certificate path: ${CERT_PATH}"
        note "To force renewal now, run: certbot renew --force-renewal"
        exit 0
    else
        info "Certificate expires in ${DAYS_UNTIL_EXPIRY} days, renewing..."
    fi
fi

# Generate or renew wildcard certificate using DNS-01 challenge
info "Requesting certificate from Let's Encrypt via DNS-01 challenge..."
info "This may take 1-2 minutes for DNS propagation..."

certbot certonly \
    --dns-cloudflare \
    --dns-cloudflare-credentials "$CLOUDFLARE_CREDS_FILE" \
    --dns-cloudflare-propagation-seconds 30 \
    -d "${WILDCARD_DOMAIN}" \
    -d "${DOMAIN}" \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --preferred-challenges dns-01

# Check if certificate generation was successful
if [ ! -f "${CERT_PATH}/fullchain.pem" ]; then
    error "Certificate generation failed - certificate file not found"
    exit 3
fi

success "Wildcard SSL certificate generated successfully!"
echo ""
echo "📜 Certificate Details:"
echo "   Domain: ${WILDCARD_DOMAIN}"
echo "   Certificate: ${CERT_PATH}/fullchain.pem"
echo "   Private Key: ${CERT_PATH}/privkey.pem"
echo "   Valid for: 90 days"
echo ""
note "This certificate can be used by all PR environments"
note "Certificate will auto-renew via certbot when < 30 days remain"
echo ""
echo "🔄 To manually renew before expiration:"
echo "   certbot renew --cert-name ${DOMAIN}"
echo ""
echo "📋 To deploy to PR droplets, copy these files:"
echo "   - ${CERT_PATH}/fullchain.pem"
echo "   - ${CERT_PATH}/privkey.pem"
echo ""

exit 0
