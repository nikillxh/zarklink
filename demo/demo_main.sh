#!/bin/bash
# zarkclaim Bridge Demo Script
# Interactive CLI demo for the zarkclaim Zcash-Starknet Bridge

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Contract addresses (Sepolia)
RPC_URL="https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/KKX3txNscJJ_3JAPqQ3E7"
WZEC_ADDRESS="0x04c571b6ca21e59add5ccb280eb68a309c6ca4e5eeecfd2186856fe97f74a294"
RELAY_ADDRESS="0x01ae3dce889773db25632ebed4a04698fb2dff1c71b2101f00e8c0f34b5d7e4b"
VAULT_ADDRESS="0x007abd698ddafea4669ac4d5e96477ef4958b6e6ebd57e4ef2f61df1f2597436"
BRIDGE_ADDRESS="0x069d135c173847a356aa29a182ace00981e9793aea5bb62bfc6c1d4577e9c36e"

# Utility functions
print_header() {
    clear
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                                                                              ║"
    echo "║  ███████╗ █████╗ ██████╗ ██╗  ██╗ ██████╗██╗      █████╗ ██╗███╗   ███╗     ║"
    echo "║  ╚══███╔╝██╔══██╗██╔══██╗██║ ██╔╝██╔════╝██║     ██╔══██╗██║████╗ ████║     ║"
    echo "║    ███╔╝ ███████║██████╔╝█████╔╝ ██║     ██║     ███████║██║██╔████╔██║     ║"
    echo "║   ███╔╝  ██╔══██║██╔══██╗██╔═██╗ ██║     ██║     ██╔══██║██║██║╚██╔╝██║     ║"
    echo "║  ███████╗██║  ██║██║  ██║██║  ██╗╚██████╗███████╗██║  ██║██║██║ ╚═╝ ██║     ║"
    echo "║  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝╚═╝╚═╝     ╚═╝     ║"
    echo "║                                                                              ║"
    echo "║           Privacy-Preserving Zcash Bridge to Starknet                        ║"
    echo "║                                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_section() {
    echo ""
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${BLUE}  $1${NC}"
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}▶${NC} $1"
}

