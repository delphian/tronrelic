#!/bin/bash

##
## Droplet MongoDB Statistics Script
##
## Connects to remote MongoDB Docker instance and lists all collections
## and their sizes for all databases.
##
## Usage:
##   ./scripts/droplet-stats-mongo.sh [env]
##
## Arguments:
##   env    Environment (prod, dev) - defaults to prod
##
## Examples:
##   ./scripts/droplet-stats-mongo.sh prod
##   ./scripts/droplet-stats-mongo.sh dev
##

set -euo pipefail

# Source environment configuration
SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/../droplet-config.sh"

# Parse arguments
ENV="${1:-prod}"

# Load environment configuration
get_config "$ENV"

# Get MongoDB password
MONGO_PASSWORD=$(get_mongo_password)

# Execute MongoDB statistics query
# Pass password via environment variable to prevent exposure in process lists
remote_exec "docker exec -i -e MONGO_PASSWORD='$MONGO_PASSWORD' $MONGO_CONTAINER sh -c 'mongosh \
    --username admin \
    --password \"\$MONGO_PASSWORD\" \
    --authenticationDatabase admin \
    --quiet \
    --eval \"db.getMongo().getDBNames().forEach(function(dbName){db=db.getSiblingDB(dbName);db.getCollectionNames().forEach(function(c){s=db.getCollection(c).stats();print(dbName+\\\".\\\"+c+\\\": \\\"+s.size+\\\" bytes (\\\"+s.count+\\\" docs)\\\");})})\"'"
