#!/usr/bin/env bash
set -euo pipefail

# ViziQuer install script — sets up prerequisites and installs dependencies.
# Idempotent: safe to run multiple times.
# Supports: macOS (MacPorts, Homebrew) and Linux (apt, dnf, pacman).
#
# Usage:
#   ./install.sh           # full install
#   ./install.sh --mcp      # MCP client setup (after app is running)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { printf "${GREEN}[INFO]${NC}  %s\n" "$*"; }
warn()  { printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
error() { printf "${RED}[ERROR]${NC} %s\n" "$*"; }

VIZIQUER_PORT="${VIZIQUER_PORT:-3000}"
API_KEY="${VIZIQUER_API_KEY:-}"

mcp_setup() {
  echo "======================================"
  echo " ViziQuer MCP Client Setup"
  echo "======================================"
  echo ""

  # Check if ViziQuer is running
  if ! curl -sf "http://localhost:${VIZIQUER_PORT}/api/v1/health" >/dev/null 2>&1; then
    warn "ViziQuer does not appear to be running on port ${VIZIQUER_PORT}."
    warn "Start it first with: cd app && meteor run"
    echo ""
    info "Run './install.sh' first if prerequisites are not installed."
    exit 1
  fi
  info "ViziQuer is running on port ${VIZIQUER_PORT}."

  echo ""
  echo "=== Step 1: Get an API Key ==="
  echo ""

  if [ -n "${API_KEY}" ]; then
    info "Using VIZIQUER_API_KEY from environment."
  else
    warn "No VIZIQUER_API_KEY set."
    echo ""
    echo "  Generate one in your browser's JavaScript console while logged into ViziQuer:"
    echo ""
    echo "    Meteor.call('generateApiKey', { projectId: 'YOUR_PROJECT_ID', label: 'MCP' },"
    echo "      (err, key) => console.log(err || 'Key: ' + key))"
    echo ""
    info "Then re-run with: VIZIQUER_API_KEY=vq_xxx $0 --mcp"
  fi

  echo ""
  echo "=== Step 2: Test with curl ==="
  echo ""
  echo "  curl -s -X POST http://localhost:${VIZIQUER_PORT}/api/mcp \\"
  echo "    -H 'Authorization: Bearer vq_YOUR_KEY' \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d '{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}' | jq ."

  echo ""
  echo "=== Step 3: MCP Client Configuration ==="
  echo ""
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROXY="${SCRIPT_DIR}/mcp-proxy.js"

  if [ -f "${PROXY}" ]; then
    echo "  Stdio proxy available at: ${PROXY}"
    echo ""
    echo "  Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json):"
    echo ""
    echo '  {'
    echo '    "mcpServers": {'
    echo '      "viziquer": {'
    echo '        "command": "node",'
    echo "        \"args\": [\"${PROXY}\", \"--url=http://localhost:${VIZIQUER_PORT}\"],"
    echo '        "env": {'
    echo '          "VIZIQUER_API_KEY": "vq_YOUR_API_KEY"'
    echo '        }'
    echo '      }'
    echo '    }'
    echo '  }'
    echo ""
    echo "  Cursor config (~/.cursor/mcp.json):"
    echo ""
    echo '  {'
    echo '    "mcpServers": {'
    echo '      "viziquer": {'
    echo '        "command": "node",'
    echo "        \"args\": [\"${PROXY}\", \"--url=http://localhost:${VIZIQUER_PORT}\"],"
    echo '        "env": {'
    echo '          "VIZIQUER_API_KEY": "vq_YOUR_API_KEY"'
    echo '        }'
    echo '      }'
    echo '    }'
    echo '  }'
  fi

  echo ""
  echo "=== Available MCP Tools ==="
  echo ""
  echo "  sparql_execute  — Execute SPARQL queries"
  echo "  list_diagrams   — List diagrams in a project"
  echo "  get_diagram     — Get diagram details with elements"
  echo "======================================"
}

require_npm() {
  # The Meteor installer also installs its own Node/npm, but we want a system
  # Node.js v22 for IDE tooling and general use.
  if command -v node >/dev/null 2>&1; then
    local nodever
    nodever=$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)
    if [ "${nodever}" -ge 22 ] 2>/dev/null; then
      info "Node.js $(node --version) already installed."
      return 0
    fi
  fi
  warn "Node.js v22+ not found. Installing via detected package manager..."

  if [ "$(uname -s)" = "Darwin" ]; then
    if command -v port >/dev/null 2>&1; then
      info "Using MacPorts..."
      sudo port install nodejs22
      sudo port select --set nodejs nodejs22 2>/dev/null || true
    elif command -v brew >/dev/null 2>&1; then
      info "Using Homebrew..."
      brew install node@22
    else
      error "No supported package manager found on macOS (install MacPorts or Homebrew first)."
      exit 1
    fi
  elif [ "$(uname -s)" = "Linux" ]; then
    if command -v apt-get >/dev/null 2>&1; then
      info "Using apt (Debian/Ubuntu)..."
      curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v dnf >/dev/null 2>&1; then
      info "Using dnf (Fedora/RHEL)..."
      curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
      sudo dnf install -y nodejs
    elif command -v pacman >/dev/null 2>&1; then
      info "Using pacman (Arch)..."
      sudo pacman -S --noconfirm nodejs
    else
      error "No supported package manager found on Linux."
      exit 1
    fi
  fi

  info "Node.js $(node --version) installed."
}

