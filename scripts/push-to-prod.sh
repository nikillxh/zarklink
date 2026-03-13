#!/usr/bin/env bash
# ============================================================================
# Zarklink — Push to Production
# ============================================================================
# Deploys the latest changes to Starknet Sepolia testnet and Vercel.
#
# Phases:
#   1. Pre-flight checks (git status, tools, env files)
#   2. (Optional) Redeploy contracts to Sepolia  [--contracts]
#   3. Switch frontend to testnet environment
#   4. Build frontend locally to verify
#   5. Sync Vercel env vars from frontend/.env.testnet
#   6. Deploy frontend to Vercel production
#
# Prerequisites:
#   - Vercel CLI: npm i -g vercel  (and `vercel login`)
#   - Node.js / pnpm / Scarb installed
#   - .sepolia/account.json with funded deployer
#   - Vercel project linked (run `vercel link` in frontend/ once)
#
# Usage:
#   ./scripts/push-to-prod.sh                 # Frontend only → Vercel
#   ./scripts/push-to-prod.sh --contracts     # Redeploy contracts + frontend
#   ./scripts/push-to-prod.sh --skip-build    # Skip local build verification
#   ./scripts/push-to-prod.sh --dry-run       # Show plan without executing
#   ./scripts/push-to-prod.sh --env-only      # Just sync env vars to Vercel
# ============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────

C_RESET="\033[0m"
C_GREEN="\033[32m"
C_YELLOW="\033[33m"
C_RED="\033[31m"
C_CYAN="\033[36m"
C_BOLD="\033[1m"
C_DIM="\033[2m"

# ── Config ────────────────────────────────────────────────────────────────────

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FRONTEND_DIR="$ROOT/frontend"
ACCOUNT_FILE="$ROOT/.sepolia/account.json"
ENV_TESTNET="$FRONTEND_DIR/.env.testnet"
ENV_LOCAL="$FRONTEND_DIR/.env.local"

# ── Flags ─────────────────────────────────────────────────────────────────────

DEPLOY_CONTRACTS=false
SKIP_BUILD=false
DRY_RUN=false
ENV_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --contracts)     DEPLOY_CONTRACTS=true; shift ;;
    --skip-build)    SKIP_BUILD=true; shift ;;
    --dry-run)       DRY_RUN=true; shift ;;
    --env-only)      ENV_ONLY=true; shift ;;
    -h|--help)
      echo "Usage: ./scripts/push-to-prod.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --contracts   Rebuild & redeploy contracts to Sepolia first"
      echo "  --skip-build  Skip local frontend build verification"
      echo "  --dry-run     Show plan without executing anything"
      echo "  --env-only    Only sync env vars to Vercel (no deploy)"
      echo "  -h, --help    Show this help"
      echo ""
      echo "Examples:"
      echo "  ./scripts/push-to-prod.sh                  # Frontend → Vercel prod"
      echo "  ./scripts/push-to-prod.sh --contracts      # Contracts + frontend"
      echo "  ./scripts/push-to-prod.sh --env-only       # Just sync env vars"
      exit 0
      ;;
    *) echo -e "${C_RED}Unknown flag: $1${C_RESET}"; exit 1 ;;
  esac
done

# ── Utilities ─────────────────────────────────────────────────────────────────

step_num=0
step() {
  step_num=$((step_num + 1))
  echo -e "\n${C_BOLD}${C_CYAN}[$step_num] $1${C_RESET}"
}

ok()   { echo -e "    ${C_GREEN}✓ $1${C_RESET}"; }
warn() { echo -e "    ${C_YELLOW}⚠ $1${C_RESET}"; }
fail() { echo -e "    ${C_RED}✗ $1${C_RESET}"; exit 1; }
dry()  { echo -e "    ${C_DIM}(dry-run) $1${C_RESET}"; }

# ── Banner ────────────────────────────────────────────────────────────────────

echo -e "\n${C_BOLD}${C_CYAN}════════════════════════════════════════════════════${C_RESET}"
echo -e "${C_BOLD}${C_CYAN}  Zarklink — Push to Production${C_RESET}"
echo -e "${C_BOLD}${C_CYAN}════════════════════════════════════════════════════${C_RESET}"

if $DRY_RUN; then
  echo -e "  ${C_YELLOW}DRY RUN MODE — no changes will be made${C_RESET}"
