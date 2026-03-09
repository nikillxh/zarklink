# Zarklink Cairo Contracts

Starknet smart contracts for the Zarklink privacy-preserving bridge, written in Cairo 2.16.0.

## Contracts

| Contract | Purpose |
|----------|---------|
| **WzecToken** | ERC-20 wrapped ZEC token (wZEC) with mint/burn authority |
| **Oracle** | Price oracle providing ZEC/USD feeds for collateral valuation |
| **VaultRegistry** | Vault operator registration and lifecycle management |
| **VaultPool** | Collateral pool — operators deposit wZEC as security bond |
| **ZcashRelay** | Zcash block header relay for SPV verification on-chain |
| **BridgeProtocol** | Core bridge logic — issue requests, confirmations, redemptions |

## Building

```bash
# Requires Scarb 2.16.0
scarb build
```

Compiled Sierra artifacts are output to `target/dev/`.

## Testing

```bash
# Run all 91 contract unit tests
snforge test

# Run tests for a specific contract
snforge test --filter wzec_token
```

## Project Structure

```
contracts/
├── Scarb.toml              # Cairo project manifest
├── src/
│   ├── lib.cairo           # Module declarations
│   ├── wzec_token.cairo    # ERC-20 wZEC
│   ├── oracle.cairo        # Price feeds
│   ├── vault_registry.cairo
│   ├── vault_pool.cairo
│   ├── zcash_relay.cairo   # Header relay
│   └── bridge_protocol.cairo
└── tests/
    └── *.cairo             # Per-contract unit tests
```

## Deployment

Contracts are deployed automatically by `scripts/start-devnet.sh` using the `scripts/deploy.ts` script. Deploy order matters due to cross-contract references:

1. **WzecToken** → standalone
2. **Oracle** → standalone
3. **VaultRegistry** → references WzecToken
4. **ZcashRelay** → standalone
5. **BridgeProtocol** → references WzecToken, VaultRegistry, ZcashRelay, Oracle
6. **VaultPool** → references WzecToken, VaultRegistry

## Toolchain

- **Scarb 2.16.0** — Cairo package manager & build tool
- **snforge** — Cairo test framework (starknet-foundry)
- **starkli** — CLI for Starknet interaction (optional)
