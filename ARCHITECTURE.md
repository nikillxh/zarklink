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
- `status: VaultStatus` — {Active, Locked, Suspended, Liquidated}
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
| **Frontend** | Next.js 14 + TailwindCSS | Modern bridge UI |
| **Local Dev** | Katana (Starknet devnet) + zcashd (regtest) | Local testing infrastructure |
| **Oracle** | Pragma Oracle (Starknet-native) | Price feeds |

---

## 8. Project Structure

```
neo-zarklink/
├── contracts/                    # Cairo smart contracts (Scarb project)
│   ├── src/
│   │   ├── vault_registry.cairo  # Vault registration and collateral
│   │   ├── zcash_relay.cairo     # Zcash light client / header relay
│   │   ├── bridge_protocol.cairo # Issue/Redeem state machine
│   │   ├── wzec_token.cairo      # wZEC ERC-20 token
│   │   ├── oracle.cairo          # Exchange rate oracle
│   │   └── lib.cairo             # Module root
│   ├── tests/
│   │   └── *.cairo               # Contract test suites
│   └── Scarb.toml
│
├── prover/                       # ZK proof circuits (Rust)
│   ├── src/
│   │   ├── circuits/
│   │   │   ├── mint_proof.rs     # Issue proof circuit
│   │   │   ├── burn_proof.rs     # Redeem proof circuit
│   │   │   ├── challenge.rs      # Challenge proof circuit
│   │   │   ├── balance.rs        # Proof of balance circuit
│   │   │   └── capacity.rs       # Proof of capacity circuit
│   │   ├── lib.rs
│   │   └── main.rs
│   └── Cargo.toml
│
├── relayer/                      # Block header relayer service
│   ├── src/
│   │   ├── index.ts
│   │   ├── zcash-client.ts       # Zcash node RPC client
│   │   ├── starknet-client.ts    # Starknet contract interaction
│   │   ├── header-pipeline.ts    # Header verification pipeline
│   │   └── config.ts
│   ├── package.json
│   └── tsconfig.json
│
├── vault-daemon/                 # Vault operator daemon
│   ├── src/
│   │   ├── index.ts
│   │   ├── monitor.ts            # Event monitoring
│   │   ├── zcash-ops.ts          # Zcash shielded operations
│   │   ├── prover-client.ts      # ZK proof generation client
│   │   └── config.ts
│   ├── package.json
│   └── tsconfig.json
│
├── cli/                          # CLI tool
│   ├── src/
│   │   ├── index.ts
│   │   ├── commands/
│   │   │   ├── issue.ts
│   │   │   ├── redeem.ts
│   │   │   ├── vault.ts
│   │   │   ├── status.ts
│   │   │   └── relayer.ts
│   │   ├── splitter.ts           # Splitting strategy implementation
│   │   └── utils.ts
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                     # Next.js bridge UI
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── styles/
│   ├── package.json
│   └── next.config.js
│
├── scripts/                      # Infrastructure scripts
│   ├── start-devnet.sh           # Start local chains + fund accounts
│   └── deploy.sh                 # Deploy contracts to devnet
│
├── docs/                         # Additional documentation
│
├── ARCHITECTURE.md               # This file
└── README.md                     # Project README
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