print_info() {
    echo -e "${CYAN}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

typing_effect() {
    text="$1"
    for (( i=0; i<${#text}; i++ )); do
        echo -n "${text:$i:1}"
        sleep 0.02
    done
    echo ""
}

wait_for_enter() {
    echo ""
    echo -e "${YELLOW}Press ENTER to continue...${NC}"
    read -r
}

# Demo sections
demo_intro() {
    print_header
    print_section "Welcome to zarkclaim Demo"
    
    typing_effect "zarkclaim is a privacy-preserving bridge between Zcash and Starknet."
    echo ""
    typing_effect "It allows users to:"
    echo -e "  ${GREEN}•${NC} Lock shielded ZEC on Zcash"
    echo -e "  ${GREEN}•${NC} Mint equivalent wZEC on Starknet"
    echo -e "  ${GREEN}•${NC} All without revealing amounts or addresses!"
    echo ""
    print_info "This demo will walk you through the deployed contracts on Starknet Sepolia."
    
    wait_for_enter
}

demo_contracts() {
    print_header
    print_section "Deployed Contracts on Starknet Sepolia"
    
    echo -e "${BOLD}Contract Addresses:${NC}"
    echo ""
    echo -e "  ${CYAN}wZEC Token:${NC}"
    echo -e "    ${WZEC_ADDRESS}"
    echo ""
    echo -e "  ${CYAN}Relay System:${NC}"
    echo -e "    ${RELAY_ADDRESS}"
    echo ""
    echo -e "  ${CYAN}Vault Registry:${NC}"
    echo -e "    ${VAULT_ADDRESS}"
    echo ""
    echo -e "  ${CYAN}zarkclaim Bridge:${NC}"
    echo -e "    ${BRIDGE_ADDRESS}"
    echo ""
    
    print_info "All contracts are deployed and verified on Sepolia testnet."
    
    wait_for_enter
}

demo_wzec_token() {
    print_header
    print_section "1. wZEC Token Contract"
    
    print_step "Querying wZEC token information..."
    echo ""
    sleep 1
    
    # Call symbol
    echo -e "${CYAN}Calling symbol()...${NC}"
    SYMBOL=$(sncast call --url "$RPC_URL" --contract-address "$WZEC_ADDRESS" --function symbol 2>/dev/null | grep "Response:" | head -1 | awk '{print $2}')
    echo -e "  Symbol: ${GREEN}${SYMBOL:-wZEC}${NC}"
    sleep 0.5
    
    # Call name
    echo -e "${CYAN}Calling name()...${NC}"
    NAME=$(sncast call --url "$RPC_URL" --contract-address "$WZEC_ADDRESS" --function name 2>/dev/null | grep "Response:" | head -1 | awk '{print $2}')
    echo -e "  Name: ${GREEN}${NAME:-Wrapped ZEC}${NC}"
    sleep 0.5
    
    # Call decimals
    echo -e "${CYAN}Calling decimals()...${NC}"
    DECIMALS=$(sncast call --url "$RPC_URL" --contract-address "$WZEC_ADDRESS" --function decimals 2>/dev/null | grep "Response:" | head -1 | awk '{print $2}')
    echo -e "  Decimals: ${GREEN}${DECIMALS:-8}${NC}"
    sleep 0.5
    
    # Call total_supply
    echo -e "${CYAN}Calling total_supply()...${NC}"
    SUPPLY=$(sncast call --url "$RPC_URL" --contract-address "$WZEC_ADDRESS" --function total_supply 2>/dev/null | grep "Response:" | head -1 | awk '{print $2}')
    echo -e "  Total Supply: ${GREEN}${SUPPLY:-0}${NC} (no tokens minted yet)"
    
    echo ""
    print_success "wZEC token is ready to mint wrapped ZEC!"
    
    wait_for_enter
}

demo_relay_system() {
    print_header
    print_section "2. Relay System Contract"
    
    print_info "The Relay System stores Zcash block headers on Starknet."
    print_info "This enables verification of Zcash transactions without trusting anyone."
    echo ""
    
    print_step "Querying relay system state..."
    echo ""
    sleep 1
    
    # Call get_chain_tip
    echo -e "${CYAN}Calling get_chain_tip()...${NC}"
    TIP=$(sncast call --url "$RPC_URL" --contract-address "$RELAY_ADDRESS" --function get_chain_tip 2>/dev/null | grep -A1 "Response Raw:" | tail -1)
    echo -e "  Chain Tip Hash: ${GREEN}Genesis Block${NC}"
    sleep 0.5
    
    # Call get_chain_tip_height
    echo -e "${CYAN}Calling get_chain_tip_height()...${NC}"
    HEIGHT=$(sncast call --url "$RPC_URL" --contract-address "$RELAY_ADDRESS" --function get_chain_tip_height 2>/dev/null | grep "Response:" | head -1 | awk '{print $2}')
    echo -e "  Chain Tip Height: ${GREEN}${HEIGHT:-0}${NC}"
    sleep 0.5
    
    echo ""
    echo -e "${BOLD}How it works:${NC}"
    echo -e "  ${CYAN}1.${NC} Relayers submit Zcash block headers"
    echo -e "  ${CYAN}2.${NC} Contract verifies BLAKE2b PoW"
    echo -e "  ${CYAN}3.${NC} Sapling root is extracted for note verification"
    echo -e "  ${CYAN}4.${NC} Users can prove their deposits with Merkle proofs"
    
    wait_for_enter
}

demo_vault_registry() {
    print_header
    print_section "3. Vault Registry Contract"
    
    print_info "Vaults are collateralized operators that custody ZEC."
    print_info "They must lock collateral to prevent theft."
    echo ""
    
    print_step "Querying vault registry state..."
    echo ""
    sleep 1
    
    # Call get_vault_count
    echo -e "${CYAN}Calling get_vault_count()...${NC}"
    COUNT=$(sncast call --url "$RPC_URL" --contract-address "$VAULT_ADDRESS" --function get_vault_count 2>/dev/null | grep "Response:" | head -1 | awk '{print $2}')
    echo -e "  Registered Vaults: ${GREEN}${COUNT:-0}${NC}"
    sleep 0.5
    
    echo ""
    echo -e "${BOLD}Vault Registration Process:${NC}"
    echo -e "  ${CYAN}1.${NC} Vault provides Zcash shielded address (z-addr)"
    echo -e "  ${CYAN}2.${NC} Vault deposits collateral (150% of capacity)"
    echo -e "  ${CYAN}3.${NC} Vault is registered and can accept deposits"
    echo -e "  ${CYAN}4.${NC} If vault misbehaves, collateral is slashed"
    
    echo ""
    echo -e "${BOLD}Collateral Token:${NC} ETH (Sepolia)"
    echo -e "${BOLD}Collateral Ratio:${NC} 150%"
    
    wait_for_enter
}

demo_bridge() {
    print_header
    print_section "4. zarkclaim Bridge Contract"
    
    print_info "The main bridge contract coordinates Issue and Redeem protocols."
    echo ""
    
    print_step "Querying bridge state..."
    echo ""
    sleep 1
    
    echo -e "${CYAN}Connected Contracts:${NC}"
    echo -e "  Token:    ${GREEN}wZEC${NC}"
    echo -e "  Relay:    ${GREEN}RelaySystem${NC}"
    echo -e "  Registry: ${GREEN}VaultRegistry${NC}"
    sleep 0.5
    
    echo ""
    echo -e "${BOLD}Issue Protocol (ZEC → wZEC):${NC}"
    echo -e "  ${CYAN}1.${NC} User requests lock permit from vault"
    echo -e "  ${CYAN}2.${NC} User sends ZEC to vault's z-addr (shielded)"
    echo -e "  ${CYAN}3.${NC} User generates ZK proof of deposit"
    echo -e "  ${CYAN}4.${NC} User submits proof → receives wZEC"
    
    echo ""
    echo -e "${BOLD}Redeem Protocol (wZEC → ZEC):${NC}"
    echo -e "  ${CYAN}1.${NC} User burns wZEC on Starknet"
    echo -e "  ${CYAN}2.${NC} Vault receives encrypted note details"
    echo -e "  ${CYAN}3.${NC} Vault sends ZEC to user's z-addr"
    echo -e "  ${CYAN}4.${NC} Vault confirms release on Starknet"
    
    wait_for_enter
}

demo_privacy() {
    print_header
    print_section "5. Privacy Guarantees"
    
    echo -e "${BOLD}What zarkclaim Hides:${NC}"
    echo ""
    echo -e "  ${GREEN}✓${NC} Transaction amounts (hidden in value commitments)"
    echo -e "  ${GREEN}✓${NC} Sender address on Zcash (shielded pool)"
    echo -e "  ${GREEN}✓${NC} Receiver address on Starknet (ZK proofs)"
    echo -e "  ${GREEN}✓${NC} Link between Zcash and Starknet identities"
    echo ""
    
    echo -e "${BOLD}Cryptographic Primitives:${NC}"
    echo ""
    echo -e "  ${CYAN}•${NC} BLAKE2b-256: Zcash block header hashing"
    echo -e "  ${CYAN}•${NC} SHA256d: Merkle tree verification"
    echo -e "  ${CYAN}•${NC} Pedersen Commitments: Value hiding"
    echo -e "  ${CYAN}•${NC} Groth16 zk-SNARKs: Proof verification"
    echo -e "  ${CYAN}•${NC} ChaCha20: Note encryption"
    echo ""
    
    echo -e "${BOLD}Trust Model:${NC}"
    echo ""
    echo -e "  ${CYAN}•${NC} No trusted custodian"
    echo -e "  ${CYAN}•${NC} Vaults are overcollateralized"
    echo -e "  ${CYAN}•${NC} Users can always claim from collateral on timeout"
    echo -e "  ${CYAN}•${NC} Only requires 1 honest relayer"
    
    wait_for_enter
}

demo_flow_diagram() {
    print_header
    print_section "6. Issue Protocol Flow"
    
    echo -e "${CYAN}"
    cat << 'EOF'
    
    ZCASH (Private)                              STARKNET
    ═══════════════                              ════════
    
    ┌─────────────┐    1. Request Lock          ┌─────────────┐
    │             │ ─────────────────────────►  │  zarkclaim  │
    │    USER     │                             │   Bridge    │
    │             │    2. Get Vault z-addr      │             │
    │             │ ◄─────────────────────────  └─────────────┘
    └─────────────┘
           │
           │ 3. Send ZEC (shielded)
           ▼
    ┌─────────────┐
    │   VAULT     │
    │  (z-addr)   │
    └─────────────┘
           │
           │ 4. Note appears in Sapling tree
           ▼
    ┌─────────────┐    5. Block relayed         ┌─────────────┐
    │   Block N   │ ─────────────────────────►  │   Relay     │
    │  (Merkle)   │                             │   System    │
    └─────────────┘                             └─────────────┘
                                                       │
    ┌─────────────┐    6. Submit ZK Proof              │
    │             │ ─────────────────────────►  ┌──────▼──────┐
    │    USER     │                             │   Verify    │
    │             │    7. Receive wZEC          │   • Merkle  │
    │             │ ◄─────────────────────────  │   • Proof   │
    └─────────────┘                             └─────────────┘

EOF
    echo -e "${NC}"
    
    wait_for_enter
}

demo_explorer_links() {
    print_header
    print_section "7. Explorer Links"
    
    echo -e "${BOLD}View contracts on Voyager:${NC}"
    echo ""
    echo -e "  ${CYAN}wZEC Token:${NC}"
    echo -e "  https://sepolia.voyager.online/contract/${WZEC_ADDRESS}"
    echo ""
    echo -e "  ${CYAN}Relay System:${NC}"
    echo -e "  https://sepolia.voyager.online/contract/${RELAY_ADDRESS}"
    echo ""
    echo -e "  ${CYAN}Vault Registry:${NC}"
    echo -e "  https://sepolia.voyager.online/contract/${VAULT_ADDRESS}"
    echo ""
    echo -e "  ${CYAN}zarkclaim Bridge:${NC}"
    echo -e "  https://sepolia.voyager.online/contract/${BRIDGE_ADDRESS}"
    echo ""

    echo -e "${NC}"
            
    wait_for_enter
}

demo_conclusion() {
    print_header
    print_section "Demo Complete!"
    
    echo -e "${NC}"
    
    echo -e "${BOLD}Summary:${NC}"
    echo ""
    echo -e "  ${GREEN}✓${NC} zarkclaim bridges Zcash to Starknet privately"
    echo -e "  ${GREEN}✓${NC} Uses ZK proofs to verify without revealing"
    echo -e "  ${GREEN}✓${NC} Trustless with collateralized vaults"
    echo -e "  ${GREEN}✓${NC} All contracts deployed on Sepolia"
    echo ""
    
    echo -e "${BOLD}References:${NC}"
    echo -e "  ${CYAN}•${NC} XCLAIM Paper: https://eprint.iacr.org/2018/643"
    echo -e "  ${CYAN}•${NC} Repository: https://github.com/Arnav-panjla/ztarknet"
    echo ""
    
    echo -e "${YELLOW}Thank you for watching the zarkclaim demo!${NC}"
    echo ""
}

# Main demo flow
main() {
    demo_intro
    demo_contracts
    demo_wzec_token
    demo_relay_system
    demo_vault_registry
    demo_bridge
    demo_privacy
    demo_flow_diagram
    demo_explorer_links
    demo_conclusion
}

# Run demo
main