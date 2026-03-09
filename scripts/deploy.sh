#!/usr/bin/env bash
# ============================================================================
# Zarklink — Contract Deployment Script (wrapper)
# ============================================================================
# Compiles Cairo contracts with Scarb and deploys them to the local
# Starknet devnet via scripts/deploy.ts (starknet.js).
# Saves deployed addresses to .devnet/deployments.json.
#
# Usage:
#   ./scripts/deploy.sh            # Build + deploy all contracts
#   ./scripts/deploy.sh build      # Build only (scarb build)
#   ./scripts/deploy.sh deploy     # Deploy only (assumes already built)
# ============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_DIR="${PROJECT_ROOT}/contracts"
RELAYER_DIR="${PROJECT_ROOT}/relayer"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_error()   { echo -e "${RED}[ERR]${NC}   $*"; }
log_header()  { echo -e "\n${BOLD}${BLUE}═══ $* ═══${NC}\n"; }

# Detect package manager (pnpm if lockfile exists, else npm)
detect_pkg_manager() {
  if [ -f "${PROJECT_ROOT}/pnpm-lock.yaml" ] && command -v pnpm &>/dev/null; then
    echo "pnpm"
  else
    echo "npm"
  fi
}

build_contracts() {
  log_header "Building Cairo Contracts"
  cd "${CONTRACTS_DIR}"
  scarb build
  log_success "Contracts compiled successfully"
  cd "${PROJECT_ROOT}"
}

deploy_contracts() {
  log_header "Deploying Contracts via starknet.js"

  local pm
  pm=$(detect_pkg_manager)

  # Use tsx from the relayer package (or global npx/pnpm exec)
  local tsx_bin=""
  if [ -x "${RELAYER_DIR}/node_modules/.bin/tsx" ]; then
    tsx_bin="${RELAYER_DIR}/node_modules/.bin/tsx"
  elif [ "$pm" = "pnpm" ]; then
    tsx_bin="pnpm exec tsx"
  else
    tsx_bin="npx tsx"
  fi

  # Load env if it exists
  if [ -f "${PROJECT_ROOT}/.env.devnet" ]; then
    set -a
    source "${PROJECT_ROOT}/.env.devnet"
    set +a
  fi

  # Ensure starknet.js can be resolved from relayer's node_modules
  export NODE_PATH="${RELAYER_DIR}/node_modules"

  ${tsx_bin} "${PROJECT_ROOT}/scripts/deploy.ts" "$@"
}

case "${1:-all}" in
  build)    build_contracts ;;
  deploy)   shift; deploy_contracts "$@" ;;
  all)      build_contracts; deploy_contracts ;;
  *)
    echo "Usage: $0 {build|deploy|all}"
    echo "  build    Compile Cairo contracts with scarb"
    echo "  deploy   Deploy to devnet (assumes already built)"
    echo "  all      Build + deploy (default)"
    exit 1
    ;;
esac
