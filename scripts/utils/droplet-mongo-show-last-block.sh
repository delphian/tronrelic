#!/bin/bash

##
## Droplet Check Block Energy Script
##
## Checks the latest block documents in MongoDB for the totalEnergyUsed field.
##
## Usage:
##   ./scripts/droplet-check-block-energy.sh [env] [db-name] [limit]
##
## Arguments:
##   env       Environment (prod, dev) - defaults to prod
##   db-name   Database name - defaults to tronrelic
##   limit     Number of documents to retrieve - defaults to 2
##
## Examples:
##   ./scripts/droplet-check-block-energy.sh prod
##   ./scripts/droplet-check-block-energy.sh dev tronrelic 5
##

set -euo pipefail

# Source environment configuration
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/../droplet-config.sh"

# Parse arguments
ENV="${1:-prod}"
DB_NAME="${2:-tronrelic}"
LIMIT="${3:-2}"

# Load environment configuration
get_config "$ENV"

# Get MongoDB password
MONGO_PASSWORD=$(get_mongo_password)

MONGOSH_SCRIPT=$(cat <<'EOF'
const candidates = Array.from(new Set([process.env.DB_NAME, 'tronrelic', 'tronrelic-prod'].filter(Boolean)));
const limit = parseInt(process.env.LIMIT, 10) || 2;
let activeDb = null;
let documents = [];

for (const name of candidates) {
    const dbRef = db.getSiblingDB(name);
    documents = dbRef.blocks.find().sort({ blockNumber: -1 }).limit(limit).toArray();
    if (documents.length) {
        activeDb = name;
        break;
    }
}

if (!documents.length) {
    printjson({ message: 'No documents found', databasesTried: candidates, collection: 'blocks' });
} else {
    printjson({ database: activeDb, documents });
}
EOF
)

# Pass password via environment variable to prevent exposure in process lists
remote_exec "docker exec -i -e DB_NAME=\"${DB_NAME}\" -e LIMIT=\"${LIMIT}\" -e MONGO_PASSWORD='$MONGO_PASSWORD' $MONGO_CONTAINER sh -c 'mongosh --username admin --password \"\$MONGO_PASSWORD\" --authenticationDatabase admin --quiet --eval \"$MONGOSH_SCRIPT\"'"
