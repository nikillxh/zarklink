# Zarklink: Privacy-Preserving Zcash Bridge to Starknet

## Technical Architecture — Phase 1

> Based on the ZCLAIM framework ("Bridging Sapling: Private Cross-Chain Transfers",
> Sanchez et al., 2022 — arXiv:2204.10611), adapted for Zcash ↔ Starknet.

---

## 1. Executive Summary

Zarklink is a **trustless cross-chain bridge** enabling **private transfers** between
Zcash (Sapling) and Starknet. It creates a wrapped representation of ZEC (`wZEC`)
on Starknet through a set of **collateralized, non-trusted intermediary vaults**,
preserving Zcash's shielded payment guarantees across chains.

**Key Properties:**
- **Trustless**: No central authority; vaults are economically incentivized
- **Privacy-preserving**: Transfer amounts hidden via zk-SNARKs + splitting strategy
- **Censorship-resistant**: Any actor can become a vault by posting collateral
- **Fraud-provable**: Challenge mechanism with on-chain zk-SNARK verification

---

## 2. Protocol Actors

| Actor | Role | Chains |
|-------|------|--------|
| **Issuer** | Locks ZEC on Zcash → mints wZEC on Starknet | Both |
| **Redeemer** | Burns wZEC on Starknet → unlocks ZEC on Zcash | Both |
| **Vault** | Non-trusted custodian; locks collateral on Starknet, safekeeps ZEC | Both |
| **Relayer** | Submits Zcash block headers to the Starknet relay contract | Both |
| **Oracle** | Provides ZEC/STRK exchange rate for collateral calculations | Starknet |

---

## 3. On-Chain Components (Starknet — Cairo Contracts)

### 3.1 Vault Registry (`vault_registry.cairo`)

Maintains a public registry of all active vaults.

**State per Vault:**
- `vault_id: felt252` — unique identifier
- `starknet_address: ContractAddress` — vault operator's Starknet account
- `zcash_shielded_addr: (d, pk_d)` — vault's Zcash Sapling payment address
- `collateral_amount: u256` — locked STRK/ETH collateral on Starknet
- `status: VaultStatus` — {Inactive (0, default), Active (1), Locked (2), Suspended (3), Liquidated (4)}
- `last_proof_of_balance: u64` — block at which last PoB was submitted
- `last_proof_of_capacity: u64` — block at which last PoC was submitted

**Key Operations:**
- `register_vault(zcash_addr, collateral)` — register and lock collateral
- `submit_proof_of_capacity(proof)` — zk-SNARK proving collateral ≥ v_max × σ_std × xr
- `submit_proof_of_balance(proof)` — periodic proof that ZEC obligations are backed
- `submit_proof_of_insolvency(proof)` — opt out of redeem requests
- `slash_vault(vault_id, amount)` — liquidate collateral on misbehavior
- `withdraw_collateral(amount)` — withdraw excess, subject to balance check

**Collateral Invariant:**
```
i_col ≥ v_max × (1 − f) × σ_std × xr_cap
```
Where:
- `v_max` = max lockable per request
- `f` = protocol fee rate
- `σ_std` = standard collateralization rate (e.g., 150%)
- `xr_cap` = exchange rate at proof time

### 3.2 Relay System (`zcash_relay.cairo`)

A Zcash light client on Starknet that verifies block headers and enables
note inclusion proofs.

**Responsibilities:**
- Verify and store Zcash Equihash PoW block headers
- Track chain tip with configurable finality depth (k ≥ 24 blocks)
- Verify Merkle inclusion proofs for note commitments against stored roots
- Prevent chain relay poisoning via multi-relayer consensus

**State:**
- `headers: Map<u32, BlockHeader>` — block height → verified header
- `chain_tip: u32` — current highest finalized block
- `finality_depth: u32` — number of confirmations required (default: 24)

**Key Operations:**
- `submit_headers(headers: Array<BlockHeader>)` — batch header submission
- `verify_inclusion(note_cm, merkle_path, block_height) → bool`
- `get_finalized_root(block_height) → felt252`

### 3.3 Protocol Logic (`bridge_protocol.cairo`)

The core Issue/Redeem state machine.

**Issue States:** `IssueStart → AwaitingMint → AwaitIssueConfirm → IssueSuccess | IssueChallenged`
**Redeem States:** `RedeemStart → AwaitRedeemConfirm → RedeemSuccess | RedeemChallenged`

**Key Operations:**
- `request_lock(vault_id, warranty_collateral) → lock_permit`
- `mint(inclusion_proof, zk_proof, note_ciphertext) → pending_tx`
- `confirm_issue(request_id)` — vault confirms
- `challenge_issue(request_id, shared_secret, zk_proof)` — vault challenges
- `burn(amount, note_commitment, zk_proof, note_ciphertext, warranty) → pending_tx`
- `confirm_redeem(request_id, inclusion_proof)` — vault confirms release
- `challenge_redeem(request_id, shared_secret, zk_proof)` — vault challenges

**Timeouts:**
- `Δ_mint` — issuer must submit mint within this window after lock permit
- `Δ_confirm_issue` — vault must confirm/challenge within this window
- `Δ_confirm_redeem` — vault must release and prove within this window

### 3.4 wZEC Token (`wzec_token.cairo`)

ERC-20-compatible shielded token on Starknet (SNIP-2 standard).

**Extensions:**
- `mint(to, amount)` — only callable by protocol logic after issue confirmation
- `burn(from, amount)` — only callable by protocol logic during redeem
- Standard `transfer`, `approve`, `transferFrom` for DeFi composability

### 3.5 Exchange Rate Oracle (`oracle.cairo`)

Provides ZEC/STRK price feed for collateral calculations.

- Aggregates from multiple sources (Pragma Oracle / custom feeds)
- Implements TWAP (time-weighted average price) for manipulation resistance
- Emergency circuit breaker for extreme deviations

---

## 4. Off-Chain Components

### 4.1 Relayer Service (`relayer/`)

**Language:** TypeScript/Rust
**Responsibilities:**
- Run Zcash full node (or connect to lightwalletd)
- Monitor new blocks and extract headers
- Batch-submit headers to `zcash_relay.cairo`
- Monitor for reorgs and submit corrective data

**Architecture:**
```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Zcash Node     │────▶│  Relayer Service  │────▶│  Starknet RPC    │
│  (zcashd/zebra) │     │  (header relay)   │     │  (relay contract)│
└─────────────────┘     └──────────────────┘     └──────────────────┘
```

