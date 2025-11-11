#!/bin/bash

###############################################################################
# Cloudflare DNS A Record Deletion Script
#
# Purpose:
#   Deletes an A record from Cloudflare DNS for PR environment cleanup.
#   Used by GitHub Actions when PRs are closed or merged to remove DNS entries.
#
# Why this matters:
#   - Prevents DNS record accumulation
#   - Keeps DNS zone clean and manageable
#   - Allows subdomain reuse for future PRs with same number
#
# Usage:
#   ./cloudflare-dns-delete.sh <subdomain>
#
# Example:
#   ./cloudflare-dns-delete.sh pr-42
#   # Deletes: pr-42.dev-pr.tronrelic.com
#
# Required Environment Variables:
#   CLOUDFLARE_API_TOKEN - API token with DNS edit permissions
#   CLOUDFLARE_ZONE_ID - Zone ID for tronrelic.com domain
#
# Exit Codes:
#   0 - Success (record deleted or did not exist)
#   1 - Invalid arguments
#   2 - Missing environment variables
#   3 - Cloudflare API error
###############################################################################

set -euo pipefail

# Configuration
BASE_DOMAIN="dev-pr.tronrelic.com"
CLOUDFLARE_API_URL="https://api.cloudflare.com/client/v4"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Validate arguments
if [ $# -ne 1 ]; then
    error "Invalid number of arguments"
    echo "Usage: $0 <subdomain>" >&2
    echo "Example: $0 pr-42" >&2
    exit 1
fi

SUBDOMAIN="$1"
FULL_DOMAIN="${SUBDOMAIN}.${BASE_DOMAIN}"

# Validate environment variables
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    error "CLOUDFLARE_API_TOKEN environment variable is not set"
    exit 2
fi

if [ -z "${CLOUDFLARE_ZONE_ID:-}" ]; then
    error "CLOUDFLARE_ZONE_ID environment variable is not set"
    exit 2
fi

info "Deleting DNS A record: ${FULL_DOMAIN}"

# Find existing record
info "Searching for DNS record..."
EXISTING_RECORD=$(curl -s -X GET \
    "${CLOUDFLARE_API_URL}/zones/${CLOUDFLARE_ZONE_ID}/dns_records?type=A&name=${FULL_DOMAIN}" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json")

# Check if API request was successful
if ! echo "$EXISTING_RECORD" | jq -e '.success' > /dev/null 2>&1; then
    error "Failed to query Cloudflare API"
    echo "$EXISTING_RECORD" | jq '.' >&2
    exit 3
fi

RECORD_COUNT=$(echo "$EXISTING_RECORD" | jq -r '.result | length')

if [ "$RECORD_COUNT" -eq 0 ]; then
    info "DNS record does not exist: ${FULL_DOMAIN}"
    success "Nothing to delete"
    exit 0
fi

# Delete each matching record (should only be one, but handle multiple)
echo "$EXISTING_RECORD" | jq -r '.result[].id' | while read -r RECORD_ID; do
    info "Deleting record ID: ${RECORD_ID}"
    
    DELETE_RESPONSE=$(curl -s -X DELETE \
        "${CLOUDFLARE_API_URL}/zones/${CLOUDFLARE_ZONE_ID}/dns_records/${RECORD_ID}" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
        -H "Content-Type: application/json")
    
    if echo "$DELETE_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        success "DNS record deleted: ${FULL_DOMAIN}"
    else
        error "Failed to delete DNS record ${RECORD_ID}"
        echo "$DELETE_RESPONSE" | jq '.' >&2
        exit 3
    fi
done

success "DNS cleanup completed for ${FULL_DOMAIN}"
exit 0
