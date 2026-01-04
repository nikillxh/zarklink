# ZCLAIM: Privacy-Preserving Zcash Bridge to Starknet

<p align="center">
  <strong>The first trustless cross-chain bridge that preserves Zcash's privacy guarantees</strong>
</p>

<p align="center">
  <a href="#the-problem">Problem</a> •
  <a href="#our-solution">Solution</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#comparison">Comparison</a> •
  <a href="#getting-started">Get Started</a>
</p>

---

## The Problem

### Cross-Chain Bridges Destroy Privacy

Today's blockchain bridges create a **privacy nightmare**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    TRADITIONAL BRIDGE FLOW                               │
│                                                                          │
│   👤 Alice                                                               │
│      │                                                                   │
│      ├── Sends 10 ZEC to Bridge Address ──────────► 🔍 PUBLIC            │
│      │   (transparent address visible)                                   │
│      │                                                                   │
│      ├── Bridge operator sees: ───────────────────► 🔍 OPERATOR SEES     │
│      │   • Alice's address                                               │
│      │   • Exact amount (10 ZEC)                                         │
│      │   • Destination chain address                                     │
│      │                                                                   │
│      └── Receives 10 wZEC on Ethereum ────────────► 🔍 PUBLIC            │
│          (linked to her identity)                                        │
│                                                                          │
│   ❌ RESULT: Complete transaction graph exposed                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**The privacy cost:**
- 🔴 Your Zcash address is exposed
- 🔴 Transaction amounts are public  
- 🔴 Bridge operators can censor or front-run
- 🔴 Chain analysis links your identities across chains
- 🔴 Defeats the entire purpose of using Zcash

---

## Our Solution

### ZCLAIM: Zero-Knowledge Cross-Chain Transfers

ZCLAIM bridges Zcash to Starknet **without revealing anything**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       ZCLAIM BRIDGE FLOW                                 │
│                                                                          │
│   👤 Alice                                                               │
│      │                                                                   │
│      ├── Sends ZEC to Vault's shielded address ───► 🔒 SHIELDED          │
│      │   (amount hidden, sender hidden)                                  │
│      │                                                                   │
│      ├── Generates ZK proof of deposit ───────────► 🔒 ZERO-KNOWLEDGE    │
│      │   • Proves note exists in commitment tree                         │
│      │   • Proves amount matches (without revealing it)                  │
│      │   • Proves ownership (without revealing identity)                 │
│      │                                                                   │
│      ├── Submits proof to Starknet ───────────────► 🔒 PRIVATE           │
│      │   (only proof visible, not details)                               │
│      │                                                                   │
│      └── Receives wZEC on Starknet ───────────────► 🔒 UNLINKABLE        │
│          (no connection to Zcash identity)                               │
│                                                                          │
│   ✅ RESULT: Complete privacy preserved                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

**What ZCLAIM guarantees:**
- 🟢 **Amount Privacy** - Nobody learns how much you transferred
- 🟢 **Sender Privacy** - Your Zcash address stays hidden
- 🟢 **Receiver Privacy** - Your Starknet address is unlinkable
- 🟢 **Trustless** - No operator can steal or censor
- 🟢 **Collateralized** - Vaults are overcollateralized, ensuring security

---

## How It Works

### The Issue Protocol (ZEC → wZEC)

```
    ZCASH BLOCKCHAIN                           STARKNET
    ════════════════                           ════════

    ┌─────────────┐                        ┌─────────────┐
    │   User      │                        │   Bridge    │
    │   Wallet    │                        │   Contract  │
    └──────┬──────┘                        └──────┬──────┘
           │                                      │
           │ 1. REQUEST LOCK                      │
           │    Get vault's shielded address      │
           │ ────────────────────────────────────►│
           │                                      │
           │ 2. LOCK ZEC                          │
           │    Send to vault's z-addr            │
    ┌──────▼──────┐                               │
    │  Shielded   │                               │
    │  Pool       │                               │
    └──────┬──────┘                               │
           │                                      │
           │ 3. GENERATE PROOF                    │
           │    • Note commitment in tree         │
           │    • Value commitment matches        │
           │    • Ownership proof                 │
           ├──────────────────────────────────────┤
           │                                      │
           │ 4. SUBMIT PROOF                      │
           │ ────────────────────────────────────►│
           │                                      │
           │                               ┌──────▼──────┐
           │                               │   Verify    │
           │                               │   • Block   │
           │                               │   • Merkle  │
           │                               │   • ZK Proof│
           │                               └──────┬──────┘
           │                                      │
           │ 5. MINT wZEC                         │
           │ ◄────────────────────────────────────│
           │                                      │
    ═══════════════════════════════════════════════════════
    
    🔒 At no point is the amount or sender revealed
```