### 4.2 Vault Daemon (`vault-daemon/`)

**Language:** TypeScript/Rust
**Responsibilities:**
- Monitor Starknet contracts for lock requests, burn requests
- Decrypt note ciphertexts using vault's Zcash spending key
- Validate notes and submit confirm/challenge transactions
- Manage Zcash shielded transactions (create notes for redeemers)
- Periodically submit proofs of balance/capacity
- Auto-generate zk-SNARKs for challenge responses

### 4.3 ZK Proof Generator (`prover/`)

**Language:** Rust (using bellman/halo2 for Groth16 circuits)
**Circuits:**
1. **MintProof** — proves note exists on Zcash, value matches, nonce derived from permit
2. **BurnProof** — proves note commitment matches burn value
3. **ChallengeProof** — proves encryption was incorrect (reveals shared secret)
4. **ProofOfCapacity** — proves collateral ≥ required ratio
5. **ProofOfBalance** — proves ZEC obligations properly backed
6. **ProofOfInsolvency** — proves vault holds no ZEC obligations

### 4.4 CLI Client (`cli/`)

**Language:** TypeScript
**Commands:**
```
zarklink vault register    — Register as a vault operator
zarklink vault status      — Check vault health and collateral
zarklink issue <amount>    — Lock ZEC and mint wZEC (with auto-splitting)
zarklink redeem <amount>   — Burn wZEC and unlock ZEC (with auto-splitting)
zarklink status <tx_id>    — Check bridge transaction status
zarklink relayer start     — Start the relayer service
zarklink oracle update     — Force an oracle price update
```

---

## 5. Privacy Mechanisms

### 5.1 Splitting Strategy

To prevent vaults from inferring total transfer amounts, users split their
transfers among `k` vaults (e.g., k = 16).

**Algorithm:**
1. Restrict piece sizes to 0 or powers of 2
2. For small amounts (v_tot ∈ [1, 2^m − 1]):
   - Compute e = max{1, 2^(⌊log₂(v_tot)⌋ + 1 − k/2)}
   - Randomize split with uniform integer i ∈ [0, e⌊v_tot/e⌋]
   - Decompose into powers-of-2 pieces, pad with zeros
3. For large amounts (v_tot ∈ [2^m + 1, 2^h − 1]):
   - Assign d = ⌊v_tot/2^m⌋ − 1 pieces of max size
   - Split remainder similarly with randomization

**Privacy Guarantee (Theorem V.4):** For any piece received by a vault,
the posterior probability of the total amount is bounded by a constant
factor of the prior, meaning no vault gains significant information.

### 5.2 Note Encryption

- Issuers encrypt note values to vault's Zcash payment address
- Symmetric encryption using Zcash's in-band secret distribution
- Vaults can challenge if decryption fails (proving shared secret in ZK)

### 5.3 Shielded Transfers on Starknet

- Mint/Burn transfers use zk-SNARKs to prove value matching
- Note commitments are added to an on-chain commitment tree
- Nullifiers prevent double-spending of wZEC

---

## 6. Security Model

### 6.1 Threat Vectors & Mitigations

| Attack | Description | Mitigation |
|--------|-------------|------------|
| **Inference Attack** | Vault deduces total from piece amounts | Splitting strategy (§5.1) with k ≥ 16 vaults |
| **Chain Relay Poisoning** | Adversary triggers Zcash reorg | Finality depth k ≥ 24; multi-relayer redundancy |
| **Exchange Rate Manipulation** | Oracle provides false ZEC/STRK rate | TWAP aggregation; circuit breaker; multi-source |
| **Replay Attack** | Reuse inclusion proof to mint twice | Lock permit nonce derives note commitment trapdoor |
| **Counterfeiting** | Minting unbacked wZEC | Periodic proofs of balance; automatic liquidation |
| **Encryption Fraud** | Issuer sends wrong ciphertext to vault | Challenge mechanism with shared-secret ZK proof |
| **Vault Griefing** | Spam lock requests to exhaust vault capacity | Warranty collateral required for all requests |
| **Sudden Devaluation** | ZEC crashes, collateral becomes insufficient | Over-collateralization (σ_std = 150%); auto-liquidation |

### 6.2 Collateralization

- Vaults must maintain collateral ≥ 150% of ZEC obligations (at current exchange rate)
- If collateral drops below 120%, partial liquidation is triggered
- If vault fails to submit proof of balance within deadline, full liquidation

---

## 7. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Starknet Contracts** | Cairo 2.x (Scarb) | On-chain logic, token, registry, relay |
| **ZK Circuits** | Rust + bellman/halo2 | Groth16 proofs for privacy-critical operations |
| **Relayer** | TypeScript + starknet.js | Block header submission pipeline |
| **Vault Daemon** | TypeScript + zcash-lib | Automated vault operations |
| **CLI** | TypeScript + Commander.js | User-facing bridge interaction |
| **Frontend** | Next.js 16 + TailwindCSS 4 | Modern bridge UI with API routes |
| **Local Dev** | Katana (Starknet devnet) + zcashd (regtest) | Local testing infrastructure |
| **Oracle** | Pragma Oracle (Starknet-native) | Price feeds |

---

## 8. Project Structure

