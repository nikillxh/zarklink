#!/bin/bash
# ZCLAIM Deployment Script
# Deploy Cairo contracts to Starknet

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              ZCLAIM Bridge Deployment Script                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Configuration
NETWORK=${1:-"sepolia"}
CAIRO_DIR="$(dirname "$0")/.."

# Check dependencies
check_deps() {
    echo -e "${YELLOW}Checking dependencies...${NC}"
    
    if ! command -v scarb &> /dev/null; then
        echo -e "${RED}Error: scarb not found. Please install scarb.${NC}"
        exit 1
    fi
    
    if ! command -v starkli &> /dev/null; then
        echo -e "${RED}Error: starkli not found. Please install starkli.${NC}"
        echo "Run: curl https://get.starkli.sh | sh"
        exit 1
    fi
    
    echo -e "${GREEN}✓ All dependencies found${NC}"
}

# Load environment
load_env() {
    if [ -f "$CAIRO_DIR/.env" ]; then
        export $(cat "$CAIRO_DIR/.env" | grep -v '^#' | xargs)
    fi
    
    if [ -z "$STARKNET_ACCOUNT" ]; then
        echo -e "${YELLOW}STARKNET_ACCOUNT not set. Using default.${NC}"
        STARKNET_ACCOUNT="$HOME/.starkli-wallets/deployer/account.json"
    fi
    
    if [ -z "$STARKNET_KEYSTORE" ]; then
        echo -e "${YELLOW}STARKNET_KEYSTORE not set. Using default.${NC}"
        STARKNET_KEYSTORE="$HOME/.starkli-wallets/deployer/keystore.json"
    fi
}

# Build contracts
build_contracts() {
    echo -e "\n${YELLOW}Building contracts...${NC}"
    cd "$CAIRO_DIR"
    scarb build
    echo -e "${GREEN}✓ Build complete${NC}"
}

# Declare contracts
declare_contracts() {
    echo -e "\n${YELLOW}Declaring contracts...${NC}"
    
    cd "$CAIRO_DIR"
    
    # Declare wZEC token
    echo -e "${CYAN}Declaring wZEC token...${NC}"
    WZEC_CLASS_HASH=$(starkli declare \
        --network "$NETWORK" \
        --account "$STARKNET_ACCOUNT" \
        --keystore "$STARKNET_KEYSTORE" \
        target/dev/zclaim_wZEC.contract_class.json \
        2>&1 | grep "Class hash declared" | awk '{print $NF}')
    
    echo -e "${GREEN}✓ wZEC class hash: $WZEC_CLASS_HASH${NC}"
    
    # Declare RelaySystem
    echo -e "${CYAN}Declaring RelaySystem...${NC}"
    RELAY_CLASS_HASH=$(starkli declare \
        --network "$NETWORK" \
        --account "$STARKNET_ACCOUNT" \
        --keystore "$STARKNET_KEYSTORE" \
        target/dev/zclaim_RelaySystem.contract_class.json \
        2>&1 | grep "Class hash declared" | awk '{print $NF}')
    
    echo -e "${GREEN}✓ RelaySystem class hash: $RELAY_CLASS_HASH${NC}"
    
    # Export class hashes
    echo "WZEC_CLASS_HASH=$WZEC_CLASS_HASH" >> .env.deployed
    echo "RELAY_CLASS_HASH=$RELAY_CLASS_HASH" >> .env.deployed
}

# Deploy contracts
deploy_contracts() {
    echo -e "\n${YELLOW}Deploying contracts...${NC}"
    
    # Get deployer address
    DEPLOYER=$(starkli account fetch "$STARKNET_ACCOUNT" --output-json | jq -r '.address')
    
    # Deploy wZEC token
    echo -e "${CYAN}Deploying wZEC token...${NC}"
    WZEC_ADDRESS=$(starkli deploy \
        --network "$NETWORK" \
        --account "$STARKNET_ACCOUNT" \
        --keystore "$STARKNET_KEYSTORE" \
        "$WZEC_CLASS_HASH" \
        "$DEPLOYER" \
        2>&1 | grep "Contract deployed" | awk '{print $NF}')
    
    echo -e "${GREEN}✓ wZEC deployed: $WZEC_ADDRESS${NC}"
    
    # Deploy RelaySystem
    # Constructor args: genesis_hash, genesis_height, genesis_sapling_root, owner
    # Using Zcash testnet genesis-like values
    GENESIS_HASH_LOW="0x0"
    GENESIS_HASH_HIGH="0x0"
    GENESIS_HEIGHT="0"
    GENESIS_SAPLING_LOW="0x0"
    GENESIS_SAPLING_HIGH="0x0"
    
    echo -e "${CYAN}Deploying RelaySystem...${NC}"
    RELAY_ADDRESS=$(starkli deploy \
        --network "$NETWORK" \
        --account "$STARKNET_ACCOUNT" \
        --keystore "$STARKNET_KEYSTORE" \
        "$RELAY_CLASS_HASH" \
        "$GENESIS_HASH_LOW" "$GENESIS_HASH_HIGH" \
        "$GENESIS_HEIGHT" \
        "$GENESIS_SAPLING_LOW" "$GENESIS_SAPLING_HIGH" \
        "$DEPLOYER" \
        2>&1 | grep "Contract deployed" | awk '{print $NF}')
    
    echo -e "${GREEN}✓ RelaySystem deployed: $RELAY_ADDRESS${NC}"
    
    # Export addresses
    echo "WZEC_ADDRESS=$WZEC_ADDRESS" >> .env.deployed
    echo "RELAY_ADDRESS=$RELAY_ADDRESS" >> .env.deployed
}

# Summary
print_summary() {
    echo -e "\n${CYAN}════════════════════════════════════════════${NC}"
    echo -e "${GREEN}Deployment Complete!${NC}"
    echo -e "${CYAN}════════════════════════════════════════════${NC}"
    echo ""
    echo -e "Network:      ${YELLOW}$NETWORK${NC}"
    echo ""
    echo -e "Contracts:"
    echo -e "  wZEC Token:   ${GREEN}$WZEC_ADDRESS${NC}"
    echo -e "  RelaySystem:  ${GREEN}$RELAY_ADDRESS${NC}"
    echo ""
    echo -e "Configuration saved to: ${YELLOW}.env.deployed${NC}"
    echo ""
    echo -e "Next steps:"
    echo -e "  1. Configure CLI: ${CYAN}zclaim config contracts --token $WZEC_ADDRESS --relay $RELAY_ADDRESS${NC}"
    echo -e "  2. Start relayer: ${CYAN}npm run relay${NC}"
    echo ""
}

# Main
main() {
    check_deps
    load_env
    build_contracts
    
    echo -e "\n${YELLOW}Network: $NETWORK${NC}"
    read -p "Proceed with deployment? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Deployment cancelled${NC}"
        exit 1
    fi
    
    # Clear previous deployment
    rm -f .env.deployed
    
    declare_contracts
    deploy_contracts
    print_summary
}

main
