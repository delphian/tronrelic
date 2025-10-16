#!/bin/bash

##
## Droplet List MongoDB Collections Script
##
## Lists all collections in the TronRelic database on the droplet's MongoDB instance.
##
## Usage:
##   ./scripts/droplet-list-mongo-collections.sh [env] [db-name]
##
## Arguments:
##   env       Environment (prod, dev) - defaults to prod
##   db-name   Database name - defaults to tronrelic-prod for prod, tronrelic for dev
##
## Examples:
##   ./scripts/droplet-list-mongo-collections.sh prod
##   ./scripts/droplet-list-mongo-collections.sh dev
##   ./scripts/droplet-list-mongo-collections.sh prod tronrelic
##

set -euo pipefail

# Source environment configuration
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/droplet-config.sh"

# Parse arguments
ENV="${1:-prod}"

# Load environment configuration
get_config "$ENV"

# Determine default database name based on environment
if [[ "$ENV" == "prod" ]]; then
    DEFAULT_DB="tronrelic-prod"
else
    DEFAULT_DB="tronrelic"
fi

DB_NAME="${2:-$DEFAULT_DB}"

# Get MongoDB password
MONGO_PASSWORD=$(get_mongo_password)

# List collections
remote_exec "docker exec -i $MONGO_CONTAINER mongosh \
    --username admin \
    --password '$MONGO_PASSWORD' \
    --authenticationDatabase admin \
    --quiet \
    --eval 'db.getCollectionNames()' \
    $DB_NAME"
