#!/usr/bin/env bash
# ============================================================================
# Zarklink — Dependency Installer
# ============================================================================
# Checks and installs all required dependencies for the Zarklink project.
# For npm packages, prompts the user to choose between pnpm and npm.
#
# Usage:
#   ./scripts/install-deps.sh          # Interactive install
#   ./scripts/install-deps.sh --pnpm   # Use pnpm (no prompt)
#   ./scripts/install-deps.sh --npm    # Use npm (no prompt)
# ============================================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

log_info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERR]${NC}   $*"; }
log_header()  { echo -e "\n${BOLD}${BLUE}═══ $* ═══${NC}\n"; }

MISSING=()
OPTIONAL_MISSING=()

# ---------------------------------------------------------------------------
# Check System Dependencies
# ---------------------------------------------------------------------------
check_required() {
  local name="$1"
  local install_hint="$2"
  local version_flag="${3:---version}"

  if command -v "$name" &>/dev/null; then
    local ver
    ver=$($name $version_flag 2>&1 | head -1)
    log_success "$name: $ver"
  else
    log_error "$name: NOT FOUND"
    log_info "  Install: $install_hint"
    MISSING+=("$name")
  fi
}

check_optional() {
  local name="$1"
  local install_hint="$2"
  local version_flag="${3:---version}"

  if command -v "$name" &>/dev/null; then
    local ver
    ver=$($name $version_flag 2>&1 | head -1)
    log_success "$name: $ver"
  else
    log_warn "$name: NOT FOUND (optional)"
    log_info "  Install: $install_hint"
    OPTIONAL_MISSING+=("$name")
  fi
}

