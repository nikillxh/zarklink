# Zarklink CLI

Command-line interface for the Zarklink bridge - Privacy-preserving Zcash to Starknet bridge.

## Installation

```bash
cd cli
npm install
npm link  # Makes 'zarklink' command available globally
```

## Usage

```bash
zarklink [command] [options]
```

### Commands

| Command | Description |
|---------|-------------|
| `status` | Check bridge and transaction status |
| `issue` | Lock ZEC and mint wZEC (Issue protocol) |
| `redeem` | Burn wZEC and unlock ZEC (Redeem protocol) |
| `vault` | Manage vault operations |
| `relay` | Manage Zcash block header relay |
| `testnet` | Zcash testnet setup and utilities |
| `config` | Configure CLI settings |

## Zcash Testnet Setup

The CLI supports Zcash testnet for development and testing with TAZ (testnet coins).

### Quick Setup

```bash
# Generate testnet configuration
zarklink testnet setup

# Check testnet status
zarklink testnet status

# Get testnet faucet info
zarklink testnet faucet

# View testnet vs mainnet info
zarklink testnet info
```

### Testnet Configuration

```bash
# Configure CLI for testnet
zarklink config set zcash.network testnet
zarklink config set zcash.rpcUrl http://127.0.0.1:18232
zarklink config set zcash.rpcUser zcashrpc
zarklink config set zcash.rpcPassword <your-password>
```

### Testnet Commands

```bash
# Validate a testnet address
zarklink testnet validate <address>

# Look up transaction/block in explorer
zarklink testnet explorer tx <txid>
zarklink testnet explorer block <hash-or-height>
zarklink testnet explorer address <address>

# Check transaction confirmations
zarklink testnet confirm <txid> -c 20
```

### Getting Testnet Coins (TAZ)

1. Generate a testnet address: `zcash-cli getnewaddress`
2. Visit the faucet: https://faucet.zecpages.com/
3. Enter your testnet address and complete the captcha
4. Wait for confirmation (~2.5 minutes per block)

### Status Commands

```bash
# Get bridge overview
zarklink status bridge

# Check transaction status
zarklink status tx <hash>

# Check if block is relayed
zarklink status block <hash>

# Run health checks
zarklink status health
```

### Issue Commands (Lock ZEC → Mint wZEC)

```bash
# List available vaults
zarklink issue vaults

# Request a lock permit
zarklink issue request -v <vault-address> -a <amount>

# Lock ZEC using permit
zarklink issue lock <nonce> -f <your-z-address> -a <amount>

# Submit mint proof
zarklink issue mint <nonce>

# Check issue status
zarklink issue status <nonce>
```

### Redeem Commands (Burn wZEC → Unlock ZEC)

```bash
# Request redemption
zarklink redeem request -a <amount> -t <your-z-address>

# Check redeem status
zarklink redeem status <nonce>

# List pending redemptions
zarklink redeem list

# Claim collateral (if vault fails to release)
zarklink redeem claim <nonce>
```

### Vault Commands (For Operators)

```bash
# Register as vault operator
zarklink vault register -z <your-z-address> -c <collateral>

# Check vault status
zarklink vault status

# View pending operations
zarklink vault pending

# Confirm an issue
zarklink vault confirm-issue <nonce>

# Release ZEC for redeem
zarklink vault release <nonce>

# Submit balance proof
zarklink vault prove-balance

# Manage collateral
zarklink vault deposit <amount>
zarklink vault withdraw <amount>
```

### Relay Commands

```bash
# Submit a block header
zarklink relay submit <height>

# Sync multiple blocks
zarklink relay sync -s <start> -e <end>

# Check relay status
zarklink relay status
```

### Configuration

```bash
# Initialize config interactively
zarklink config init

# Show current config
zarklink config show

# Set a value
zarklink config set <key> <value>

# Set contract addresses
zarklink config contracts --bridge <addr> --relay <addr> --token <addr>
```

## Configuration

Configuration is stored in `~/.zarklink/config.json`. You can also use environment variables:

```bash
# Starknet
STARKNET_RPC_URL=https://starknet-sepolia.g.alchemy.com/...
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...

# Contracts (Sepolia)
BRIDGE_CONTRACT=0x069d135c173847a356aa29a182ace00981e9793aea5bb62bfc6c1d4577e9c36e
RELAY_CONTRACT=0x01ae3dce889773db25632ebed4a04698fb2dff1c71b2101f00e8c0f34b5d7e4b
TOKEN_CONTRACT=0x04c571b6ca21e59add5ccb280eb68a309c6ca4e5eeecfd2186856fe97f74a294
REGISTRY_CONTRACT=0x007abd698ddafea4669ac4d5e96477ef4958b6e6ebd57e4ef2f61df1f2597436

# Zcash
ZCASH_RPC_URL=http://127.0.0.1:8232
ZCASH_RPC_USER=user
ZCASH_RPC_PASSWORD=password
```

## License

MIT