fi

echo -e ""
echo -e "  Contracts: $( $DEPLOY_CONTRACTS && echo -e "${C_GREEN}redeploy${C_RESET}" || echo -e "${C_DIM}skip${C_RESET}" )"
echo -e "  Build:     $( $SKIP_BUILD && echo -e "${C_DIM}skip${C_RESET}" || echo -e "${C_GREEN}verify${C_RESET}" )"
echo -e "  Frontend:  $( $ENV_ONLY && echo -e "${C_DIM}env only${C_RESET}" || echo -e "${C_GREEN}deploy to Vercel${C_RESET}" )"

# ══════════════════════════════════════════════════════════════════════════════
# Phase 1: Pre-flight Checks
# ══════════════════════════════════════════════════════════════════════════════

step "Pre-flight Checks"

# Git status
if command -v git &>/dev/null && [[ -d .git ]]; then
  DIRTY=$(git status --porcelain 2>/dev/null | head -5)
  if [[ -n "$DIRTY" ]]; then
    warn "Uncommitted changes detected:"
    echo "$DIRTY" | while read -r line; do echo -e "      ${C_DIM}$line${C_RESET}"; done
  else
    ok "Git working tree clean"
  fi
fi

# Node & pnpm
command -v node &>/dev/null || fail "Node.js not found"
command -v pnpm &>/dev/null || fail "pnpm not found"
ok "Node $(node -v) + pnpm $(pnpm -v)"

# Vercel CLI
if ! command -v vercel &>/dev/null; then
  if $DRY_RUN || $ENV_ONLY; then
    warn "Vercel CLI not installed (npm i -g vercel)"
  else
    fail "Vercel CLI not found. Install: npm i -g vercel && vercel login"
  fi
else
  ok "Vercel CLI found"
fi

# Scarb (only if deploying contracts)
if $DEPLOY_CONTRACTS; then
  command -v scarb &>/dev/null || fail "Scarb not found (needed for --contracts)"
  ok "Scarb $(scarb --version | awk '{print $2}')"
fi

# Account file (only if deploying contracts)
if $DEPLOY_CONTRACTS; then
  [[ -f "$ACCOUNT_FILE" ]] || fail "No Sepolia account: $ACCOUNT_FILE\n    Run: ./scripts/deploy-to-sepolia.sh"
  ok "Sepolia account found"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Phase 2: Deploy Contracts (optional)
# ══════════════════════════════════════════════════════════════════════════════

if $DEPLOY_CONTRACTS; then
  step "Deploying Contracts to Sepolia"

  ACCOUNT_ADDR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ACCOUNT_FILE','utf-8')).address)")
  ACCOUNT_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ACCOUNT_FILE','utf-8')).private_key)")

  if $DRY_RUN; then
    dry "Would run: DEPLOYER_ADDRESS=... tsx scripts/deploy-sepolia.ts --build"
  else
    echo -e "    Deployer: ${C_DIM}${ACCOUNT_ADDR:0:12}...${ACCOUNT_ADDR: -6}${C_RESET}"
    DEPLOYER_ADDRESS="$ACCOUNT_ADDR" DEPLOYER_PRIVATE_KEY="$ACCOUNT_KEY" \
      node_modules/.bin/tsx scripts/deploy-sepolia.ts --build
    ok "Contracts deployed to Sepolia"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Phase 3: Switch Frontend to Testnet
# ══════════════════════════════════════════════════════════════════════════════

step "Switching Frontend to Testnet"

if [[ ! -f "$ENV_TESTNET" ]]; then
  fail "frontend/.env.testnet not found.\n    Deploy contracts first: ./scripts/push-to-prod.sh --contracts"
fi

if $DRY_RUN; then
  dry "Would copy frontend/.env.testnet → frontend/.env.local"
else
  cp "$ENV_TESTNET" "$ENV_LOCAL"
  ok "frontend/.env.local ← .env.testnet"
fi

# Show the env vars that will be deployed
echo -e "\n    ${C_BOLD}Environment Variables:${C_RESET}"
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  if [[ "$key" =~ (KEY|PRIVATE|SECRET) ]]; then
    echo -e "      ${C_DIM}$key=${value:0:6}...${C_RESET}"
  else
    echo -e "      ${C_DIM}$key=$value${C_RESET}"
  fi
done < "$ENV_TESTNET"