check_system_deps() {
  log_header "System Dependencies"

  # Core
  check_required "node" "https://nodejs.org/ or: nvm install 22"
  check_required "python3" "apt install python3 / brew install python3"
  check_required "curl" "apt install curl / brew install curl"
  check_required "git" "apt install git / brew install git"

  # Blockchain
  check_required "scarb" "https://docs.swmansion.com/scarb/download.html"
  check_required "starknet-devnet" "cargo install starknet-devnet"
  check_required "zcashd" "https://zcash.readthedocs.io/en/latest/rtd_pages/install_binary_tarball.html"
  check_required "zcash-cli" "Comes with zcashd installation"

  # Package managers
  check_required "npm" "Comes with Node.js"
  check_optional "pnpm" "npm install -g pnpm"

  # Testing
  check_optional "snforge" "https://foundry-rs.github.io/starknet-foundry/getting-started/installation.html" "--version"

  echo ""
  if [ ${#MISSING[@]} -gt 0 ]; then
    log_error "Missing required dependencies: ${MISSING[*]}"
    log_info "Please install them before continuing."
    return 1
  fi

  if [ ${#OPTIONAL_MISSING[@]} -gt 0 ]; then
    log_warn "Missing optional: ${OPTIONAL_MISSING[*]} (some features may be unavailable)"
  fi

  log_success "All required system dependencies present"
}

# ---------------------------------------------------------------------------
# Check Zcash Params
# ---------------------------------------------------------------------------
check_zcash_params() {
  log_header "Zcash Proving Parameters"

  local params_dir="${HOME}/.zcash-params"

  if [ -d "$params_dir" ]; then
    local count
    count=$(ls -1 "$params_dir" 2>/dev/null | wc -l)
    if [ "$count" -gt 0 ]; then
      log_success "Zcash params found in $params_dir ($count files)"
    else
      log_warn "Zcash params directory exists but is empty"
      log_info "  Run: zcash-fetch-params"
    fi
  else
    log_warn "Zcash params not found at $params_dir"
    log_info "  Sapling/Orchard params are bundled with zcashd v6+"
    log_info "  Creating directory..."
    mkdir -p "$params_dir"
    log_success "Created $params_dir"
  fi
}

# ---------------------------------------------------------------------------
# Build Cairo Contracts
# ---------------------------------------------------------------------------
build_contracts() {
  log_header "Building Cairo Contracts"

  if [ ! -f "${PROJECT_ROOT}/contracts/Scarb.toml" ]; then
    log_error "contracts/Scarb.toml not found"
    return 1
  fi

  cd "${PROJECT_ROOT}/contracts"
  log_info "Running scarb build..."
  scarb build
  log_success "Cairo contracts compiled"

  # Check artifacts
  local artifacts="${PROJECT_ROOT}/contracts/target/dev"
  if [ -d "$artifacts" ]; then
    local count
    count=$(ls -1 "$artifacts"/*.json 2>/dev/null | wc -l)
    log_success "Found $count contract artifacts in target/dev/"
  fi

  cd "${PROJECT_ROOT}"
}

# ---------------------------------------------------------------------------
# Detect Package Manager
# ---------------------------------------------------------------------------
detect_pkg_manager() {
  # Check CLI arguments
  for arg in "$@"; do
    case "$arg" in
      --pnpm) echo "pnpm"; return 0 ;;
      --npm)  echo "npm";  return 0 ;;
    esac
  done

  # Check for existing lockfiles
  if [ -f "${PROJECT_ROOT}/pnpm-lock.yaml" ]; then
    echo "pnpm"
    return 0
  fi

  # Interactive prompt
  echo ""
  echo -e "${BOLD}Which package manager would you like to use for JavaScript dependencies?${NC}"
  echo ""
  echo "  1) pnpm  (recommended — fast, disk-efficient, workspace support)"
  echo "  2) npm   (default Node.js package manager)"
  echo ""

  local choice
  read -rp "  Choose [1/2] (default: 1): " choice
  case "${choice:-1}" in
    1|pnpm) echo "pnpm" ;;
    2|npm)  echo "npm"  ;;
    *)      echo "pnpm" ;;
  esac
}

# ---------------------------------------------------------------------------
# Install JavaScript Packages
# ---------------------------------------------------------------------------
install_js_packages() {
  local pkg_manager="$1"

  log_header "Installing JavaScript Packages (${pkg_manager})"

  cd "${PROJECT_ROOT}"

  if [ "$pkg_manager" = "pnpm" ]; then
    if ! command -v pnpm &>/dev/null; then
      log_info "pnpm not found. Installing globally..."
      npm install -g pnpm
    fi

    # Ensure workspace config exists
    if [ ! -f "${PROJECT_ROOT}/pnpm-workspace.yaml" ]; then
      log_info "Creating pnpm-workspace.yaml..."
      cat > "${PROJECT_ROOT}/pnpm-workspace.yaml" <<'EOF'
packages:
  - cli
  - frontend
  - relayer
  - vault-daemon
  - tests
EOF
    fi

    log_info "Running pnpm install..."
    pnpm install
    log_success "pnpm install complete"

  else
    # npm — install in each package directory
    local packages=("cli" "frontend" "relayer" "vault-daemon" "tests")
    for pkg in "${packages[@]}"; do
      local dir="${PROJECT_ROOT}/${pkg}"
      if [ -f "${dir}/package.json" ]; then
        log_info "Installing ${pkg}..."
        (cd "$dir" && npm install --silent)
        log_success "${pkg} installed"
      fi
    done
  fi
}

# ---------------------------------------------------------------------------
# Verify Installation
# ---------------------------------------------------------------------------
verify_installation() {
  log_header "Verifying Installation"

  local ok=true

  # Check key binaries in node_modules
  local checks=(
    "relayer/node_modules/.bin/tsx:tsx (TypeScript executor)"
    "frontend/node_modules/.bin/next:Next.js CLI"
  )

  for check in "${checks[@]}"; do
    local path="${PROJECT_ROOT}/${check%%:*}"
    local label="${check#*:}"
    if [ -f "$path" ] || [ -L "$path" ]; then
      log_success "$label"
    else
      log_error "$label not found at ${check%%:*}"
      ok=false
    fi
  done

  # Test frontend build (optional, quick check)
  if [ -d "${PROJECT_ROOT}/frontend/node_modules" ]; then
    log_info "Verifying frontend types..."
    if (cd "${PROJECT_ROOT}/frontend" && npx --yes next lint 2>/dev/null); then
      log_success "Frontend lint OK"
    else
      log_warn "Frontend lint had warnings (non-blocking)"
    fi
  fi

  if $ok; then
    log_success "All installations verified"
  else
    log_warn "Some verifications failed — check output above"
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
  local pkg_manager="$1"

  log_header "Installation Complete!"
  echo ""
  echo -e "  ${BOLD}Package Manager:${NC}   ${pkg_manager}"
  echo -e "  ${BOLD}Project Root:${NC}      ${PROJECT_ROOT}"
  echo ""
  echo -e "  ${CYAN}Next steps:${NC}"
  echo "    1. Start the devnet:     ./scripts/start-devnet.sh"
  echo "    2. Deploy contracts:     ./scripts/start-devnet.sh --deploy"
  echo "    3. Full stack:           ./scripts/start-devnet.sh --deploy --frontend"
  echo ""
  echo -e "  ${CYAN}Quick commands:${NC}"

  if [ "$pkg_manager" = "pnpm" ]; then
    echo "    pnpm -C frontend dev     # Start frontend dev server"
    echo "    pnpm -C relayer dev      # Start relayer"
    echo "    pnpm -C vault-daemon dev # Start vault daemon"
  else
    echo "    cd frontend && npm run dev     # Start frontend dev server"
    echo "    cd relayer && npm run dev      # Start relayer"
    echo "    cd vault-daemon && npm run dev # Start vault daemon"
  fi

  echo ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  echo ""
  echo -e "${BOLD}${BLUE}╔═══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${BLUE}║     Zarklink — Dependency Installer                  ║${NC}"
  echo -e "${BOLD}${BLUE}║  Privacy-Preserving Zcash Bridge to Starknet          ║${NC}"
  echo -e "${BOLD}${BLUE}╚═══════════════════════════════════════════════════════╝${NC}"
  echo ""

  # 1. System deps
  check_system_deps || exit 1

  # 2. Zcash params
  check_zcash_params

  # 3. Build contracts
  build_contracts

  # 4. Detect/select package manager
  local pkg_manager
  pkg_manager=$(detect_pkg_manager "$@")
  log_info "Using package manager: ${pkg_manager}"

  # 5. Install JS packages
  install_js_packages "$pkg_manager"

  # 6. Verify
  verify_installation

  # 7. Summary
  print_summary "$pkg_manager"
}

main "$@"