```
neo-zarklink/
├── contracts/                     # Cairo smart contracts (Scarb 2.16.0)
│   ├── src/
│   │   ├── lib.cairo              # Module root — declares all contract modules
│   │   ├── bridge_protocol.cairo  # Issue/Redeem state machine + challenge logic
│   │   ├── vault_registry.cairo   # Vault registration, collateral, lifecycle
│   │   ├── vault_pool.cairo       # Pooled collateral & request assignment
│   │   ├── wzec_token.cairo       # wZEC ERC-20 token (mint/burn restricted)
│   │   ├── zcash_relay.cairo      # Zcash block header relay (light client)
│   │   └── oracle.cairo           # TWAP exchange rate oracle
│   ├── tests/                     # Cairo unit tests (91 tests)
│   │   ├── test_bridge_protocol.cairo
│   │   ├── test_vault_registry.cairo
│   │   ├── test_vault_pool.cairo
│   │   ├── test_wzec_token.cairo
│   │   ├── test_zcash_relay.cairo
│   │   └── test_oracle.cairo
│   └── Scarb.toml
│
├── frontend/                      # Next.js 16 web application
│   └── src/
│       ├── app/                   # Page routes
│       │   ├── page.tsx           # / — Dashboard (bridge stats, relay, pool)
│       │   ├── layout.tsx         # Root layout (Navbar, Footer, providers)
│       │   ├── bridge/page.tsx    # /bridge — Issue & Redeem with devnet auto-completion
│       │   ├── vaults/page.tsx    # /vaults — Vault registry browser (auto-refresh)
│       │   ├── relay/page.tsx     # /relay — Zcash header relay status
│       │   ├── dev/page.tsx       # /dev — Dev tools (Zcash, Starknet, simulations)
│       │   ├── docs/page.tsx      # /docs — In-app protocol documentation
│       │   ├── api/
│       │   │   ├── zcash-balance/
│       │   │   │   └── route.ts   # GET /api/zcash-balance — proxies zcashd RPC
│       │   │   └── dev/
│       │   │       └── route.ts   # POST /api/dev — dev tools (mine, fund, etc.)
│       │   ├── globals.css        # Tailwind CSS 4 + custom theme
│       │   └── not-found.tsx      # 404 page
│       ├── components/
│       │   ├── Navbar.tsx         # Top navigation with wallet connector
│       │   ├── WalletConnector.tsx # Account selector (devnet/browser wallet)
│       │   ├── StatCard.tsx       # Reusable stats display card
│       │   └── Footer.tsx         # Page footer
│       ├── context/
│       │   ├── AccountContext.tsx  # Manages selected devnet account state
│       │   └── WalletContext.tsx   # Wallet connection provider
│       ├── hooks/
│       │   └── useStarknet.ts     # All contract read hooks (auto-refresh support)
│       └── lib/
│           └── starknet.ts        # Provider config, ABIs, error utilities
│
├── relayer/                       # Zcash → Starknet header relay service
│   └── src/
│       ├── index.ts               # Service entry point
│       ├── config.ts              # Loads .env.devnet config
│       ├── header-pipeline.ts     # Batches & submits block headers
│       ├── starknet-client.ts     # Starknet contract interaction
│       └── zcash-client.ts        # Zcash RPC client (getblock, etc.)
│
├── vault-daemon/                  # Vault operator automation daemon
│   └── src/
│       ├── index.ts               # Service entry point
│       ├── config.ts              # Loads .env.devnet config
│       ├── monitor.ts             # Polls Starknet events for bridge requests
│       ├── prover-client.ts       # ZK proof generation stub
│       └── zcash-ops.ts           # Zcash shielded transaction management
│
├── cli/                           # Bridge CLI tool
│   └── src/
│       ├── index.ts               # Commander.js entry point
│       ├── commands/
│       │   ├── issue.ts           # zarklink issue <amount>
│       │   ├── redeem.ts          # zarklink redeem <amount>
│       │   ├── vault.ts           # zarklink vault register|status
│       │   ├── status.ts          # zarklink status <tx_id>
│       │   └── relayer.ts         # zarklink relayer start
│       ├── splitter.ts            # Privacy splitting algorithm (powers-of-2)
│       └── utils.ts               # Shared helpers
│
├── tests/                         # Integration tests (TypeScript)
│   └── src/
│       ├── run-all.ts             # Test runner
│       ├── harness.ts             # Test infrastructure setup
│       ├── test-e2e-flow.ts       # End-to-end issue/redeem flow
│       ├── test-registry.ts       # VaultRegistry integration tests
│       ├── test-pool.ts           # VaultPool integration tests
│       ├── test-relay.ts          # ZcashRelay integration tests
│       ├── test-wzec.ts           # wZEC token integration tests
│       └── test-oracle.ts         # Oracle integration tests
│
├── scripts/
│   ├── start-devnet.sh            # Full infrastructure orchestrator (~1400 lines)
│   ├── deploy.sh                  # Scarb build + deploy wrapper (bash)
│   ├── deploy.ts                  # TypeScript deployment script (starknet.js)
│   └── install-deps.sh            # Dependency installer (interactive)
│
├── .devnet/                       # Generated at runtime (gitignored)
│   ├── deployments.json           # Contract addresses + class hashes
│   ├── accounts.json              # Combined Starknet + Zcash accounts
│   ├── starknet-accounts-labeled.json
│   ├── zcash-accounts.json
│   └── logs/                      # Service log files
│
├── pnpm-workspace.yaml            # pnpm workspace: frontend, relayer, etc.
├── package.json                   # Root workspace config
├── .env.devnet                    # Auto-generated env vars (all services)
├── ARCHITECTURE.md                # This file — detailed technical docs
└── README.md                      # Quick start, usage, troubleshooting
```

---

## 9. Color Scheme (from Logo)

Extracted from the Zarklink logo (Z with blue-green gradient glow):

| Token | Hex | Usage |
|-------|-----|-------|
| `--color-primary` | `#00D4AA` | Primary brand / CTAs / accents |
| `--color-primary-blue` | `#2979FF` | Gradient start, Zcash-side indicators |
| `--color-primary-green` | `#00E676` | Gradient end, Starknet-side indicators |
| `--color-bg-dark` | `#0A0E1A` | Background |
| `--color-bg-card` | `#111827` | Card/panel backgrounds |
| `--color-bg-elevated` | `#1F2937` | Elevated surfaces |
| `--color-text-primary` | `#F9FAFB` | Primary text |
| `--color-text-secondary` | `#9CA3AF` | Secondary/muted text |
| `--color-danger` | `#EF4444` | Errors, slashing indicators |
| `--color-warning` | `#F59E0B` | Warnings, low collateral |
| `--color-success` | `#10B981` | Success states |

---

## 10. Starknet-Specific Optimizations

Beyond the base ZCLAIM paper, we leverage Starknet's unique capabilities:

1. **Native Account Abstraction**: Vault operators can use smart contract wallets
   with custom validation logic (e.g., multi-sig for high-value vaults).

2. **STARK-Friendly Hashing**: Use Poseidon hash for on-chain commitment trees
   (native to Cairo, ~100x cheaper than Pedersen for verification).

3. **Storage Proofs**: Starknet's upcoming storage proof verifiers could eliminate
   the need for a separate oracle in some cases.

4. **Recursive Proofs**: Batch multiple header verifications into a single STARK
   proof for gas optimization.

5. **Appchain Option**: For extreme throughput, the bridge logic could be deployed
   as a Starknet appchain (Madara) with custom block times.

---

## 11. Adopted Architecture Enhancements

The following enhancements have been selected and will be implemented:

### 11.1 ✅ STARK-based Proofs (Cairo-Native)

Instead of Groth16 zk-SNARKs from the paper, all proof circuits are implemented
as **Cairo programs** verified natively by the Starknet OS:

