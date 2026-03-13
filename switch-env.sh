#!/usr/bin/env bash
# ============================================================================
# Zarklink — Environment Switcher
# ============================================================================
# Easily switch the frontend between devnet (localhost) and testnet (Sepolia).
#
# Usage:
#   ./switch-env.sh devnet     # Switch to localhost devnet
#   ./switch-env.sh testnet    # Switch to Starknet Sepolia testnet
#   ./switch-env.sh status     # Show current environment
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
ENV_LOCAL="$FRONTEND_DIR/.env.local"
ENV_DEVNET="$FRONTEND_DIR/.env.devnet"
ENV_TESTNET="$FRONTEND_DIR/.env.testnet"

C_RESET="\033[0m"
C_GREEN="\033[32m"
C_YELLOW="\033[33m"
C_CYAN="\033[36m"
C_RED="\033[31m"
C_BOLD="\033[1m"

show_status() {
  if [[ ! -f "$ENV_LOCAL" ]]; then
    echo -e "${C_YELLOW}No .env.local found — not configured${C_RESET}"
    return
  fi
  if grep -q "NEXT_PUBLIC_NETWORK=testnet" "$ENV_LOCAL" 2>/dev/null; then
    echo -e "${C_GREEN}${C_BOLD}Current environment: testnet (Starknet Sepolia)${C_RESET}"
  else
    echo -e "${C_CYAN}${C_BOLD}Current environment: devnet (localhost)${C_RESET}"
  fi
}

case "${1:-status}" in
  devnet|local|localhost)
    if [[ ! -f "$ENV_DEVNET" ]]; then
      echo -e "${C_RED}Error: $ENV_DEVNET not found.${C_RESET}"
      echo "Run start-devnet.sh first to generate the devnet environment."
      exit 1
    fi
    cp "$ENV_DEVNET" "$ENV_LOCAL"
    echo -e "${C_GREEN}✓ Switched to ${C_BOLD}devnet${C_RESET}${C_GREEN} (localhost)${C_RESET}"
    echo -e "  Starknet: http://127.0.0.1:5050"
    echo -e "  Zcash:    http://127.0.0.1:18232"
    echo ""
    echo -e "  Restart the dev server: ${C_CYAN}cd frontend && pnpm dev${C_RESET}"
    ;;

  testnet|sepolia)
    if [[ ! -f "$ENV_TESTNET" ]]; then
      echo -e "${C_RED}Error: $ENV_TESTNET not found.${C_RESET}"
      echo "Deploy to Sepolia first:"
      echo "  npx tsx scripts/deploy-sepolia.ts"
      echo ""
      echo "Or create frontend/.env.testnet manually with your contract addresses."
      exit 1
    fi
    cp "$ENV_TESTNET" "$ENV_LOCAL"
    echo -e "${C_GREEN}✓ Switched to ${C_BOLD}testnet${C_RESET}${C_GREEN} (Starknet Sepolia)${C_RESET}"
    echo ""
    echo -e "  Restart the dev server: ${C_CYAN}cd frontend && pnpm dev${C_RESET}"
    ;;

  status)
    show_status
    echo ""
    echo "Available environments:"
    [[ -f "$ENV_DEVNET" ]] && echo -e "  ${C_GREEN}✓${C_RESET} devnet  (frontend/.env.devnet)" || echo -e "  ${C_RED}✗${C_RESET} devnet  (not found)"
    [[ -f "$ENV_TESTNET" ]] && echo -e "  ${C_GREEN}✓${C_RESET} testnet (frontend/.env.testnet)" || echo -e "  ${C_RED}✗${C_RESET} testnet (not found)"
    ;;

  *)
    echo "Usage: ./switch-env.sh <devnet|testnet|status>"
    echo ""
    echo "  devnet   — Switch to localhost (starknet-devnet + zcashd regtest)"
    echo "  testnet  — Switch to Starknet Sepolia testnet"
    echo "  status   — Show current environment"
    exit 1
    ;;
esac
