#!/bin/bash
# ============================================================
#  ZARKCLAIM CLI DEMO SCRIPT
#  Privacy-Preserving Zcash ↔ Starknet Bridge
# ============================================================
#
# This script demonstrates the zarkclaim CLI commands for:
# - Bridge status checking
# - Relay system operations
# - Issue protocol (ZEC → wZEC)
# - Redeem protocol (wZEC → ZEC)
# - Vault management
#
# Run this script step by step or all at once
# ============================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# CLI path
CLI_PATH="/home/arnavpanjla/Desktop/ztarknet/cli"
ZARKCLAIM="node $CLI_PATH/src/index.js"

# Helper function
print_header() {
    echo ""
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}════════════════════════════════════════════════════════════${NC}"
    echo ""
}

print_step() {
    echo -e "${YELLOW}▶ Step $1: $2${NC}"
    echo ""
}

wait_for_input() {
    echo ""
    echo -e "${GREEN}Press Enter to continue...${NC}"
    read
}

run_command() {
    echo -e "${BLUE}$ $1${NC}"
    echo ""
    eval "$1"
    echo ""
}

# ============================================================
# DEMO START
# ============================================================

clear
echo ""
echo -e "${CYAN}"
cat << "EOF"
 ███████╗ █████╗ ██████╗ ██╗  ██╗ ██████╗██╗      █████╗ ██╗███╗   ███╗
 ╚══███╔╝██╔══██╗██╔══██╗██║ ██╔╝██╔════╝██║     ██╔══██╗██║████╗ ████║
   ███╔╝ ███████║██████╔╝█████╔╝ ██║     ██║     ███████║██║██╔████╔██║
  ███╔╝  ██╔══██║██╔══██╗██╔═██╗ ██║     ██║     ██╔══██║██║██║╚██╔╝██║
 ███████╗██║  ██║██║  ██║██║  ██╗╚██████╗███████╗██║  ██║██║██║ ╚═╝ ██║
 ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝╚═╝╚═╝     ╚═╝
                                                                  
             Privacy-Preserving Zcash ↔ Starknet Bridge
                         CLI DEMONSTRATION
EOF
echo -e "${NC}"
echo ""
echo -e "${GREEN}This demo showcases the zarkclaim CLI commands.${NC}"
echo -e "${GREEN}Networks: Zcash Testnet ↔ Starknet Sepolia${NC}"
echo ""

wait_for_input

# ============================================================
# PART 1: INTRODUCTION - Show the CLI
# ============================================================

print_header "PART 1: CLI INTRODUCTION"

print_step "1.1" "Show the main CLI interface"
run_command "$ZARKCLAIM"

wait_for_input

print_step "1.2" "Check CLI version"
run_command "$ZARKCLAIM --version"

wait_for_input

# ============================================================
# PART 2: CONFIGURATION
# ============================================================

print_header "PART 2: CONFIGURATION"

print_step "2.1" "Show current configuration"
run_command "$ZARKCLAIM config show"

wait_for_input

print_step "2.2" "Show contract addresses"
run_command "$ZARKCLAIM config contracts"

wait_for_input

# ============================================================
# PART 3: BRIDGE STATUS
# ============================================================

print_header "PART 3: BRIDGE STATUS"

print_step "3.1" "Check overall bridge status"
run_command "$ZARKCLAIM status"

wait_for_input

print_step "3.2" "Check a specific Starknet transaction (example)"
echo -e "${YELLOW}Note: Replace with a real tx hash for live demo${NC}"
run_command "$ZARKCLAIM status tx 0x123abc..."

wait_for_input

# ============================================================
# PART 4: RELAY SYSTEM (Block Header Relay)
# ============================================================

print_header "PART 4: RELAY SYSTEM"

print_step "4.1" "Check relay chain status"
run_command "$ZARKCLAIM relay status"

wait_for_input

print_step "4.2" "Sync latest Zcash blocks (dry run)"
echo -e "${YELLOW}This command syncs Zcash block headers to Starknet${NC}"
run_command "$ZARKCLAIM relay sync --dry-run"

