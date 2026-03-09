# Zarklink Integration Tests

End-to-end and per-contract integration tests against the Starknet devnet.

## Running

```bash
# All tests
pnpm test

# Individual suites
pnpm test:wzec       # wZEC token mint/burn/transfer
pnpm test:oracle     # Oracle price feed
pnpm test:relay      # ZcashRelay header submission
pnpm test:registry   # VaultRegistry registration
pnpm test:pool       # VaultPool collateral
pnpm test:e2e        # Full bridge issue/redeem flow
```

## Prerequisites

Tests require a running devnet environment:

```bash
# Start infrastructure first
./scripts/start-devnet.sh

# Then run tests
pnpm test
```

The test runner reads contract addresses and account keys from `.env.devnet`.

## Test Suites

| Suite | Contract | Coverage |
|-------|----------|----------|
| `test:wzec` | WzecToken | mint, burn, transfer, allowance |
| `test:oracle` | Oracle | set_price, get_price, access control |
| `test:relay` | ZcashRelay | submit_header, verify_inclusion |
| `test:registry` | VaultRegistry | register, slash, deregister |
| `test:pool` | VaultPool | deposit, withdraw, liquidate |
| `test:e2e` | BridgeProtocol | Full issue → confirm → redeem flow |

## Configuration

| Variable | Description |
|----------|-------------|
| `STARKNET_RPC_URL` | Devnet RPC endpoint |
| `DEPLOYER_PRIVATE_KEY` | Account with deployed contracts |
| `*_CONTRACT` | Contract addresses (all 6) |