- **No trusted setup** — STARKs are transparent, eliminating ceremony risk
- **Native verification** — proofs verified as part of Starknet's own validity proofs
- **Cairo provability** — all proof logic written in Cairo, compiled to Sierra/CASM
- **Recursive composition** — batch multiple verifications into a single proof

**Impact on components:**
- `prover/` directory uses Cairo instead of Rust+bellman
- Proof circuits are Cairo programs generating execution traces
- Verification is implicit (Starknet validates the entire state transition)
- Challenge proofs become Cairo functions callable on-chain

### 11.2 ✅ Vault Pool Model

Instead of individual vault selection (which leaks information), liquidity is
**pooled** and requests are assigned via **on-chain verifiable randomness**:

- **Pooled Liquidity**: Vaults deposit into a shared pool contract
- **Random Assignment**: VRF-based assignment of requests to vaults
- **Privacy Gain**: No vault selection signal; observers can't link issuer to vault
- **Capital Efficiency**: Fragmented collateral is aggregated, reducing over-collateralization
- **Auto-Rebalancing**: Pool automatically distributes ZEC obligations across vaults

**New contract: `vault_pool.cairo`**
```
- deposit_collateral(amount) — vault adds to pool
- withdraw_collateral(amount) — vault removes (if not encumbered)
- assign_request(request_id) → vault_id — VRF-based assignment
- get_pool_capacity() → u256 — total available capacity
```

### 11.3 Future Considerations (Not Yet Implemented)

- **Dual Bridge Mode** — shielded + express mode (lower latency, less privacy)
- **MEV Protection** — commit-reveal for redeem requests
- **Herodotus Storage Proofs** — direct Zcash state verification via L1 anchors

---

## 12. Implementation Notes

Critical technical details for developers working on the codebase.

### 12.1 Cairo VaultStatus Enum Mapping

The `VaultStatus` enum in Cairo has **5 variants** with these discriminants:

```cairo
pub enum VaultStatus {
    #[default]
    Inactive,     // 0 — newly created, not yet active
    Active,       // 1 — registered and collateral deposited
    Locked,       // 2 — collateral locked during bridge operation
    Suspended,    // 3 — failed proof requirements
    Liquidated,   // 4 — collateral slashed
}
```

The frontend `vaultStatusLabel()` in `frontend/src/lib/starknet.ts` must match
these exact indices. Enum variant 0 is `Inactive` (the `#[default]`), NOT `Active`.

### 12.2 VaultInfo Serde Serialization

Cairo's `Serde` trait serializes `u256` as **two felts** (low, high). When reading
vault data via raw `provider.callContract()`, the felt indices are:

| Index | Field | Type | Notes |
|-------|-------|------|-------|
| 0 | owner | ContractAddress | 1 felt |
| 1 | zcash_addr_d | felt252 | 1 felt |
| 2 | zcash_addr_pkd | felt252 | 1 felt |
| 3 | collateral (low) | u256 | 2 felts |
| 4 | collateral (high) | | |
| 5 | status | u8 (VaultStatus) | 1 felt |
| 6 | last_proof_of_balance | u64 | 1 felt |
| 7 | last_proof_of_capacity | u64 | 1 felt |
| 8 | registered_at | u64 | 1 felt |
| 9 | total_issued (low) | u256 | 2 felts |
| 10 | total_issued (high) | | |
| 11 | total_redeemed (low) | u256 | 2 felts |
| 12 | total_redeemed (high) | | |

**However**, when using `Contract.call()` with a proper ABI (as the frontend does),
starknet.js v9 auto-decodes u256 into a single BigInt. So the decoded indices are:

| Index | Field | Decoded Type |
|-------|-------|-------------|
| 0 | owner | string (hex) |
| 1 | zcash_addr_d | bigint |
| 2 | zcash_addr_pkd | bigint |
| 3 | collateral | bigint (full u256) |
| 4 | status | number (0–4) |
| 5 | last_proof_of_balance | bigint |
| 6 | last_proof_of_capacity | bigint |
| 7 | registered_at | bigint |
| 8 | total_issued | bigint (full u256) |
| 9 | total_redeemed | bigint (full u256) |

### 12.3 Vault IDs — 0-Indexed

Vault IDs on-chain are **0-indexed** (`vault_count` starts at 0, first vault gets
ID 0). The frontend displays them as 1-based (`id: i + 1`) for user-friendliness.

### 12.4 Dual Collateral Deposit

Vault collateral must be deposited to **both** contracts:

1. **VaultRegistry** — `deposit_collateral(amount)` — updates the vault's
   `collateral` field (read by frontend and used for display)
2. **VaultPool** — `deposit_collateral(amount)` — updates pool accounting
   (`vault_deposits`, `total_deposited`, used for request assignment capacity)

Both are accounting-only (no token transfer — the wZEC is held after `approve`).
The `start-devnet.sh` vault setup performs: register → mint → approve → registry deposit → pool deposit.

### 12.5 Next.js Environment Loading

Next.js reads `frontend/.env.local` **only at server startup**. If contracts are
redeployed, the frontend must be restarted to pick up new addresses. The
`start-devnet.sh` script handles this by stopping and restarting the frontend
whenever env files are regenerated.

### 12.6 Zcash Balance API Route

The frontend includes a server-side API route at `/api/zcash-balance` that proxies
`z_getbalance` / `z_gettotalbalance` calls to zcashd. This is necessary because
browsers cannot call zcashd directly (CORS restrictions + HTTP Basic Auth credentials).

**Route:** `GET /api/zcash-balance?address=<zcash-shielded-addr>`

- With `?address=z...` → returns `{ balance: "1.23", address: "z..." }`
- Without address → returns `{ transparent, private, total }` wallet totals
- On error → returns `{ balance: "—", error: "..." }` (graceful degradation)

**Server-only credentials** (not exposed to browser via `NEXT_PUBLIC_` prefix):
```bash
ZCASH_RPC_USER=zarklink         # .env.local (server-only)
ZCASH_RPC_PASS=<auto-generated>  # .env.local (server-only)
```

> **Note:** Requires `output: "export"` to be REMOVED from `next.config.mjs`
> because API routes are not compatible with static export mode.

### 12.7 Devnet Auto-Completion Flow

On devnet, the **vault daemon's event polling** is unreliable (starknet-devnet-rs
has limited support for `getEvents`). To make the bridge fully functional for
local development and demos, the **frontend itself completes the entire multi-step
bridge protocol** by acting as both the user and the vault operator.

