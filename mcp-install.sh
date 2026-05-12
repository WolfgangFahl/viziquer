#!/bin/bash
# ViziQuer MCP install — one command setup for opencode
# Checks ViziQuer is running, auto-generates API key, configures opencode.

set -euo pipefail

# Inline bash messaging — same style as bash_messages, no external deps
blue='\033[0;34m'
red='\033[0;31m'
green='\033[0;32m'
yellow='\033[1;33m'
endColor='\033[0m'
action()  { echo -e "${blue}➜ $1${endColor}"; }
success() { echo -e "${green}✓ $1${endColor}"; }
warn()    { echo -e "${yellow}⚠ $1${endColor}"; }
error()   { echo -e "${red}✗ Error: $1${endColor}" 1>&2; exit 1; }

VIZIQUER_URL="${VIZIQUER_URL:-http://localhost:3000}"
CONFIG_DIR="$HOME/.config/opencode"
CONFIG_FILE="$CONFIG_DIR/opencode.json"

action "=== ViziQuer MCP Setup ==="

# 1. Check ViziQuer is running
action "Checking ViziQuer at ${VIZIQUER_URL}..."
if curl -sf "${VIZIQUER_URL}/api/v1/health" >/dev/null 2>&1; then
  success "ViziQuer is running"
else
  error "ViziQuer is not reachable at ${VIZIQUER_URL}. Start with: cd app && meteor run"
fi

# 2. Auto-generate API key
action "Auto-generating API key..."
KEY=$(curl -sf -X POST "${VIZIQUER_URL}/api/v1/mcp-install")
if [ -z "$KEY" ]; then
  error "Failed to get API key from ${VIZIQUER_URL}/api/v1/mcp-install"
fi
API_KEY=$(echo "$KEY" | python3 -c "import sys,json; print(json.load(sys.stdin)['apiKey'])" 2>/dev/null || \
          echo "$KEY" | python -c "import sys,json; print(json.load(sys.stdin)['apiKey'])" 2>/dev/null)
if [ -z "$API_KEY" ] || [ "$API_KEY" = "null" ]; then
  error "Failed to parse API key from response: $KEY"
fi
success "API key generated: ${API_KEY:0:10}..."

# 3. Configure
if command -v jq >/dev/null 2>&1; then
  action "Configuring opencode..."
  mkdir -p "$CONFIG_DIR"

  if [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << 'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {}
}
EOF
  fi

  MCP_JSON=$(cat << ENDJSON
{
  "viziquer": {
    "type": "remote",
    "url": "${VIZIQUER_URL}/api/mcp",
    "headers": {
      "Authorization": "Bearer ${API_KEY}"
    },
    "enabled": true
  }
}
ENDJSON
)

  jq --arg mcp "$MCP_JSON" '.mcp += ($mcp | fromjson)' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && \
    mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE" || \
    error "Failed to merge MCP config"
  success "Added viziquer to ${CONFIG_FILE}"
else
  warn "jq not found — cannot auto-configure opencode."
fi

# 4. Show result
cat << EOF

=== ViziQuer MCP ready ===

API key: $API_KEY

Test with curl:
  curl -s -X POST ${VIZIQUER_URL}/api/mcp \\
    -H 'Authorization: Bearer ${API_KEY}' \\
    -H 'Content-Type: application/json' \\
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

Available MCP tools:
  sparql_execute  — Execute SPARQL queries
  list_diagrams   — List diagrams in a project
  get_diagram     — Get diagram details with elements

EOF

if command -v jq >/dev/null 2>&1; then
  echo "Restart opencode to use: opencode"
fi
