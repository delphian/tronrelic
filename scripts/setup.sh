#!/usr/bin/env bash
#
# setup.sh - Clone and configure TronRelic plugins
#
# Usage: ./scripts/setup.sh [OPTIONS]
#
# Options:
#   --dev         Clone all plugins in developer mode (full history, push enabled)
#   --consumer    Clone all plugins in consumer mode (shallow, read-only)
#   --force, -f   Remove existing plugins before cloning
#
# Without --dev or --consumer, uses the "mode" field from plugins.json (defaults to consumer)
#
# Reads plugins.json and clones enabled plugins into src/plugins/
# Requires: git, jq (or node for JSON parsing)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PLUGINS_DIR="$PROJECT_ROOT/src/plugins"
CONFIG_FILE="$PROJECT_ROOT/plugins.json"
FORCE=false
MODE_OVERRIDE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --force|-f) FORCE=true; shift ;;
        --dev) MODE_OVERRIDE="developer"; shift ;;
        --consumer) MODE_OVERRIDE="consumer"; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_mode() { echo -e "${BLUE}[MODE]${NC} $1"; }

if [[ ! -f "$CONFIG_FILE" ]]; then
    log_error "plugins.json not found at $CONFIG_FILE"
    echo ""
    echo "To get started:"
    echo "  cp plugins.json.example plugins.json"
    echo "  ./scripts/setup.sh"
    exit 1
fi

if command -v jq &> /dev/null; then
    JSON_PARSER="jq"
elif command -v node &> /dev/null; then
    JSON_PARSER="node"
else
    log_error "Neither jq nor node found. Install one to parse plugins.json"
    exit 1
fi

log_info "Checking git SSH access..."
if ssh -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
    log_info "GitHub SSH authentication confirmed"
else
    log_warn "GitHub SSH authentication could not be verified"
    log_warn "Private repository clones may fail"
fi

mkdir -p "$PLUGINS_DIR"

if [[ "$JSON_PARSER" == "jq" ]]; then
    PLUGINS=$(jq -r '.plugins | to_entries[] | select(.value.enabled == true) | .key' "$CONFIG_FILE")
else
    PLUGINS=$(node -e "
        const c = require('$CONFIG_FILE');
        Object.entries(c.plugins)
            .filter(([_, v]) => v.enabled)
            .forEach(([k]) => console.log(k));
    ")
fi

if [[ -z "$PLUGINS" ]]; then
    log_warn "No plugins enabled in plugins.json"
    exit 0
fi

# Clone a plugin in consumer mode (shallow, single-branch)
clone_consumer() {
    local repo="$1" ref="$2" target="$3"
    git clone --branch "$ref" --single-branch --depth 1 "$repo" "$target" 2>&1 || return 1
}

# Clone a plugin in developer mode (full history, all branches)
clone_developer() {
    local repo="$1" ref="$2" target="$3"
    git clone "$repo" "$target" 2>&1 || return 1
    git -C "$target" checkout "$ref" 2>&1 || true
}

# Update an existing plugin
update_plugin() {
    local target="$1" ref="$2"
    git -C "$target" fetch origin 2>&1
    git -C "$target" checkout "$ref" 2>&1 || true
    git -C "$target" pull origin "$ref" 2>&1 || true
}

FAILED=()
CLONED=()

for plugin in $PLUGINS; do
    if [[ "$JSON_PARSER" == "jq" ]]; then
        repo=$(jq -r ".plugins[\"$plugin\"].repo" "$CONFIG_FILE")
        ref=$(jq -r ".plugins[\"$plugin\"].ref // \"main\"" "$CONFIG_FILE")
        plugin_mode=$(jq -r ".plugins[\"$plugin\"].mode // \"consumer\"" "$CONFIG_FILE")
    else
        repo=$(node -e "console.log(require('$CONFIG_FILE').plugins['$plugin'].repo)")
        ref=$(node -e "console.log(require('$CONFIG_FILE').plugins['$plugin'].ref || 'main')")
        plugin_mode=$(node -e "console.log(require('$CONFIG_FILE').plugins['$plugin'].mode || 'consumer')")
    fi

    # CLI override takes precedence over per-plugin config
    if [[ -n "$MODE_OVERRIDE" ]]; then
        mode="$MODE_OVERRIDE"
    else
        mode="$plugin_mode"
    fi

    target="$PLUGINS_DIR/$plugin"

    # Check if this is a built-in plugin (should not be cloned/overwritten)
    if [[ -d "$target" && -f "$target/package.json" ]]; then
        if [[ "$JSON_PARSER" == "jq" ]]; then
            is_builtin=$(jq -r '.tronrelic.builtin // false' "$target/package.json")
        else
            is_builtin=$(node -e "console.log(require('$target/package.json').tronrelic?.builtin || false)")
        fi

        if [[ "$is_builtin" == "true" ]]; then
            log_info "Skipping $plugin (built-in plugin)"
            continue
        fi
    fi

    if [[ -d "$target" ]]; then
        if [[ "$FORCE" == true ]]; then
            log_info "Removing existing $plugin (--force)"
            rm -rf "$target"
        else
            log_info "Updating $plugin..."
            if update_plugin "$target" "$ref"; then
                log_info "Updated $plugin to $ref"
                CLONED+=("$target")
                continue
            else
                log_warn "Failed to update $plugin, re-cloning"
                rm -rf "$target"
            fi
        fi
    fi

    log_mode "Cloning $plugin in $mode mode (ref: $ref)"

    if [[ "$mode" == "developer" ]]; then
        if clone_developer "$repo" "$ref" "$target"; then
            log_info "Successfully cloned $plugin (developer mode - full history)"
            CLONED+=("$target")
        else
            log_error "Failed to clone $plugin from $repo"
            FAILED+=("$plugin")
        fi
    else
        if clone_consumer "$repo" "$ref" "$target"; then
            log_info "Successfully cloned $plugin (consumer mode - shallow)"
            CLONED+=("$target")
        else
            log_error "Failed to clone $plugin from $repo"
            FAILED+=("$plugin")
        fi
    fi
done

echo ""
if [[ ${#FAILED[@]} -gt 0 ]]; then
    log_error "Failed to clone: ${FAILED[*]}"
    exit 1
fi

# Install dependencies for each cloned plugin
log_info "Installing plugin dependencies..."
INSTALL_FAILED=()

for target in "${CLONED[@]}"; do
    plugin_name=$(basename "$target")
    if [[ -f "$target/package.json" ]]; then
        log_info "Installing dependencies for $plugin_name..."
        if (cd "$target" && npm install --silent); then
            log_info "Dependencies installed for $plugin_name"
        else
            log_error "Failed to install dependencies for $plugin_name"
            INSTALL_FAILED+=("$plugin_name")
        fi
    else
        log_warn "No package.json found in $plugin_name, skipping npm install"
    fi
done

echo ""
if [[ ${#INSTALL_FAILED[@]} -gt 0 ]]; then
    log_error "Failed to install dependencies: ${INSTALL_FAILED[*]}"
    exit 1
else
    log_info "All plugins configured successfully"
    log_info "Run 'npm install' in the project root to install core dependencies"
fi