#### Issue (3-step auto-completion)
```
1. request_lock(amount, warranty)           — as user account
2. submit_mint(req_id, proof, block, ...)    — as user account
   └── Uses finalized block trick (see §12.8)
3. confirm_issue(req_id)                    — as vault operator account
   └── Vault operator = devnet accounts[vault_id + 1]
```

#### Redeem (2-step auto-completion)
```
1. submit_burn(commitment, amount, warranty, proof)  — as user account
   └── Pre-validates wZEC balance client-side before submitting
2. confirm_redeem(req_id, proof, block)               — as vault operator account
   └── Uses the same finalized block trick
```

The vault operator account is determined by `accounts[vault_id + 1]` from the
devnet accounts list (account 0 is deployer, accounts 1–8 are vault operators).

### 12.8 Finalized Block Trick

For devnet, the `submit_mint` and `confirm_redeem` functions need an inclusion proof
that passes `ZcashRelay.verify_inclusion()`. The relay's `verify_inclusion` computes:
```
root ← hash(note_commitment, merkle_path)
assert root == stored_commitment_root[block_height]
```

The trick: if we set `note_commitment = commitment_root` and `merkle_path = []` (empty),
then `hash(root, []) = root`, and the assertion becomes `root == root` → passes.

```typescript
// Frontend helper: findFinalizedBlock()
for height in chain_tip..0:
  if relay.is_finalized(height):
    root = relay.get_commitment_root(height)
    if root != 0:
      return { height, root }  // Use root as both commitment and proof
```

This only works on devnet where we control the relay data. In production, real
Merkle inclusion proofs from Zcash blocks would be required.

### 12.9 starknet.js Logger

starknet.js v9.4.2 emits `WARN: Insufficient transaction data for fee estimation`
during devnet transactions (harmless — the tip estimation lacks historical block data).
Both `scripts/deploy.ts` and the inline vault setup code suppress this with:
```typescript
import { logger } from 'starknet';
logger.setLogLevel('ERROR');
```

### 12.10 Error Decoding

Cairo contract reverts return error messages as hex-encoded felt252 short strings.
For example, `0x496e73756666696369656e742062616c616e6365` → "Insufficient balance".

`frontend/src/lib/starknet.ts` provides two utilities:

- **`decodeContractError(raw)`** — Extracts hex strings from RPC error messages,
  decodes them as UTF-8, and returns the readable text.
- **`friendlyTxError(err)`** — Maps decoded errors to user-friendly messages with
  actionable hints. Returns `{ message, hints[] }`.

**Known contract errors and their friendly mappings:**
| Contract Error | Friendly Message | Hints |
|----------------|-----------------|-------|
| Insufficient balance | "Insufficient wZEC balance for this operation." | Check account, switch accounts |
| Warranty too low | "Warranty collateral too low." | Increase warranty amount |
| No active vaults | "No active vaults available." | Run --services |
| Zero | "Amount must be greater than zero." | — |
| Not vault operator | "Not authorized as vault operator." | Use vault operator account |
| CONTRACT_NOT_FOUND | "Contracts not deployed." | Run --deploy |

### 12.11 Devnet Orchestration Flow

`start-devnet.sh reset --full-stack` performs these steps in order:

```
1. Kill all existing services
2. Wipe .devnet/ state directory
3. Start zcashd (regtest) → wait for wallet ready (~80s)
4. Fund Zcash accounts (mine blocks, create shielded addresses, z_sendmany)
5. Start starknet-devnet-rs → wait for port 5050
6. Fetch 15 predeployed Starknet accounts
7. Generate .env.devnet (environment file)
8. Save combined accounts to .devnet/accounts.json
9. Build Cairo contracts (scarb build)
10. Deploy 6 contracts via deploy.ts (declare → deploy → configure)
11. Generate frontend/.env.local (NEXT_PUBLIC_* vars)
12. Set up 8 vault operators:
    a. Grant deployer temporary mint authority
    b. For each vault: register → mint wZEC → approve → deposit registry → deposit pool
    c. Restore bridge authority to BridgeProtocol
13. Mine 10 extra Zcash blocks for relay finality
14. Start relayer service
15. Start vault daemon
16. Start Next.js frontend → wait for port 3000
17. Print status table
```

### 12.12 Devnet Account Layout

With `NUM_VAULTS=8` (default), 15 predeployed accounts are allocated:

| Index | Role | Account Label |
|-------|------|--------------|
| 0 | Deployer / Admin | Contract deployment, post-deploy config |
| 1–8 | Vault Operators | Registered vaults with collateral |
| 9 | Issuer (Alice) | Locks ZEC → mints wZEC |
| 10 | Redeemer (Dave) | Burns wZEC → unlocks ZEC |
| 11 | Relayer Service | Header submission account |
| 12 | Oracle Service | Price feed updates |
| 13–14 | Test Users | Additional test accounts |

### 12.13 Dev Tools API & Zcash Regtest Quirks

The dev tools API (`/api/dev`) wraps zcashd JSON-RPC calls with devnet-specific workarounds:

- **`mine_blocks`**: Uses `generate` method (NOT `generatetoaddress`, which is unavailable in zcashd v6.x regtest).
- **`fund_z_address`**: Uses `z_sendmany` with:
  - **Privacy policy**: `NoPrivacy` (required for transparent→shielded with change on devnet).
  - **Fee**: `null` (auto-calculated per ZIP 317; explicit low fees like 0.0001 fail with "unpaid action limit exceeded").
  - **Coinbase UTXOs**: Cannot have change. The code prefers non-coinbase UTXOs and falls back to sending the full coinbase UTXO minus fee margin.
- **`fund_t_address`**: Uses `sendtoaddress` (NOT `generatetoaddress`).
- **Zcash regtest addresses**: Use `zregtestsapling1...` prefix, NOT `zs1...` (mainnet).

### 12.14 Relay Seeding

For Issue/Redeem to work, the relay contract needs finalized Zcash block headers.
With `finality_depth=6`, at least 7 headers must be submitted for height 1 to be finalized.

The dev page includes a "Seed Relay" button that:
1. Queries current relay tip via `get_chain_tip()`
2. Fetches Zcash block headers via `/api/dev?action=get_block_headers`
3. Submits each header to the relay contract as the deployer (authorized relayer)
4. The devnet fee estimator intermittently rejects transactions; some blocks may be skipped

The deployer account is automatically authorized as a relayer during contract deployment.

---

## 13. Code Map