### The Redeem Protocol (wZEC → ZEC)

```
    STARKNET                                ZCASH BLOCKCHAIN
    ════════                                ════════════════

    ┌─────────────┐                        ┌─────────────┐
    │   User      │                        │   Vault     │
    │   (wZEC)    │                        │   Operator  │
    └──────┬──────┘                        └──────┬──────┘
           │                                      │
           │ 1. BURN wZEC                         │
           │    Submit burn request with          │
           │    encrypted note details            │
    ┌──────▼──────┐                               │
    │  Bridge     │                               │
    │  Contract   │                               │
    └──────┬──────┘                               │
           │                                      │
           │ 2. NOTIFY VAULT                      │
           │ ────────────────────────────────────►│
           │                                      │
           │                               ┌──────▼──────┐
           │                               │  Decrypt    │
           │                               │  Note       │
           │                               │  Details    │
           │                               └──────┬──────┘
           │                                      │
           │ 3. RELEASE ZEC                       │
           │    Send to user's z-addr             │
           │ ◄────────────────────────────────────│
           │                               ┌──────▼──────┐
           │                               │  Shielded   │
           │                               │  Transfer   │
           │                               └─────────────┘
           │                                      │
           │ 4. CONFIRM RELEASE                   │
           │    Submit proof of release           │
           │ ◄────────────────────────────────────│
           │                                      │
    ═══════════════════════════════════════════════════════
    
    🔒 Vault only learns what's needed to send you ZEC
```

---

## Comparison with Existing Bridges

| Feature | ZCLAIM | WBTC | RenBTC | tBTC | zkBridge |
|---------|--------|------|--------|------|----------|
| **Privacy** | ✅ Full | ❌ None | ❌ None | ⚠️ Limited | ⚠️ Partial |
| **Amount Hidden** | ✅ Yes | ❌ No | ❌ No | ❌ No | ❌ No |
| **Sender Hidden** | ✅ Yes | ❌ No | ❌ No | ❌ No | ⚠️ Partial |
| **Trustless** | ✅ Yes | ❌ Custodian | ⚠️ Semi | ✅ Yes | ✅ Yes |
| **Collateralized** | ✅ Yes | ❌ No | ❌ No | ✅ Yes | ❌ No |
| **Censorship Resistant** | ✅ Yes | ❌ No | ⚠️ Semi | ✅ Yes | ✅ Yes |
| **ZK Proofs** | ✅ Native | ❌ No | ❌ No | ❌ No | ✅ Yes |

### Why ZCLAIM is Different

**vs. WBTC (Centralized)**
> WBTC requires trusting BitGo as custodian. They see all transactions, can freeze funds, and must comply with regulations that may require blocking addresses. ZCLAIM has no custodian.

**vs. RenBTC (Semi-Decentralized)**
> Ren's darknodes collectively hold the keys. While better than WBTC, the network still sees all transaction amounts and can theoretically collude. ZCLAIM reveals nothing to anyone.

**vs. tBTC (Trustless but Public)**
> tBTC is truly decentralized but all Bitcoin transactions are public. Your BTC address, amounts, and timing are visible on-chain. ZCLAIM uses Zcash's shielded pool to hide everything.

**vs. zkBridge (ZK but not Private)**
> zkBridge uses ZK proofs for verification efficiency, not privacy. The underlying transactions are still public. ZCLAIM uses ZK proofs for both verification AND privacy.