wait_for_input

# ============================================================
# PART 5: ISSUE PROTOCOL (ZEC → wZEC)
# ============================================================

print_header "PART 5: ISSUE PROTOCOL (Lock ZEC → Mint wZEC)"

print_step "5.1" "Show issue command help"
run_command "$ZARKCLAIM issue --help"

wait_for_input

print_step "5.2" "Request a lock permit (interactive demo)"
echo -e "${YELLOW}This would start the issue process:${NC}"
echo -e "${BLUE}$ zarkclaim issue request --amount 1.5 --recipient 0xYourStarknetAddress${NC}"
echo ""
echo "Steps:"
echo "  1. Request lock permit from bridge contract"
echo "  2. Generate vault deposit address"
echo "  3. Send ZEC to vault (shielded transaction)"
echo "  4. Wait for confirmations (20 blocks)"
echo "  5. Submit proof to mint wZEC"

wait_for_input

print_step "5.3" "Check permit status (example)"
run_command "$ZARKCLAIM issue status --permit-id 1"

wait_for_input

print_step "5.4" "List all permits for an address"
run_command "$ZARKCLAIM issue list"

wait_for_input

# ============================================================
# PART 6: REDEEM PROTOCOL (wZEC → ZEC)
# ============================================================

print_header "PART 6: REDEEM PROTOCOL (Burn wZEC → Unlock ZEC)"

print_step "6.1" "Show redeem command help"
run_command "$ZARKCLAIM redeem --help"

wait_for_input

print_step "6.2" "Request redemption (interactive demo)"
echo -e "${YELLOW}This would start the redeem process:${NC}"
echo -e "${BLUE}$ zarkclaim redeem request --amount 1.0 --zcash-address tmYourTestnetAddress${NC}"
echo ""
echo "Steps:"
echo "  1. Approve wZEC spending"
echo "  2. Request redemption from bridge"
echo "  3. Vault releases ZEC to your address"
echo "  4. Confirm transaction on Zcash network"

wait_for_input

print_step "6.3" "Check redemption status"
run_command "$ZARKCLAIM redeem status --request-id 1"

wait_for_input

# ============================================================
# PART 7: VAULT OPERATIONS
# ============================================================

print_header "PART 7: VAULT OPERATIONS"

print_step "7.1" "Check vault status"
run_command "$ZARKCLAIM vault status"

wait_for_input

print_step "7.2" "List pending operations"
run_command "$ZARKCLAIM vault pending"

wait_for_input

# ============================================================
# PART 8: TESTNET UTILITIES
# ============================================================

print_header "PART 8: ZCASH TESTNET UTILITIES"

print_step "8.1" "Show testnet info"
run_command "$ZARKCLAIM testnet info"

wait_for_input

print_step "8.2" "Get faucet URL for test coins"
run_command "$ZARKCLAIM testnet faucet"

wait_for_input

print_step "8.3" "Validate a testnet address"
run_command "$ZARKCLAIM testnet validate tmHxYZabcdefghijklmnopqrstuvwxyz12345"

wait_for_input

# ============================================================
# DEMO COMPLETE
# ============================================================

print_header "DEMO COMPLETE"

echo -e "${GREEN}Thank you for watching the zarkclaim CLI demonstration!${NC}"
echo ""
echo -e "${CYAN}Key Takeaways:${NC}"
echo "  • zarkclaim bridges Zcash ↔ Starknet with privacy preservation"
echo "  • Issue: Lock ZEC on Zcash, mint wZEC on Starknet"
echo "  • Redeem: Burn wZEC on Starknet, unlock ZEC on Zcash"
echo "  • Relay: Zcash block headers synced to Starknet for verification"
echo "  • All transactions verifiable on-chain"
echo ""
echo -e "${CYAN}Resources:${NC}"
echo "  • GitHub: https://github.com/Arnav-panjla/ztarknet"
echo "  • Zcash Testnet Faucet: https://faucet.zecpages.com/"
echo "  • Starknet Sepolia: https://sepolia.voyager.online"
echo ""