A file-by-file guide to the entire codebase. Use this to find where any piece of
logic lives.

### Smart Contracts (`contracts/src/`)

```
┌─────────────────────────────────────────────────────────────────────┐
│ lib.cairo                                                           │
│   Module root. Declares: bridge_protocol, vault_registry,           │
│   vault_pool, wzec_token, zcash_relay, oracle                      │
├─────────────────────────────────────────────────────────────────────┤
│ bridge_protocol.cairo                 ~700 lines                    │
│   ┌─ Storage: requests, request_count, vault_pool, vault_registry, │
│   │  wzec_token, zcash_relay, timeouts (mint/confirm/redeem)       │
│   ├─ constructor(admin, pool, registry, token, relay, oracle)      │
│   ├─ request_lock(amount, warranty) → request_id                   │
│   │  Assigns vault via pool, creates IssueRequest, locks warranty  │
│   ├─ submit_mint(req_id, proof, block, nullifier, ciphertext)      │
│   │  Verifies ZcashRelay inclusion, transitions to AwaitConfirm    │
│   ├─ confirm_issue(req_id) — vault confirms → mints wZEC to issuer │
│   ├─ challenge_issue(req_id, secret, proof) — encryption fraud     │
│   ├─ submit_burn(commitment, amount, warranty, proof)              │
│   │  Burns wZEC, creates RedeemRequest, assigns vault              │
│   ├─ confirm_redeem(req_id, proof, block) — vault proves ZEC sent  │
│   ├─ challenge_redeem(req_id, secret, proof) — vault fraud proof   │
│   ├─ expire_issue / expire_redeem — timeout slashing               │
│   └─ Events: IssueLockRequested, MintSubmitted, IssueConfirmed,    │
│      BurnSubmitted, RedeemConfirmed, VaultSlashed                  │
├─────────────────────────────────────────────────────────────────────┤
│ vault_registry.cairo                  ~400 lines                    │
│   ┌─ Storage: vaults (Map<u32, VaultInfo>), vault_count,           │
│   │  vault_by_owner, has_vault, admin, bridge_protocol             │
│   ├─ constructor(admin)                                             │
│   ├─ register_vault(zcash_d, zcash_pkd) → sets Active status      │
│   ├─ deposit_collateral(amount) — adds to vault.collateral         │
│   ├─ get_vault(id) → VaultInfo (13 raw felts / 10 ABI-decoded)    │
│   ├─ get_vault_count() → u32                                       │
│   ├─ is_vault_active(id) → bool                                    │
│   ├─ slash_vault(id, amount) — called by bridge on misbehavior     │
│   ├─ submit_proof_of_balance / submit_proof_of_capacity            │
│   └─ set_bridge_protocol(addr) — admin-only, sets authorized caller│
├─────────────────────────────────────────────────────────────────────┤
│ vault_pool.cairo                      ~350 lines                    │
│   ┌─ Storage: vault_deposits, total_deposited, active_vault_count, │
│   │  encumbered, wzec_token, registry, bridge_protocol             │
│   ├─ constructor(admin, wzec_token, registry)                      │
│   ├─ deposit_collateral(amount) — checks vault active via registry │
│   ├─ withdraw_collateral(amount) — checks not encumbered           │
│   ├─ assign_request(req_id) → vault_id — round-robin/random assign│
│   ├─ encumber / release_encumbrance — lock during bridge ops       │
│   ├─ get_pool_capacity() → u256                                    │
│   ├─ get_active_vault_count() → u32                                │
│   ├─ get_total_deposited() → u256                                  │
│   └─ set_bridge_protocol(addr) — admin-only                        │
├─────────────────────────────────────────────────────────────────────┤
│ wzec_token.cairo                      ~300 lines                    │
│   ┌─ Standard ERC-20 (SNIP-2): name, symbol, decimals, totalSupply │
│   ├─ transfer / approve / transferFrom — standard functions         │
│   ├─ mint(to, amount) — only callable by bridge_protocol            │
│   ├─ burn(from, amount) — only callable by bridge_protocol          │
│   └─ set_bridge(addr) — admin sets the authorized minter/burner    │
├─────────────────────────────────────────────────────────────────────┤
│ zcash_relay.cairo                     ~350 lines                    │
│   ┌─ Storage: headers (Map<u32, BlockHeader>), chain_tip,          │
│   │  finality_depth, authorized_relayers                           │
│   ├─ constructor(admin, finality_depth)                             │
│   ├─ submit_header(height, hash, prev_hash, merkle_root, ...)     │
│   ├─ submit_headers_batch(headers: Array<BlockHeader>)             │
│   ├─ verify_inclusion(commitment, merkle_path, height) → bool     │
│   ├─ is_finalized(height) → bool — height + k ≤ chain_tip         │
│   ├─ get_chain_tip / get_finalized_height / get_header_count       │
│   └─ authorize_relayer(addr) — admin-only                          │
├─────────────────────────────────────────────────────────────────────┤
│ oracle.cairo                          ~200 lines                    │
│   ┌─ Storage: current_rate, last_update, twap_window, admin        │
│   ├─ constructor(admin, initial_rate)                               │
│   ├─ update_rate(new_rate) — TWAP smoothing, circuit breaker       │
│   ├─ get_rate() → u256                                             │
│   └─ set_circuit_breaker_threshold(pct) — admin-only               │
└─────────────────────────────────────────────────────────────────────┘
```

### Frontend (`frontend/src/`)