---

## Security Model

### Threat Analysis

| Threat | Mitigation |
|--------|------------|
| **Vault steals funds** | Overcollateralization (150%) + slashing |
| **Vault goes offline** | Timeout → user can claim from collateral |
| **Relay submits fake blocks** | BLAKE2b PoW verification on-chain |
| **User fakes proof** | ZK-SNARK verification (soundness) |
| **Chain analysis** | Shielded transactions hide all metadata |

### Trust Assumptions

1. **Zcash security**: We assume Zcash's Sapling protocol is secure
2. **Starknet liveness**: Starknet must remain operational
3. **Honest relayer**: At least one honest party relays block headers
4. **Cryptographic assumptions**: BLAKE2b, Groth16, Pedersen commitments

---


## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ZCLAIM BRIDGE (Starknet)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐   │
│  │   ZCASH     │         │    RELAY         │         │   STARKNET      │   │
│  │  (Backing)  │◄───────►│    SERVICE       │◄───────►│   (Issuing)     │   │
│  │             │         │    (Node.js)     │         │                 │   │
│  └─────────────┘         └──────────────────┘         └─────────────────┘   │
│        │                        │                            │              │
│        ▼                        ▼                            ▼              │
│  ┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐   │
│  │  Shielded   │         │  RelaySystem     │         │  VaultRegistry  │   │
│  │  Notes      │         │  (Cairo)         │         │  + wZEC Token   │   │
│  └─────────────┘         └──────────────────┘         └─────────────────┘   │
│                                  │                            │             │
│                                  └────────────┬───────────────┘             │
│                                               ▼                             │
│                                  ┌──────────────────┐                       │
│                                  │   ZclaimBridge   │                       │
│                                  │   (Cairo)        │                       │
│                                  └──────────────────┘                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
ztarknet/
├── cairo/                           # Starknet contracts (Cairo 2.8)
│   ├── Scarb.toml                  # Package config
│   ├── src/
│   │   ├── lib.cairo               # Main library
│   │   ├── token/wzec.cairo        #  wZEC ERC20 token
│   │   ├── relay/
│   │   │   ├── relay_system.cairo  #  Block header relay
│   │   │   └── types.cairo         #  Data types
│   │   ├── vault/
│   │   │   ├── registry.cairo      #  Vault registry (needs review)
│   │   │   └── types.cairo         #  Vault types (needs review)
│   │   ├── bridge/
│   │   │   ├── zclaim.cairo        #  Main bridge (needs review)
│   │   │   ├── mint.cairo          #  Issue helpers (needs review)
│   │   │   └── burn.cairo          #  Redeem helpers (needs review)
│   │   └── crypto/
│   │       ├── blake2b.cairo       #  BLAKE2b (placeholder)
│   │       └── merkle.cairo        # Merkle proofs (placeholder)
│   └── scripts/
│       └── deploy.sh               #  Deployment script
│
├── cli/                             #  Command-line interface
│   ├── package.json
│   └── src/
│       ├── index.js                # Main entry point
│       ├── config.js               # Configuration
│       ├── commands/
│       │   ├── relay.js            # Block header relay commands
│       │   ├── issue.js            # ZEC→wZEC commands
│       │   ├── redeem.js           # wZEC→ZEC commands
│       │   ├── vault.js            # Vault operator commands
│       │   ├── config.js           # CLI configuration
│       │   └── status.js           # Status checking
│       └── utils/
│           ├── starknet.js         # Starknet helpers
│           └── zcash.js            # Zcash RPC helpers
│
├── relay-service/                   # Relay daemon
│   ├── package.json
│   └── src/
│       ├── index.js                # Main service
│       ├── zcash-client.js         # Zcash RPC client
│       ├── starknet-relay.js       # Starknet contract client
│       └── header-processor.js     # Header parsing/encoding
│
├── circom/                          #  ZK circuits
│   └── circuits/
│       ├── blake2b.circom          #  BLAKE2b-256
│       ├── sha256d.circom          #  Double SHA256
│       ├── merkle_tree.circom      #  Merkle verification
│       ├── zcash_tx.circom         #  ZIP-244 tx hash
│       ├── zclaim_mint.circom      #  Mint proof circuit
│       └── zclaim_burn.circom      #  Burn proof circuit
│
├── scripts/
│   └── integration_test.sh         #  Integration test runner
│
├── research/                        # Protocol documentation
│   ├── ZCLAIM_PROTOCOL.md          # Full protocol spec
│   └── ZCASH_EXPLAINED.md          # Zcash fundamentals
│
└── solidity/                        # Legacy/reference contracts
```

---

## Quick Start

### Build & Test
```bash
# Run integration tests (builds everything)
./scripts/integration_test.sh

