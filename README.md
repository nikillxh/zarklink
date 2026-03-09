# Zarklink — Privacy-Preserving Zcash Bridge to Starknet

A **trustless, privacy-preserving cross-chain bridge** enabling private transfers between Zcash (Sapling) and Starknet. Built on the [ZCLAIM framework](https://arxiv.org/abs/2204.10611), Zarklink creates a wrapped representation of ZEC (`wZEC`) on Starknet through collateralized, non-trusted intermediary vaults, preserving Zcash's shielded payment guarantees across chains.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Protocol Flow](#protocol-flow)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development Setup](#development-setup)
- [Configuration](#configuration)
- [Scripts Reference](#scripts-reference)
- [Smart Contracts](#smart-contracts)
- [Off-Chain Services](#off-chain-services)
- [Frontend](#frontend)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview

### Key Properties

- **Trustless** — No central authority; vaults are economically incentivized with collateral
- **Privacy-Preserving** — Transfer amounts hidden via zk-SNARKs + splitting strategy across multiple vaults
- **Censorship-Resistant** — Any actor can become a vault by posting collateral
- **Fraud-Provable** — Challenge mechanism with on-chain zk-SNARK verification

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Smart Contracts | Cairo (Starknet) | 2.16.0 |
| Contract Tooling | Scarb | 2.16.0 |
| Contract Testing | Starknet Foundry (snforge) | Latest |
| Off-Chain Services | TypeScript + Node.js | 22.x |
| Frontend | Next.js + React + Tailwind CSS | 16.1.6 / 19 / 4.2 |
| Starknet SDK | starknet.js | 9.4.2 |
| Zcash Node | zcashd (regtest) | 6.x |
| Local Devnet | starknet-devnet-rs | 0.7.0 |
| Package Manager | pnpm (workspace) | 10.x |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         STARKNET (L2)                               │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  BridgeProto  │  │  VaultReg    │  │  VaultPool   │              │
│  │  col          │  │  istry       │  │              │              │
│  │  ─────────── │  │  ─────────── │  │  ─────────── │              │
│  │  request_lock │  │  register    │  │  deposit     │              │
│  │  submit_mint  │  │  deposit     │  │  assign      │              │
│  │  confirm_issue│  │  slash       │  │  encumber    │              │
│  │  submit_burn  │  │  proof_bal   │  │  release     │              │
│  │  confirm_redm │  └──────────────┘  └──────────────┘              │
│  └──────────────┘                                                   │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  ZcashRelay   │  │  wZEC Token  │  │  Oracle      │              │
│  │  ─────────── │  │  (ERC-20)    │  │  (TWAP)      │              │
│  │  submit_hdr   │  │  ─────────── │  │  ─────────── │              │
│  │  verify_incl  │  │  mint / burn │  │  get_rate    │              │
│  │  is_finalized │  │  transfer    │  │  update      │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
        ▲                    ▲                    ▲
        │ block headers      │ events             │ proofs
        │                    │                    │
┌───────┴────────┐  ┌───────┴────────┐  ┌───────┴────────┐
│    Relayer     │  │  Vault Daemon  │  │   Frontend     │
│  (TypeScript)  │  │  (TypeScript)  │  │  (Next.js)     │
│                │  │                │  │                │
│  Zcash → Stk   │  │  Auto-confirm  │  │  Bridge UI     │
│  header relay  │  │  issue/redeem  │  │  Vault mgmt    │
└───────┬────────┘  └───────┬────────┘  └────────────────┘
        │                    │
        ▼                    ▼
┌─────────────────────────────────────────────────────────┐
│                    ZCASH (Sapling)                       │
│                                                         │
│  zcashd regtest — shielded addresses, z_sendmany        │
│  Block production, note commitments, merkle proofs      │
└─────────────────────────────────────────────────────────┘
```

### Protocol Actors

| Actor | Role | Chains |
|-------|------|--------|
| **Issuer** | Locks ZEC on Zcash → mints wZEC on Starknet | Both |
| **Redeemer** | Burns wZEC on Starknet → unlocks ZEC on Zcash | Both |
| **Vault** | Non-trusted custodian; locks collateral, safekeeps ZEC | Both |
| **Relayer** | Submits Zcash block headers to Starknet relay contract | Both |
| **Oracle** | Provides ZEC/STRK exchange rate for collateral | Starknet |

---

## Protocol Flow

### Issue Flow (ZEC → wZEC)

```
Issuer                     Starknet Contracts              Vault Operator
  │                              │                              │
  ├──request_lock(amount)───────►│ VaultPool.assign_request()   │
  │  ◄──(request_id, nonce)──────│                              │
  │                              │                              │
  │  [Lock ZEC to vault's       │                              │
  │   Zcash address]            │                              │
  │                              │                              │
  ├──submit_mint(proof, block)──►│ ZcashRelay.is_finalized()   │
  │                              │ verify inclusion proof        │
  │                              │                              │
  │                              │◄─────confirm_issue()─────────┤
  │                              │ wZEC.mint(issuer, amount)     │
  │                              │                              │
  ▼  Issuer receives wZEC       ▼                              ▼
```

### Redeem Flow (wZEC → ZEC)

```
Redeemer                   Starknet Contracts              Vault Operator
  │                              │                              │
  ├──submit_burn(amount, proof)─►│ wZEC.burn(redeemer, amount)  │
  │  ◄──(request_id)────────────│                              │
  │                              │                              │
  │                              │  [Vault sends ZEC to         │
  │                              │   redeemer's Zcash addr]     │
  │                              │                              │
  │                              │◄─confirm_redeem(proof)───────┤
  │                              │ Release vault collateral      │
  │                              │                              │
  ▼  Redeemer receives ZEC      ▼                              ▼
```

### Privacy Splitting

To prevent amount correlation, Zarklink splits large transfers across multiple vaults (configurable: 1 to 32 splits). Each partial transfer goes through a different vault, making it infeasible to link the cross-chain amounts.

---

## Project Structure

```
neo-zarklink/
├── contracts/                 # Cairo smart contracts (Scarb project)
│   ├── src/
│   │   ├── bridge_protocol.cairo    # Core bridge logic (issue/redeem)
│   │   ├── vault_registry.cairo     # Vault registration & management
│   │   ├── vault_pool.cairo         # Collateral pooling & assignment
│   │   ├── wzec_token.cairo         # wZEC ERC-20 token
│   │   ├── zcash_relay.cairo        # Zcash block header relay
│   │   └── oracle.cairo             # TWAP price oracle
│   ├── tests/                       # Cairo unit tests (91 tests)
│   └── Scarb.toml
│
├── relayer/                   # Zcash → Starknet header relay service
│   └── src/
│       ├── index.ts                 # Entry point
│       ├── config.ts                # Environment config loader
│       ├── header-pipeline.ts       # Block header batching & submission
│       ├── starknet-client.ts       # Starknet contract interaction
│       └── zcash-client.ts          # Zcash RPC client
│
├── vault-daemon/              # Vault operator automation daemon
│   └── src/
│       ├── index.ts                 # Entry point
│       ├── config.ts                # Environment config loader
│       ├── monitor.ts               # Starknet event monitor
│       ├── prover-client.ts         # ZK proof generation
│       └── zcash-ops.ts             # Zcash shielded operations
│
├── cli/                       # Bridge CLI tool
│   └── src/index.ts
│
├── frontend/                  # Next.js web application
│   └── src/
│       ├── app/                     # Pages (dashboard, bridge, vaults, relay)
│       │   └── api/zcash-balance/   # Server-side Zcash balance API route
│       ├── components/              # UI components (Navbar, WalletConnector, etc.)
│       ├── context/                 # React contexts (Account, Wallet)
│       ├── hooks/                   # Contract interaction hooks (auto-refresh)
│       └── lib/                     # Starknet config, ABIs, error utilities
│
├── tests/                     # Integration tests
│
├── scripts/
│   ├── start-devnet.sh              # Infrastructure orchestrator
│   ├── deploy.sh                    # Contract build + deploy wrapper
│   ├── deploy.ts                    # TypeScript deployment script
│   └── install-deps.sh             # Dependency installer
│
├── pnpm-workspace.yaml        # pnpm workspace config
├── package.json               # Root workspace package.json
├── .env.devnet                # Generated environment variables
├── ARCHITECTURE.md            # Detailed technical architecture
└── README.md                  # This file
```

---

## Prerequisites

### Required

| Tool | Version | Installation |
|------|---------|-------------|
| Node.js | >= 22.x | [nodejs.org](https://nodejs.org/) or `nvm install 22` |
| pnpm | >= 10.x | `npm install -g pnpm` |
| Scarb | 2.16.0 | [scarb.swmansion.com](https://docs.swmansion.com/scarb/download.html) |
| starknet-devnet | 0.7.0 | `cargo install starknet-devnet` |
| zcashd | 6.x+ | [zcash.readthedocs.io](https://zcash.readthedocs.io/en/latest/rtd_pages/install_binary_tarball.html) |
| Python | 3.x | `apt install python3` or bundled with OS |

### Optional

| Tool | Purpose | Installation |
|------|---------|-------------|
| snforge | Cairo contract testing | [starknet-foundry](https://foundry-rs.github.io/starknet-foundry/) |
| npm | Alternative package manager | Bundled with Node.js |

---

## Quick Start

### Automated Setup

```bash
# Clone the repository
git clone <repo-url> neo-zarklink && cd neo-zarklink

# Install all dependencies (interactive — choose pnpm or npm)
./scripts/install-deps.sh

# Start everything: chains → deploy → vault setup → relayer → frontend
./scripts/start-devnet.sh --full-stack
```

### Manual Setup

```bash
# 1. Install JavaScript dependencies
pnpm install

# 2. Build Cairo contracts
cd contracts && scarb build && cd ..

# 3. Start infrastructure (Zcash regtest + Starknet devnet)
./scripts/start-devnet.sh

# 4. Deploy contracts
./scripts/start-devnet.sh --deploy

# 5. Set up vault + start off-chain services
./scripts/start-devnet.sh --services

# 6. Start frontend
./scripts/start-devnet.sh --frontend
```

### Verify Everything is Running

```bash
./scripts/start-devnet.sh status
./scripts/start-devnet.sh health
```

---

## Development Setup

### Install Dependencies

```bash
# Using pnpm (recommended)
./scripts/install-deps.sh --pnpm

# Or using npm
./scripts/install-deps.sh --npm

# Or install manually
pnpm install           # JavaScript packages (all workspaces)
cd contracts && scarb build  # Cairo contracts
```

### Start Development Infrastructure

```bash
# Start only the blockchain nodes
./scripts/start-devnet.sh

# Start + deploy contracts
./scripts/start-devnet.sh --deploy

# Start + deploy + frontend
./scripts/start-devnet.sh --deploy --frontend

# Full stack (deploy + vault setup + relayer + vault-daemon + frontend)
./scripts/start-devnet.sh --full-stack

# Stop all services
./scripts/start-devnet.sh stop

# Reset (wipe state and restart)
./scripts/start-devnet.sh reset --full-stack
```

### Development Ports

| Service | Port | URL |
|---------|------|-----|
| Starknet Devnet | 5050 | http://127.0.0.1:5050 |
| Zcash Regtest RPC | 18232 | http://127.0.0.1:18232 |
| Next.js Frontend | 3000 | http://localhost:3000 |

### Devnet Accounts

`start-devnet.sh` creates `NUM_VAULTS + 7` pre-funded Starknet accounts. With the default `NUM_VAULTS=8`, that's **15 accounts**:

| Index | Role | Purpose |
|-------|------|---------|
| 0 | Deployer / Admin | Contract deployment, post-deploy config |
| 1–N | Vault Operators #1–#N | Registered vaults, hold collateral (N = `NUM_VAULTS`, default 8) |
| N+1 | Issuer (Alice) | Locks ZEC → mints wZEC |
| N+2 | Redeemer (Dave) | Burns wZEC → unlocks ZEC |
| N+3 | Relayer Service | Submits Zcash block headers |
| N+4 | Oracle Service | Price feed updates |
| N+5–N+6 | Test Users | Additional test accounts |

**Configuring vault count:**

```bash
# Edit the default at the top of start-devnet.sh
NUM_VAULTS=8   # ← change this value

# Or pass it as a CLI flag
./scripts/start-devnet.sh --vaults 4 --full-stack
```

---

## Configuration

### Environment Files

| File | Purpose | Generated By |
|------|---------|-------------|
| `.env.devnet` | Zcash/Starknet RPC URLs, account keys, contract addresses | `start-devnet.sh` + `deploy.ts` |
| `frontend/.env.local` | Frontend NEXT_PUBLIC_* vars + server-only Zcash RPC creds | `start-devnet.sh` |
| `.devnet/deployments.json` | Full deployment record (addresses, class hashes) | `deploy.ts` |
| `.devnet/starknet-accounts.json` | Predeployed devnet accounts | `start-devnet.sh` |
| `.devnet/zcash-accounts.json` | Zcash test addresses (transparent + shielded) | `start-devnet.sh` |

### Key Environment Variables

```bash
# Starknet
STARKNET_RPC_URL=http://127.0.0.1:5050
DEPLOYER_ADDRESS=0x...
DEPLOYER_PRIVATE_KEY=0x...

# Zcash
ZCASH_RPC_URL=http://127.0.0.1:18232
ZCASH_RPC_USER=zarklink
ZCASH_RPC_PASS=<auto-generated>

# Contract Addresses (set by deploy.ts)
BRIDGE_PROTOCOL_ADDRESS=0x...
VAULT_REGISTRY_ADDRESS=0x...
VAULT_POOL_ADDRESS=0x...
ZCASH_RELAY_ADDRESS=0x...
WZEC_TOKEN_ADDRESS=0x...
ORACLE_ADDRESS=0x...

# Service-compatible aliases (used by relayer & vault-daemon)
ZCASH_RELAY_CONTRACT=0x...
BRIDGE_PROTOCOL_CONTRACT=0x...
VAULT_REGISTRY_CONTRACT=0x...
VAULT_POOL_CONTRACT=0x...
WZEC_TOKEN_CONTRACT=0x...

# Frontend server-only (for API routes, NOT NEXT_PUBLIC_)
ZCASH_RPC_USER=zarklink
ZCASH_RPC_PASS=<auto-generated>
```

---

## Scripts Reference

### `scripts/start-devnet.sh`

Main infrastructure orchestrator.

```bash
./scripts/start-devnet.sh {start|stop|status|reset|health} [flags]

Commands:
  start    Start Zcash regtest + Starknet devnet (default)
  stop     Stop all services
  status   Show service status table
  reset    Wipe state and restart
  health   Run health checks

Flags:
  --deploy      Build and deploy Cairo contracts
  --frontend    Start Next.js dev server on port 3000
  --services    Register vault, start relayer & vault-daemon
  --full-stack  Equivalent to --deploy --frontend --services
  --vaults N    Number of vault operators (default: 8)
```

### `scripts/deploy.sh`

Contract build and deployment.

```bash
./scripts/deploy.sh {build|deploy|all}

  build    Compile Cairo contracts with scarb
  deploy   Deploy to devnet (assumes already built)
  all      Build + deploy (default)
```

### `scripts/install-deps.sh`

System dependency checker and JavaScript package installer.

```bash
./scripts/install-deps.sh [--pnpm|--npm]

  --pnpm   Use pnpm (skip prompt)
  --npm    Use npm (skip prompt)
  (none)   Interactive prompt
```

---

## Smart Contracts

Six Cairo contracts in `contracts/src/`, compiled with Scarb 2.16.0.

### BridgeProtocol (`bridge_protocol.cairo`)

Core bridge logic implementing the ZCLAIM protocol.

| Function | Description |
|----------|-------------|
| `request_lock(mint_amount, warranty_collateral)` | Start issue: assigns vault, creates request |
| `submit_mint(request_id, proof, block_height, ...)` | Submit ZEC lock proof for minting |
| `confirm_issue(request_id)` | Vault confirms issue → mints wZEC |
| `submit_burn(commitment, amount, warranty, proof)` | Start redeem: burns wZEC |
| `confirm_redeem(request_id, proof, block_height)` | Vault confirms redeem → releases collateral |
| `challenge_issue / challenge_redeem` | Fraud proof submission |
| `expire_issue / expire_redeem` | Timeout handling |

### VaultRegistry (`vault_registry.cairo`)

Vault registration and lifecycle management.

| Function | Description |
|----------|-------------|
| `register_vault(zcash_addr_d, zcash_addr_pkd)` | Register as a vault operator |
| `deposit_collateral(amount)` | Deposit wZEC collateral |
| `submit_proof_of_balance(proof)` | Submit periodic solvency proof |
| `slash_vault(vault_id, amount)` | Slash misbehaving vault |

### VaultPool (`vault_pool.cairo`)

Collateral pooling and request assignment.

| Function | Description |
|----------|-------------|
| `deposit_collateral(amount)` | Deposit into pool |
| `assign_request(request_id)` | Assign a vault to a bridge request |
| `encumber / release_encumbrance` | Lock/unlock vault collateral |

### ZcashRelay (`zcash_relay.cairo`)

Zcash block header relay for cross-chain verification.

| Function | Description |
|----------|-------------|
| `submit_header(header)` | Submit a single block header |
| `submit_headers_batch(headers)` | Batch header submission |
| `verify_inclusion(commitment, path, height)` | Verify note in a block |
| `is_finalized(block_height)` | Check if block has enough confirmations |

### WzecToken (`wzec_token.cairo`)

ERC-20 wrapped ZEC token. Only the BridgeProtocol can mint/burn.

### Oracle (`oracle.cairo`)

TWAP price oracle with circuit breaker for collateral calculations.

### Running Contract Tests

```bash
cd contracts
snforge test        # Run all 91 tests
snforge test -f vault  # Filter tests by name
```

---

## Off-Chain Services

### Relayer (`relayer/`)

Bridges Zcash block headers to Starknet by polling zcashd and submitting headers in batches.

```bash
# Start in development mode
pnpm -C relayer dev

# Configuration (via .env.devnet)
ZCASH_RELAY_CONTRACT=0x...    # ZcashRelay contract address
RELAYER_PRIVATE_KEY=0x...     # Starknet account key
RELAY_POLL_INTERVAL_MS=5000   # Polling interval
RELAY_BATCH_SIZE=10           # Headers per batch
```

### Vault Daemon (`vault-daemon/`)

Automates vault operations: monitors bridge events and auto-confirms issue/redeem requests.

```bash
# Start in development mode
pnpm -C vault-daemon dev

# Configuration (via .env.devnet)
BRIDGE_PROTOCOL_CONTRACT=0x...
VAULT_REGISTRY_CONTRACT=0x...
VAULT_POOL_CONTRACT=0x...
VAULT_PRIVATE_KEY=0x...
VAULT_AUTO_CONFIRM=true
VAULT_POLL_INTERVAL_MS=3000
```

---

## Frontend

Next.js 16.1.6 web application with React 19 and Tailwind CSS 4.

### Pages

| Route | Description |
|-------|-------------|
| `/` | Dashboard — bridge stats, relay status, pool info |
| `/bridge` | Issue (ZEC → wZEC) and Redeem (wZEC → ZEC) with devnet auto-completion |
| `/vaults` | Vault registry browser (auto-refreshes every 15s) |
| `/relay` | Zcash header relay status |
| `/api/zcash-balance` | Server-side API route — proxies zcashd RPC for balance queries |

### Bridge Page Features

- **Balance Display**: Shows both wZEC (Starknet) and ZEC (Zcash) balances side-by-side
- **Devnet Auto-Completion**: Executes full multi-step protocol (Issue: 3 steps, Redeem: 2 steps)
- **Pre-Submit Validation**: Checks wZEC balance before redeem, prevents insufficient balance errors
- **Max Button**: Pre-fills the redeem amount input with your full wZEC balance
- **Step-by-Step Status**: Displays progress messages during multi-step flows
- **Friendly Errors**: Decodes hex contract errors into human-readable messages with hints
- **Auto-Refresh**: Balances and contract data refresh on configurable intervals

### Wallet Connection

The frontend supports two wallet modes:

1. **Devnet Mode** — Pre-funded accounts from starknet-devnet (default for local dev)
2. **Browser Wallet** — ArgentX or Braavos browser extension

Switch between modes using the wallet connector in the navbar.

### Development

```bash
# Start frontend dev server
pnpm -C frontend dev

# Build for production
pnpm -C frontend build

# The frontend reads contract addresses from frontend/.env.local
# which is auto-generated by start-devnet.sh
```

> **Note:** The frontend uses Next.js API routes (for the Zcash balance proxy),
> which requires server-side rendering. The `output: "export"` option must NOT
> be set in `next.config.mjs`.

---

## Testing

### Cairo Contract Tests

```bash
cd contracts
snforge test                    # All 91 tests
snforge test --exact bridge     # Bridge protocol tests only
```

### Integration Tests

```bash
# Ensure devnet is running with deployed contracts
./scripts/start-devnet.sh --deploy

# Run integration tests
pnpm -C tests test
```

### Manual Testing

1. Start the full stack: `./scripts/start-devnet.sh --full-stack`
2. Open http://localhost:3000
3. Go to **Bridge** tab
4. Select **Issuer (Alice)** from the wallet dropdown (account #9 with default 8 vaults)
5. Enter an amount (e.g. `0.5`) and click **Issue wZEC**
6. Watch the step-by-step status: request_lock → submit_mint → confirm_issue
7. Your wZEC and ZEC balances update automatically after completion
8. Switch to **Redeem** tab, click **Max** to fill your wZEC balance, click **Redeem ZEC**
9. Watch the step-by-step status: submit_burn → confirm_redeem
10. Go to **Vaults** tab to see collateral and issued/redeemed amounts update (auto-refreshes)

> **Note:** On devnet, the frontend auto-completes all protocol steps (including vault
> operator confirmations) without needing the vault daemon. See
> [ARCHITECTURE.md §12.7](ARCHITECTURE.md) for details.

---

## Troubleshooting

### Common Issues

**"No active vaults in pool"**
```
The bridge requires at least one registered vault with deposited collateral.
Run: ./scripts/start-devnet.sh --services
This registers vault operator (account #1) and deposits collateral.
```

**"Contract not found" errors in frontend**
```
Contracts aren't deployed. Run:
./scripts/start-devnet.sh --deploy
Then restart the frontend so it picks up the new .env.local
```

**Bridge operations timing out**
```
The relayer must be running to submit Zcash block headers.
The vault daemon must be running to auto-confirm requests.
Run: ./scripts/start-devnet.sh --services
```

**pnpm install fails with build script warnings**
```
This is normal. The root package.json has pnpm.onlyBuiltDependencies
configured for esbuild, sharp, and unrs-resolver.
Run: pnpm install (it will handle build scripts automatically)
```

**zcashd fails to start**
```
Ensure zcashd is installed and ~/.zcash-params exists.
With zcashd v6+, Sapling params are bundled.
Run: mkdir -p ~/.zcash-params
```

**Frontend shows empty data**
```
1. Check starknet-devnet is running: curl http://127.0.0.1:5050/is_alive
2. Check contracts are deployed: ls .devnet/deployments.json
3. Check frontend/.env.local has contract addresses
4. Restart the dev server after deploying
```

**"Insufficient wZEC balance" on redeem**
```
You're trying to redeem from an account with no wZEC.
1. Check the account selector — ensure you're using the account that received wZEC
2. The balance is shown on the Bridge page (wZEC and ZEC display)
3. Issue some wZEC first, then switch to the Redeem tab
```

**Zcash balance shows "—" on bridge page**
```
The Zcash balance API route cannot reach zcashd.
1. Check zcashd is running: zcash-cli -datadir=.devnet/zcash getinfo
2. Check frontend/.env.local has ZCASH_RPC_USER and ZCASH_RPC_PASS
3. Restart the frontend after updating .env.local
```

### Logs

All service logs are in `.devnet/logs/`:
- `zcashd-stderr.log` — Zcash regtest node
- `starknet-devnet.log` — Starknet devnet
- `frontend.log` — Next.js dev server
- `relayer.log` — Zcash header relayer
- `vault-daemon.log` — Vault operator daemon

### Useful Commands

```bash
# Check zcash block count
zcash-cli -datadir=.devnet/zcash -rpcport=18232 getblockcount

# Check starknet devnet health
curl http://127.0.0.1:5050/is_alive

# Check deployed contracts
cat .devnet/deployments.json | python3 -m json.tool

# View service status
./scripts/start-devnet.sh status

# View recent relay logs
tail -50 .devnet/logs/relayer.log

# Query on-chain vault count (requires starknet.js available)
node -e "
const { RpcProvider } = require('starknet');
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('.devnet/deployments.json','utf8'));
const p = new RpcProvider({ nodeUrl: 'http://127.0.0.1:5050' });
p.callContract({ contractAddress: d.contracts.vault_registry.address,
  entrypoint: 'get_vault_count', calldata: [] })
.then(r => console.log('Vault count:', Number(r[0])));
"
```

---

## Developer Notes

Key technical details for anyone modifying the codebase. See
[ARCHITECTURE.md](ARCHITECTURE.md) §12 for the full list.

### VaultStatus Enum (Cairo)

```
0 = Inactive (default)
1 = Active
2 = Locked
3 = Suspended
4 = Liquidated
```

The frontend's `vaultStatusLabel()` in `frontend/src/lib/starknet.ts` must match
these indices exactly. If you add variants to the Cairo enum, update front end.

The vaults page filters by `status === 1` (Active) — not `status === 0`.

### Vault Data (u256 = 2 felts)

When reading vaults via raw RPC (`callContract`), u256 fields occupy **two felt
slots** (low + high). But `Contract.call()` with an ABI auto-decodes u256 → BigInt,
so the frontend sees 10 decoded fields (not 13 raw felts). See ARCHITECTURE.md §12.2.

### Vault IDs are 0-indexed

On-chain vault IDs start at 0. The frontend adds 1 for display (`id: i + 1`).

### Collateral Deposits

Collateral must be deposited to **both** VaultRegistry (for display/status) and
VaultPool (for pool accounting). The devnet setup script handles both.

### Environment Reloading

Next.js reads `.env.local` only at startup. After redeploying, restart the
frontend. The `start-devnet.sh` script does this automatically.

### Auto-Refresh Intervals

Contract data hooks accept an optional `refreshMs` parameter:
- `useVaultList(15000)` — vaults page, every 15s
- `usePoolStats(15000)` — vaults page, every 15s
- `usePoolStats(10000)` — bridge page, every 10s
- `useWzecBalance(addr, 8000)` — bridge page, every 8s
- `useZcashBalance(addr, 15000)` — bridge page, every 15s
- `useRelayStats(10000)` — relay & dashboard pages, every 10s

Set to `0` (default) for one-shot fetch with no polling.

### Devnet Auto-Completion

On devnet, the bridge page completes the full multi-step protocol client-side,
acting as both the user and the vault operator. This eliminates the need for a
running vault daemon during local development. The vault operator account is
determined by `devnetAccounts[vault_id + 1]`. See ARCHITECTURE.md §12.7–12.8
for technical details including the "finalized block trick".

### Error Handling

Cairo contract reverts return hex-encoded felt252 error strings. The frontend's
`decodeContractError()` and `friendlyTxError()` utilities in `lib/starknet.ts`
decode these into readable messages with actionable hints. See ARCHITECTURE.md §12.10.

---

## License

This project is for educational and research purposes. See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed technical documentation.