```
┌─────────────────────────────────────────────────────────────────────┐
│ lib/starknet.ts                       ~250 lines                    │
│   ┌─ starknetConfig — reads NEXT_PUBLIC_* env vars at import time  │
│   ├─ getProvider() → RpcProvider (singleton)                        │
│   ├─ ABI definitions:                                               │
│   │  REGISTRY_ABI — get_vault, get_vault_count, register, deposit  │
│   │  RELAY_ABI    — get_chain_tip, get_finalized_height, count     │
│   │  POOL_ABI     — active_vault_count, pool_capacity, deposited   │
│   │  WZEC_ABI     — total_supply, balance_of, approve, transfer    │
│   │  BRIDGE_ABI   — request_lock, submit_mint, confirm_issue, etc. │
│   ├─ vaultStatusLabel(status: number) → string                     │
│   │  Maps Cairo enum: 0→Inactive, 1→Active, 2→Locked,             │
│   │  3→Suspended, 4→Liquidated                                     │
│   ├─ vaultStatusColor(status: number) → Tailwind class             │
│   └─ formatWzec(amount: bigint) → decimal string (8 decimals)      │
├─────────────────────────────────────────────────────────────────────┤
│ hooks/useStarknet.ts                  ~320 lines                    │
│   ┌─ useVaultList(refreshMs) — fetches all vaults from VaultRegistry│
│   │  Loops i=0..count-1 (0-indexed), returns id as i+1 (display)  │
│   │  Fields: owner[0], collateral[3], status[4], zcash[1],        │
│   │  totalIssued[8], totalRedeemed[9]                              │
│   │  Auto-refresh via setInterval when refreshMs > 0               │
│   ├─ useBridgeStats() — total supply, bridge request count          │
│   ├─ useRelayStats(refreshMs) — chain tip, finalized height, count  │
│   ├─ usePoolStats(refreshMs) — active vaults, pool capacity, total  │
│   ├─ useWzecBalance(address, refreshMs) — wZEC balance for account  │
│   └─ useZcashBalance(zcashAddr, refreshMs) — ZEC balance via API    │
│      Fetches from /api/zcash-balance server route                   │
├─────────────────────────────────────────────────────────────────────┤
│ context/AccountContext.tsx            ~150 lines                    │
│   ┌─ Parses NEXT_PUBLIC_DEVNET_ACCOUNTS (pipe-separated)           │
│   │  Format: "label|address|privateKey|zcashAddr"                  │
│   ├─ DevnetAccount type: { label, address, privateKey, zcashAddr } │
│   └─ useAccounts() → { accounts, selected, setSelected }           │
├─────────────────────────────────────────────────────────────────────┤
│ context/WalletContext.tsx             ~100 lines                    │
│   └─ Wallet connection state (devnet mode vs browser extension)     │
├─────────────────────────────────────────────────────────────────────┤
│ components/WalletConnector.tsx        ~200 lines                    │
│   ┌─ Account dropdown (label → role assignment)                     │
│   ├─ Always shows: Starknet address, Zcash address (with copy)     │
│   └─ "More" toggle reveals private key                              │
├─────────────────────────────────────────────────────────────────────┤
│ app/page.tsx                          Dashboard                     │
│   Uses useBridgeStats(), useRelayStatus(), usePoolStats()           │
│   Displays 9 stat cards in 3x3 grid                                │
├─────────────────────────────────────────────────────────────────────┤
│ app/bridge/page.tsx                   Issue & Redeem  (~725 lines)  │
│   Tab-based UI: Issue (ZEC→wZEC) and Redeem (wZEC→ZEC)            │
│   ┌─ Balance display: wZEC (Starknet) + ZEC (Zcash) side by side  │
│   ├─ handleIssue: 3-step devnet auto-completion                    │
│   │  request_lock → submit_mint → confirm_issue (as vault op)      │
│   ├─ handleRedeem: 2-step devnet auto-completion                   │
│   │  Pre-validates wZEC balance → submit_burn → confirm_redeem     │
│   ├─ findFinalizedBlock() — queries relay for finalized block root │
│   ├─ getVaultOperatorAccount() — devnet accounts[vault_id + 1]     │
│   ├─ Max button (redeem): fills input with full wZEC balance       │
│   ├─ Step-by-step status messages during multi-step flows          │
│   └─ Friendly error messages via friendlyTxError()                 │
├─────────────────────────────────────────────────────────────────────┤
│ app/vaults/page.tsx                   Vault Browser                 │
│   Table showing all vaults: ID, owner (truncated), status,          │
│   collateral, issued, redeemed. Uses useVaultList(15000).          │
│   Filters Active vaults (status===1). Auto-refreshes every 15s.    │
├─────────────────────────────────────────────────────────────────────┤
├─────────────────────────────────────────────────────────────────────┤
│ app/api/zcash-balance/route.ts        Zcash Balance API             │
│   Server-side route proxying zcashd z_getbalance / z_gettotalbalance│
│   Uses ZCASH_RPC_USER/PASS (server-only, NOT NEXT_PUBLIC_)         │
│   Returns JSON: { balance, address } or { transparent, private }   │
│   Graceful error handling: returns { balance: "—" } on failure     │
├─────────────────────────────────────────────────────────────────────┤
│ app/relay/page.tsx                    Relay Status                  │
│   Chain tip, finalized height, header count. Uses useRelayStats().  │
├─────────────────────────────────────────────────────────────────────┤
│ app/dev/page.tsx                      Dev Tools  (~870 lines)       │
│   ┌─ Zcash Regtest Tools:                                          │
│   │  Generate z-addr/t-addr, mine blocks, fund addresses           │
│   │  Quick-fill vault shielded addresses, wallet info panel        │
│   ├─ Starknet Contract Tools:                                       │
│   │  Query all 5 contracts, wZEC balance scan, direct mint wZEC    │
│   │  Seed Relay — submits Zcash headers to relay contract          │
│   ├─ Simulation Scripts:                                            │
│   │  Configurable count/amount, Run Nx Issue, Issue→Redeem Cycle   │
│   │  Uses devnet auto-completion (vault operator impersonation)    │
│   ├─ Devnet Accounts Reference — table of all 15 accounts          │
│   └─ Console — timestamped log panel (info/success/error/pending)  │
├─────────────────────────────────────────────────────────────────────┤
│ app/docs/page.tsx                     Protocol Docs  (~534 lines)   │
│   In-app protocol documentation with collapsible sections:          │
│   ┌─ What is Zarklink? — overview, ZCLAIM reference                │
│   ├─ Protocol Actors — 5 actors with devnet account mapping        │
│   ├─ Issue Flow — 3-step with StepCard components                  │
│   ├─ Redeem Flow — 2-step with details                             │
│   ├─ Smart Contracts — all 6 contracts with function lists         │
│   ├─ Vault System — lifecycle states, collateralization             │
│   ├─ Zcash Relay — finality, inclusion proofs                      │
│   ├─ Privacy & Splitting Strategy                                   │
│   ├─ How to Use the Bridge — step-by-step instructions             │
│   ├─ Architecture Overview — ASCII diagram                         │
│   ├─ Troubleshooting — 6 common issues                             │
│   └─ Quick Links — grid to Bridge, Vaults, Relay, Dev              │
├─────────────────────────────────────────────────────────────────────┤
│ app/api/dev/route.ts                  Dev Tools API                 │
│   Server-side POST API for devnet Zcash operations:                │
│   ┌─ generate_z_address — z_getnewaddress sapling                  │
│   ├─ generate_t_address — getnewaddress                            │
│   ├─ mine_blocks — generate (zcashd regtest)                       │
│   ├─ fund_z_address — z_sendmany with auto fee (ZIP 317)          │
│   │  Handles coinbase UTXOs (no change allowed)                    │
│   ├─ fund_t_address — sendtoaddress                                │
│   ├─ check_operation — z_getoperationstatus                        │
│   ├─ get_block_headers — getblockheader (for relay seeding)        │
│   ├─ wallet_info — getinfo + z_gettotalbalance + addresses         │
│   └─ list_balances — z_getbalance for all shielded addresses       │
│   Uses ZCASH_RPC_USER/PASS (server-only env vars)                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Scripts (`scripts/`)

```
┌─────────────────────────────────────────────────────────────────────┐
│ start-devnet.sh                       ~1400 lines                   │
│   ┌─ Configuration: NUM_VAULTS, ports, paths, colors                │
│   ├─ start_zcashd()       — zcashd -regtest, wait for wallet       │
│   ├─ fund_zcash()         — mine blocks, create shielded addrs     │
│   ├─ start_starknet()     — starknet-devnet --seed 42              │
│   ├─ fetch_accounts()     — GET /predeployed_accounts, label them   │
│   ├─ generate_env()       — write .env.devnet                       │
│   ├─ deploy_contracts()   — scarb build + tsx deploy.ts             │
│   ├─ generate_frontend_env() — write frontend/.env.local            │
│   ├─ setup_vault()        — inline tsx: register, mint, deposit     │
│   ├─ start_relayer()      — pnpm -C relayer dev (background)       │
│   ├─ start_vault_daemon() — pnpm -C vault-daemon dev (background)  │
│   ├─ start_frontend()     — pnpm -C frontend dev (background)      │
│   ├─ stop_all()           — kill PIDs for all services              │
│   ├─ show_status()        — formatted service table                 │
│   └─ Main: parse args → orchestrate steps → print summary          │
├─────────────────────────────────────────────────────────────────────┤
│ deploy.ts                             ~250 lines                    │
│   ┌─ Reads .env.devnet for RPC + deployer key                      │
│   ├─ Deploys 6 contracts in order:                                  │
│   │  1. WzecToken(admin, name, symbol, decimals)                   │
│   │  2. Oracle(admin, initial_rate)                                 │
│   │  3. VaultRegistry(admin)                                        │
│   │  4. ZcashRelay(admin, finality_depth=24)                       │
│   │  5. VaultPool(admin, wzec_token, registry)                     │
│   │  6. BridgeProtocol(admin, pool, registry, token, relay, oracle)│
│   ├─ Post-deploy config:                                            │
│   │  token.set_bridge(bridge), registry.set_bridge_protocol(bridge)│
│   │  pool.set_bridge_protocol(bridge), relay.authorize_relayer     │
│   ├─ Saves to .devnet/deployments.json                              │
│   └─ Updates .env.devnet with contract addresses                    │
├─────────────────────────────────────────────────────────────────────┤
│ deploy.sh                             ~50 lines                     │
│   Wrapper: scarb build → tsx deploy.ts                              │
├─────────────────────────────────────────────────────────────────────┤
│ install-deps.sh                       ~100 lines                    │
│   Checks Node.js, pnpm/npm, Scarb, snforge, zcashd                │
│   Prompts for pnpm vs npm, runs install                             │
└─────────────────────────────────────────────────────────────────────┘
```

### Off-Chain Services

```
┌─────────────────────────────────────────────────────────────────────┐
│ relayer/src/                                                        │
│   index.ts          — main loop: poll → batch → submit              │
│   config.ts         — loads ZCASH_RELAY_CONTRACT, RPC URLs, keys    │
│   zcash-client.ts   — getblock, getblockcount, getblockhash calls  │
│   header-pipeline.ts— batches headers, calls submit_headers_batch   │
│   starknet-client.ts— Account + Contract setup for relay contract   │
├─────────────────────────────────────────────────────────────────────┤
│ vault-daemon/src/                                                   │
│   index.ts          — main loop: poll events → auto-respond         │
│   config.ts         — loads all contract addresses + keys           │
│   monitor.ts        — polls BridgeProtocol events for new requests  │
│   zcash-ops.ts      — z_sendmany, z_getbalance for redeem flow     │
│   prover-client.ts  — stub for ZK proof generation                  │
├─────────────────────────────────────────────────────────────────────┤
│ cli/src/                                                            │
│   index.ts          — Commander.js program with subcommands         │
│   commands/issue.ts — request_lock + submit_mint flow               │
│   commands/redeem.ts— submit_burn + await confirm flow              │
│   commands/vault.ts — register_vault + deposit + status             │
│   commands/status.ts— query request status by ID                    │
│   commands/relayer.ts— start relayer service                        │
│   splitter.ts       — powers-of-2 splitting algorithm (§5.1)       │
│   utils.ts          — hex formatting, provider creation             │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow Map

