#!/usr/bin/env bash
# ============================================================================
# Zarklink — One-Shot Sepolia Deployment
# ============================================================================
# Deploys account + contracts to Starknet Sepolia and configures the frontend.
#
# Prerequisites:
#   - STRK tokens at your Sepolia account (run this script; it will tell you)
#   - Node.js / pnpm installed
#   - Scarb (Cairo compiler) installed
#
# Usage:
#   ./scripts/deploy-to-sepolia.sh
# ============================================================================

set -e

C_RESET="\033[0m"
C_GREEN="\033[32m"
C_YELLOW="\033[33m"
C_RED="\033[31m"
C_CYAN="\033[36m"
C_BOLD="\033[1m"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo -e "\n${C_BOLD}${C_CYAN}════════════════════════════════════════════════════${C_RESET}"
echo -e "${C_BOLD}${C_CYAN}  Zarklink — Starknet Sepolia Deployment${C_RESET}"
echo -e "${C_BOLD}${C_CYAN}════════════════════════════════════════════════════${C_RESET}\n"

# ── Step 1: Check/create account ─────────────────────────────────────────
ACCOUNT_FILE=".sepolia/account.json"
if [[ ! -f "$ACCOUNT_FILE" ]]; then
  echo -e "${C_YELLOW}No Sepolia account found. Generating one...${C_RESET}"
  node_modules/.bin/tsx scripts/create-sepolia-account.ts
  echo -e "\n${C_YELLOW}Fund the address above with STRK from:${C_RESET}"
  echo -e "  ${C_CYAN}https://starknet-faucet.vercel.app/${C_RESET}"
  echo -e "\nThen re-run this script."
  exit 0
fi

ACCOUNT_ADDR=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ACCOUNT_FILE','utf-8')).address)")
ACCOUNT_KEY=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ACCOUNT_FILE','utf-8')).private_key)")
ACCOUNT_DEPLOYED=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ACCOUNT_FILE','utf-8')).deployed)")

echo -e "${C_GREEN}Account:${C_RESET} $ACCOUNT_ADDR"

# ── Step 2: Check STRK balance ───────────────────────────────────────────
echo -e "\n${C_CYAN}Checking STRK balance...${C_RESET}"
STRK_BAL=$(node -e "
const { RpcProvider } = require('starknet');
const p = new RpcProvider({ nodeUrl: 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/demo' });
const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
(async () => {
  const r = await p.callContract({ contractAddress: STRK, entrypoint: 'balanceOf', calldata: ['$ACCOUNT_ADDR'] });
  console.log((Number(BigInt(r[0])) / 1e18).toFixed(2));
})();
")

echo -e "${C_GREEN}STRK balance: ${STRK_BAL} STRK${C_RESET}"

if (( $(echo "$STRK_BAL < 1" | bc -l) )); then
  echo -e "\n${C_RED}Insufficient STRK. Fund the account first:${C_RESET}"
  echo -e "  ${C_CYAN}https://starknet-faucet.vercel.app/${C_RESET}"
  echo -e "  Address: ${C_BOLD}$ACCOUNT_ADDR${C_RESET}"
  exit 1
fi

# ── Step 3: Deploy account (if not already) ──────────────────────────────
if [[ "$ACCOUNT_DEPLOYED" != "true" ]]; then
  echo -e "\n${C_CYAN}Deploying account contract...${C_RESET}"
  node_modules/.bin/tsx scripts/create-sepolia-account.ts --deploy
fi

# ── Step 4: Deploy contracts ─────────────────────────────────────────────
echo -e "\n${C_CYAN}Deploying contracts to Sepolia...${C_RESET}"
DEPLOYER_ADDRESS="$ACCOUNT_ADDR" DEPLOYER_PRIVATE_KEY="$ACCOUNT_KEY" \
  node_modules/.bin/tsx scripts/deploy-sepolia.ts --build

# ── Step 5: Switch frontend to testnet ───────────────────────────────────
echo -e "\n${C_CYAN}Switching frontend to testnet...${C_RESET}"
bash switch-env.sh testnet

# ── Step 6: Build frontend ───────────────────────────────────────────────
echo -e "\n${C_CYAN}Building frontend...${C_RESET}"
cd frontend && pnpm build
cd "$ROOT"

# ── Done ─────────────────────────────────────────────────────────────────
echo -e "\n${C_BOLD}${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
echo -e "${C_BOLD}${C_GREEN}  Deployment Complete!${C_RESET}"
echo -e "${C_BOLD}${C_GREEN}════════════════════════════════════════════════════${C_RESET}"
echo -e ""
echo -e "  Frontend env: ${C_CYAN}frontend/.env.testnet${C_RESET}"
echo -e "  Deployments:  ${C_CYAN}.sepolia/deployments.json${C_RESET}"
echo -e ""
echo -e "  To deploy on Vercel:"
echo -e "    1. Push to GitHub"
echo -e "    2. Import repo on ${C_CYAN}https://vercel.com${C_RESET}"
echo -e "    3. Set root directory to ${C_BOLD}frontend${C_RESET}"
echo -e "    4. Add env vars from ${C_CYAN}frontend/.env.testnet${C_RESET}"
echo -e "    5. Deploy!"
echo -e ""