# Or manually:

# Build Cairo contracts
cd cairo && scarb build

# Install CLI
cd cli && npm install

# Install relay service
cd relay-service && npm install
```

### Configure CLI
```bash
cd cli
node src/index.js config init
```

### Deploy to Testnet
```bash
# Set up Starknet account first
starkli account oz init ~/.starkli-wallets/deployer

# Deploy contracts
cd cairo && ./scripts/deploy.sh sepolia
```

### Run Relay Service
```bash
cd relay-service
cp .env.example .env
# Edit .env with your configuration
npm start
```

---

## CLI Usage

```bash
# Main help
zclaim --help

# Check bridge status
zclaim status bridge
zclaim status health

# Issue: ZEC → wZEC
zclaim issue vaults              # List available vaults
zclaim issue request -v 0x... -a 1.5   # Request lock permit
zclaim issue lock <nonce>        # Lock ZEC on Zcash
zclaim issue mint <nonce>        # Claim wZEC on Starknet
zclaim issue status <nonce>      # Check status

# Redeem: wZEC → ZEC
zclaim redeem request -a 1.5 -t zs1...  # Burn wZEC, request release
zclaim redeem status <nonce>     # Check status
zclaim redeem claim <nonce>      # Claim collateral if timeout

# Vault operations (for operators)
zclaim vault register -z zs1... -c 10   # Register vault
zclaim vault deposit 5           # Add collateral
zclaim vault status              # Check vault status
zclaim vault pending             # List pending operations
zclaim vault confirm-issue <nonce>      # Confirm issue
zclaim vault release <nonce>     # Release ZEC for redeem

# Relay operations
zclaim relay status              # Check relay status
zclaim relay submit <height>     # Submit single block
zclaim relay sync -s 100 -e 200  # Sync block range
```

---

## Security Notes

1. **Collateral**: Vaults must maintain ≥150% collateralization
2. **Confirmations**: 20 Zcash block confirmations required
3. **Timeouts**: 24h for issue, 24h for redeem
4. **Challenge**: Vaults can dispute bad encryption proofs

---

## Contributing

1. Review Cairo contracts in `cairo/src/` (some need fixes)
2. Implement proper BLAKE2b in Cairo
3. Add unit tests
4. Submit PR

---

## References

This protocol is based on academic research:

> **XCLAIM: Trustless, Interoperable, Cryptocurrency-Backed Assets**  
> Alexei Zamyatin, Dominik Harz, Joshua Lind, Panayiotis Panayiotou, Arthur Gervais, William Knottenbelt  
> *IEEE Symposium on Security and Privacy (S&P), 2019*  
> [https://eprint.iacr.org/2018/643](https://eprint.iacr.org/2018/643)

> **Confidential Cross-Blockchain Exchanges (ZCLAIM Extension)**  
> Aleixo Sánchez Sánchez  
> *ETH Zürich Master's Thesis, 2019*

> **Zcash Protocol Specification**  
> Daira Hopwood, Sean Bowe, Taylor Hornby, Nathan Wilcox  
> [https://zips.z.cash/protocol/protocol.pdf](https://zips.z.cash/protocol/protocol.pdf)

---

## License

MIT License - see [LICENSE](LICENSE)

---

<p align="center">
  <strong>Bringing Zcash's privacy to Starknet's scalability</strong>
</p>