```
                    ┌─────────────┐
                    │  User (Web)  │
                    └──────┬──────┘
                           │ http://localhost:3000
                    ┌──────▼──────┐
                    │  Frontend    │──── reads ──── frontend/.env.local
                    │  (Next.js)   │              (NEXT_PUBLIC_* vars)
                    └──────┬──────┘
                           │ starknet.js Contract.call() / Account.execute()
                    ┌──────▼──────┐
                    │  Starknet    │──── port 5050
                    │  Devnet      │
                    │  ┌─────────┐ │
                    │  │ Bridge  │ │◄── confirm/challenge ── Vault Daemon
                    │  │ Protocol│ │
                    │  └────┬────┘ │
                    │       │      │
                    │  ┌────▼────┐ │
                    │  │ Vault   │ │    ┌────────────┐
                    │  │ Registry│ │    │ Vault Pool │
                    │  └─────────┘ │    └────────────┘
                    │       │      │
                    │  ┌────▼────┐ │
                    │  │ wZEC    │ │    ┌────────────┐
                    │  │ Token   │ │    │  Oracle    │
                    │  └─────────┘ │    └────────────┘
                    │       │      │
                    │  ┌────▼────┐ │
                    │  │ Zcash   │ │◄── submit_headers ── Relayer Service
                    │  │ Relay   │ │
                    │  └─────────┘ │
                    └──────────────┘
                           │
              Zcash Relay verifies block headers from:
                           │
                    ┌──────▼──────┐
                    │  zcashd      │──── port 18232
                    │  (regtest)   │
                    └─────────────┘
```
