# ZARKLINK CLI - QUICK DEMO COMMANDS
# Copy and paste these commands for your presentation

# ============================================================
# SETUP: Navigate to CLI directory
# ============================================================
cd /home/arnavpanjla/Desktop/ztarknet/cli

# Create an alias for convenience
alias zarklink="node src/index.js"

# ============================================================
# 1. SHOW THE CLI
# ============================================================

# Main interface with logo
zarklink

# Help for any command
zarklink --help
zarklink issue --help

# ============================================================
# 2. CONFIGURATION
# ============================================================

# Show current config
zarklink config show

# Show deployed contract addresses
zarklink config contracts

# ============================================================
# 3. BRIDGE STATUS
# ============================================================

# Overall bridge status
zarklink status

# Check specific transaction
zarklink status tx 0x069d135c173847a356aa29a182ace00981e9793aea5bb62bfc6c1d4577e9c36e

# ============================================================
# 4. RELAY SYSTEM
# ============================================================

# Check relay status (Zcash → Starknet block sync)
zarklink relay status

# Sync blocks (dry run - won't actually submit)
zarklink relay sync --dry-run

# ============================================================
# 5. ISSUE PROTOCOL (ZEC → wZEC)
# ============================================================

# Request lock permit
zarklink issue request --amount 1.5 --recipient 0x5cb95dbbc0ce2d5a79cbf18094b783ce8923520b2b1b3675d2d5d6fd605a573

# Check permit status
zarklink issue status --permit-id 1

# List all permits
zarklink issue list

# ============================================================
# 6. REDEEM PROTOCOL (wZEC → ZEC)
# ============================================================

# Request redemption
zarklink redeem request --amount 1.0 --zcash-address tmHxYZabcdefghijklmnopqrstuvwxyz12345

# Check redemption status
zarklink redeem status --request-id 1

# List pending redemptions
zarklink redeem list

# ============================================================
# 7. VAULT OPERATIONS
# ============================================================

# Check vault status
zarklink vault status

# List pending operations
zarklink vault pending

# ============================================================
# 8. TESTNET UTILITIES
# ============================================================

# Testnet info
zarklink testnet info

# Get faucet URL
zarklink testnet faucet

# Validate address
zarklink testnet validate tmHxYZabcdef123

# Check testnet connection status
zarklink testnet status

# ============================================================
# CONTRACT ADDRESSES (Starknet Sepolia)
# ============================================================
# 
# wZEC Token:    0x04c571b6ca21e59add5ccb280eb68a309c6ca4e5eeecfd2186856fe97f74a294
# RelaySystem:   0x01ae3dce889773db25632ebed4a04698fb2dff1c71b2101f00e8c0f34b5d7e4b
# VaultRegistry: 0x007abd698ddafea4669ac4d5e96477ef4958b6e6ebd57e4ef2f61df1f2597436
# ZclaimBridge:  0x069d135c173847a356aa29a182ace00981e9793aea5bb62bfc6c1d4577e9c36e
#
# View on Voyager: https://sepolia.voyager.online/contract/<address>

# ============================================================
# USEFUL LINKS
# ============================================================
#
# Zcash Testnet Faucet: https://faucet.zecpages.com/
# Starknet Sepolia:     https://sepolia.voyager.online
# Zcash Explorer:       https://blockchair.com/zcash