# ══════════════════════════════════════════════════════════════════════════════
# Phase 4: Build Frontend (verification)
# ══════════════════════════════════════════════════════════════════════════════

if ! $SKIP_BUILD && ! $ENV_ONLY; then
  step "Building Frontend (verification)"

  if $DRY_RUN; then
    dry "Would run: cd frontend && npm install --legacy-peer-deps && npm run build"
  else
    cd "$FRONTEND_DIR"
    echo -e "    Installing dependencies..."
    npm install --legacy-peer-deps --silent 2>/dev/null || npm install --legacy-peer-deps
    echo -e "    Building..."
    npm run build 2>&1 | tail -5
    ok "Frontend build successful"
    cd "$ROOT"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Phase 5: Sync Vercel Environment Variables
# ══════════════════════════════════════════════════════════════════════════════

step "Syncing Vercel Environment Variables"

if ! command -v vercel &>/dev/null; then
  warn "Vercel CLI not available — skipping env sync"
  echo -e "    ${C_DIM}Manually add vars from frontend/.env.testnet to Vercel dashboard${C_RESET}"
else
  cd "$FRONTEND_DIR"

  # Check if project is linked
  if [[ ! -d ".vercel" ]]; then
    if $DRY_RUN; then
      dry "Would run: vercel link (project not yet linked)"
    else
      echo -e "    ${C_YELLOW}Project not linked. Running vercel link...${C_RESET}"
      vercel link
    fi
  fi

  # Sync env vars: read from .env.testnet, set on Vercel for production
  ENV_COUNT=0
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" =~ ^# ]] && continue
    ENV_COUNT=$((ENV_COUNT + 1))

    if $DRY_RUN; then
      dry "Would set $key on Vercel (production)"
    else
      # Remove existing, then add (vercel env add is not idempotent)
      echo "$value" | vercel env add "$key" production --force 2>/dev/null || \
        echo "$value" | vercel env add "$key" production 2>/dev/null || \
        warn "Failed to set $key (set it manually in Vercel dashboard)"
    fi
  done < "$ENV_TESTNET"

  ok "Synced $ENV_COUNT env vars to Vercel production"
  cd "$ROOT"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Phase 6: Deploy to Vercel Production
# ══════════════════════════════════════════════════════════════════════════════

if ! $ENV_ONLY; then
  step "Deploying to Vercel Production"

  if ! command -v vercel &>/dev/null; then
    fail "Vercel CLI not found. Install: npm i -g vercel && vercel login"
  fi

  cd "$FRONTEND_DIR"

  if $DRY_RUN; then
    dry "Would run: vercel --prod"
  else
    echo -e "    Deploying..."
    DEPLOY_URL=$(vercel --prod 2>&1 | tee /dev/stderr | grep -oE 'https://[^ ]+' | tail -1)
    ok "Deployed to Vercel production"
  fi

  cd "$ROOT"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════════════

echo -e "\n${C_BOLD}${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
echo -e "${C_BOLD}${C_GREEN}  Push to Production — Complete!${C_RESET}"
echo -e "${C_BOLD}${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
echo -e ""

if $DEPLOY_CONTRACTS; then
  echo -e "  ${C_GREEN}✓${C_RESET} Contracts redeployed to Sepolia"
  echo -e "    ${C_DIM}Deployments: .sepolia/deployments.json${C_RESET}"
fi

echo -e "  ${C_GREEN}✓${C_RESET} Frontend env switched to testnet"
echo -e "    ${C_DIM}Source: frontend/.env.testnet${C_RESET}"

if ! $SKIP_BUILD && ! $ENV_ONLY; then
  echo -e "  ${C_GREEN}✓${C_RESET} Frontend build verified"
fi

if ! $ENV_ONLY; then
  echo -e "  ${C_GREEN}✓${C_RESET} Deployed to Vercel production"
  if [[ -n "${DEPLOY_URL:-}" ]]; then
    echo -e "    ${C_CYAN}$DEPLOY_URL${C_RESET}"
  else
    echo -e "    ${C_CYAN}https://zarklink.vercel.app${C_RESET}"
  fi
else
  echo -e "  ${C_GREEN}✓${C_RESET} Vercel env vars synced"
fi

echo -e ""
echo -e "  ${C_DIM}To switch back to devnet: ./switch-env.sh devnet${C_RESET}"
echo -e ""