require_meteor() {
  if command -v meteor >/dev/null 2>&1; then
    info "Meteor $(meteor --version 2>/dev/null | head -1) already installed."
    return 0
  fi

  warn "Meteor not found. Installing..."
  # The meteor installer uses /usr/local/bin which may need sudo on macOS
  if [ "$(uname -s)" = "Darwin" ]; then
    curl https://install.meteor.com/ | sh
  else
    curl https://install.meteor.com/ | sh
  fi

  # Ensure ~/.meteor is on PATH for this session
  if [ -d "$HOME/.meteor" ]; then
    export PATH="$HOME/.meteor:$PATH"
  fi

  if command -v meteor >/dev/null 2>&1; then
    info "Meteor $(meteor --version 2>/dev/null | head -1) installed."
  else
    warn "Meteor installed but not on PATH. Add this to your shell config (~/.zshrc or ~/.bash_profile):"
    warn '  export PATH="$HOME/.meteor:$PATH"'
  fi
}

add_meteor_to_path() {
  local shell_config=""
  for f in "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.bashrc" "$HOME/.profile"; do
    if [ -f "$f" ]; then
      shell_config="$f"
      break
    fi
  done

  if [ -n "$shell_config" ]; then
    if ! grep -q '$HOME/.meteor' "$shell_config" 2>/dev/null; then
      echo '' >> "$shell_config"
      echo '# ViziQuer: Meteor PATH' >> "$shell_config"
      echo 'export PATH="$HOME/.meteor:$PATH"' >> "$shell_config"
      info "Added Meteor to PATH in ${shell_config}."
    else
      info "Meteor PATH already configured in ${shell_config}."
    fi
  else
    warn "No shell config found. Add this line manually:"
    warn '  export PATH="$HOME/.meteor:$PATH"'
  fi
}

install_deps() {
  info "Installing npm dependencies (meteor npm ci)..."
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "${SCRIPT_DIR}/app"
  meteor npm ci
  info "Dependencies installed."
}

main() {
  if [ "${1:-}" = "--mcp" ]; then
    mcp_setup
    return
  fi

  echo "======================================"
  echo " ViziQuer Install Script"
  echo "======================================"
  echo ""

  require_npm
  require_meteor
  add_meteor_to_path
  install_deps

  echo ""
  echo "======================================"
  echo " Setup complete!"
  echo ""
  echo " To run ViziQuer:"
  echo "   cd app && meteor run"
  echo ""
  echo " Then open: http://localhost:3000"
  echo ""
  echo " For MCP client setup:"
  echo "   ./install.sh --mcp"
  echo "======================================"
}

main "$@"
