# ZCLAIM Protocol: A Complete Technical Guide

This document provides a comprehensive explanation of the **ZCLAIM protocol** based on the master thesis "Confidential Cross-Blockchain Exchanges" by Aleixo Sánchez (ETH Zürich / Web3 Foundation, 2020).

ZCLAIM is the first protocol that achieves **private cross-chain transfers** while maintaining the anonymity guarantees of Zcash.

---

## Table of Contents

1. [Overview](#overview)
2. [How ZCLAIM Differs from XCLAIM](#how-zclaim-differs-from-xclaim)
3. [System Setup](#system-setup)
4. [Key Components](#key-components)
5. [The Issue Protocol (Lock ZEC → Mint wZEC)](#the-issue-protocol)
6. [The Redeem Protocol (Burn wZEC → Unlock ZEC)](#the-redeem-protocol)
7. [Vault Balance Proofs](#vault-balance-proofs)
8. [The Splitting Strategy (Privacy Enhancement)](#the-splitting-strategy)
9. [Security Properties](#security-properties)
10. [Challenges and Solutions](#challenges-and-solutions)

---

## Overview

**ZCLAIM** is an adaptation of the XCLAIM framework specifically designed to work with **Zcash's Sapling shielded protocol**. While XCLAIM works with transparent blockchains like Bitcoin, ZCLAIM enables cross-chain transfers that preserve the privacy properties of Zcash.

### Core Innovation

ZCLAIM introduces:
- **Mint Transfers**: New transfer type that creates wrapped ZEC (ICZ) on the issuing chain by proving a shielded note was locked on Zcash
- **Burn Transfers**: New transfer type that destroys wrapped ZEC to trigger release of ZEC on the backing chain
- **zk-SNARKs for Cross-Chain Proofs**: Zero-knowledge proofs that verify Zcash transactions without revealing amounts or identities
- **Challenge/Confirm Mechanism**: Handles encrypted note transmission between parties

### Terminology

| Term | Definition |
|:-----|:-----------|
| **ZEC** | Zcash shielded currency (backing currency) |
| **ICN** | Issuing chain's native currency (for collateral) |
| **ICZ** | Issued wrapped ZEC (the tokenized representation) |
| **Vault** | Non-trusted intermediary that holds locked ZEC |
| **Note** | A Zcash shielded payment unit |

---

## How ZCLAIM Differs from XCLAIM

| Aspect | XCLAIM | ZCLAIM |
|:-------|:-------|:-------|
| **Backing Chain** | Bitcoin (transparent) | Zcash (shielded) |
| **Verification** | SPV proofs of transactions | zk-SNARKs proving note existence |
| **Auditability** | Fully auditable | NOT auditable (by design) |
| **Amounts** | Publicly visible | Hidden from all parties |
| **Vault Knowledge** | Knows exact amounts | Must provide balance proofs |
| **Note Encryption** | N/A | Must handle encrypted note transmission |

### Key Design Goals

ZCLAIM replaces XCLAIM's auditability with new privacy-focused goals:

1. **Soundness**: Total issued ICZ = Total ZEC obligations held by vaults
2. **Coverage**: ZEC obligations are backed by proportional collateral
3. **Fairness**: Honest participants never lose funds
4. **Untraceability**: Users cannot be de-anonymized through protocol activity
5. **Minimal Modifications**: Reuse Sapling code/circuits where possible

---

## System Setup

### Blockchain Requirements

The **Issuing Chain (I)** must support:

1. **Zcash Block Header Verification**
   - BLAKE2b compression function (for Equihash PoW verification)
   - Ability to store/verify block headers

2. **Sapling Cryptography**
   - BLS12-381 pairing (for zk-SNARK verification)
   - Jubjub curve operations
   - SHA-256, BLAKE2b, BLAKE2s hash functions

3. **Smart Contract Logic** (or native protocol support)
   - Vault registry
   - Exchange rate oracle
   - Mint/Burn transfer processing

### Actors

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ZCLAIM ACTORS                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ISSUER (Alice)                                                         │
│  └── Locks ZEC on Zcash → Receives ICZ on Issuing Chain                │
│                                                                         │
│  REDEEMER (Dave)                                                        │
│  └── Burns ICZ on Issuing Chain → Receives ZEC on Zcash               │
│                                                                         │
│  VAULT (V)                                                              │
│  └── Non-trusted intermediary                                           │
│  └── Holds locked ZEC, releases on redeem                              │
│  └── Posts collateral in ICN                                           │
│  └── Submits periodic balance proofs                                   │
│                                                                         │
│  RELAYER                                                                │
│  └── Submits Zcash block headers to the relay system                   │
│  └── Often the vault itself (aligned incentives)                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Key Components

### 1. Vault Registry

The vault registry maintains a public list of all vaults with:

| Field | Description |
|:------|:------------|
| `(d, pkd)` | Vault's Zcash shielded payment address |
| `coll` | Amount of collateral locked in ICN |
| `cb` | Homomorphic commitment to ZEC obligations (hidden amount) |
| `xrn` | Last exchange rate used in balance proof |
| `accepts_issue` | Boolean: available for lock requests? |
| `accepts_redeem` | Boolean: available for redeem requests? |

**Key Insight**: The vault's actual ZEC holdings are NEVER publicly revealed. Only commitments are stored.

### 2. Relay System

The relay system is a light client for Zcash on the issuing chain:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         RELAY SYSTEM FUNCTIONS                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. DIFFICULTY ADJUSTMENT                                               │
│     └── Implements Zcash's difficulty algorithm                         │
│                                                                         │
│  2. BLOCK HEADER VALIDATION                                             │
│     └── Verifies Equihash proof-of-work solutions                       │
│     └── Cost: 2^k iterations of BLAKE2b (k=9 for Zcash)                │
│                                                                         │
│  3. CHAIN VALIDATION                                                    │
│     └── Verifies sequence of blocks form valid chain                    │
│                                                                         │
│  4. CONSENSUS VERIFICATION                                              │
│     └── Blocks at depth ≥ k are considered "confirmed"                 │
│                                                                         │
│  5. NOTE COMMITMENT VERIFICATION                                        │
│     └── Given: note commitment + Merkle path                           │
│     └── Verifies: commitment exists in confirmed block's tree          │
│     └── Uses: hashFinalSaplingRoot in block header                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Critical Feature**: Zcash headers contain `hashFinalSaplingRoot` - the root of the note commitment tree. This allows proving a note exists WITHOUT submitting the full transaction (saving ~2.5KB per proof).

### 3. Exchange Rate Oracle

Provides the current ZEC/ICN exchange rate:
- `xr = xrn / xrG` where `xrG = 2^ℓxrG` (power of 2 for efficient computation)
- Used for collateral calculations

### 4. New Transfer Types

ZCLAIM introduces two new transfer types that integrate with Sapling:

#### Mint Transfer
Creates ICZ by proving ZEC was locked. Contains:
- Value commitment to ICZ being minted
- Value commitment to ZEC locked
- Lock permit reference (nonce, vault address)
- Note commitment + Merkle path (proves note exists on Zcash)
- Encrypted note plaintext (for vault to decrypt)
- zk-SNARK proof (πZKMint)
- Signature (prevents replay)

#### Burn Transfer
Destroys ICZ to request ZEC release. Contains:
- Value commitment to ICZ being burned
- Value commitment to ZEC to be released
- Vault identifier
- Requested note commitment (what redeemer wants to receive)
- Encrypted note details (for vault to create the note)
- zk-SNARK proof (πZKBurn)

---

## The Issue Protocol

**Goal**: Lock ZEC on Zcash → Mint ICZ on Issuing Chain

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ISSUE PROTOCOL                                │
└─────────────────────────────────────────────────────────────────────────┘

    ISSUER (Alice)              ISSUING CHAIN (I)              VAULT (V)
         │                            │                            │
         │                            │                            │
    ┌────┴────┐                       │                       ┌────┴────┐
    │ STEP 0  │                       │                       │ SETUP   │
    │ Choose  │                       │                       │ Register│
    │ Vault   │                       │                       │ + Lock  │
    └────┬────┘                       │                       │Collateral
         │                            │                       └────┬────┘
         │                            │                            │
         │  1. requestLock            │                            │
         │  (lock warranty ICNw)      │                            │
         ├───────────────────────────>│                            │
         │                            │                            │
         │  2. Receive Lock Permit    │                            │
         │     (contains nonce)       │                            │
         │<───────────────────────────┤                            │
         │                            │                            │
         │                            │                            │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │            ZCASH TRANSACTION                            │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │                            │                            │
         │  3. lock: Send shielded    │                            │
         │     ZEC to Vault's address │                            │
         │     (derive rcm from nonce)│                            │
         ├────────────────────────────────────────────────────────>│
         │                            │                            │
         │                            │                            │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │          BACK TO ISSUING CHAIN                          │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │                            │                            │
         │  4. mint: Submit Mint Tx   │                            │
         │     - Note commitment      │                            │
         │     - Merkle path          │                            │
         │     - Encrypted note       │                            │
         │     - zk-SNARK proof       │                            │
         ├───────────────────────────>│                            │
         │                            │                            │
         │                      [TX PENDING]                       │
         │                            │                            │
         │                            │  5a. confirmIssue          │
         │                            │      (Vault decrypts,      │
         │                            │       verifies, confirms)  │
         │                            │<───────────────────────────┤
         │                            │                            │
         │                      [TX CONFIRMED]                     │
         │                            │                            │
         │  6. Receive ICZ            │                            │
         │<───────────────────────────┤                            │
         │                            │                            │
    ─────┴────────────────────────────┴────────────────────────────┴─────
```

### Step-by-Step Explanation

#### Step 0: Vault Setup
Vault V registers by:
1. Locking collateral `ICNcol` where: `ICNcol ≥ vmax · (1-f) · σstd · xr`
   - `vmax` = max transaction value
   - `f` = fee rate
   - `σstd` = standard collateralization ratio (e.g., 1.5)
   - `xr` = current exchange rate
2. Providing a Zcash shielded payment address `(d, pkd)`
3. Submitting a **Proof of Capacity** (proves they have room for new deposits)

#### Step 1: Request Lock
Alice requests to lock funds with Vault V:
- Locks warranty collateral `ICNw` (anti-griefing measure)
- If she doesn't follow through, she loses `ICNw`

#### Step 2: Receive Lock Permit
The issuing chain creates a **Lock Permit** containing:
- `emk`: Ephemeral minting public key (from Alice)
- `(d, pkd)`: Vault's payment address
- `npermit`: Cryptographic nonce (BLAKE2b-256 digest)

**Critical**: Alice MUST use `npermit` to derive the commitment trapdoor `rcm` for her Zcash note. This binds the Zcash transaction to this specific permit.

#### Step 3: Lock (Zcash Transaction)
Alice creates a shielded Zcash transaction:
- Sends `ZEClock` to Vault V's shielded address
- **Derives `rcm` from `npermit`** (this is verified in the zk-SNARK)
- Waits for confirmation on Zcash

#### Step 4: Mint (Issuing Chain Transaction)
Alice submits a Mint transaction proving:

**Public Inputs:**
- `cv`: Commitment to ICZ value being minted
- `cvn`: Commitment to ZEC value locked
- `gd, pkd`: Vault's address components
- `npermit`: The nonce from her lock permit
- `cmun`: Note commitment of the locked note

**zk-SNARK (πZKMint) proves:**
1. She knows a note `n` with commitment `cmun`
2. The note is addressed to `(d, pkd)` (the vault)
3. The note has value `ZEClock`
4. `ICZcreate = ZEClock · (1 - f)` (correct fee deduction)
5. `ZEClock ≤ vmax` (within limits)
6. The trapdoor `rcm` was derived from `npermit` (binds to permit)

She also provides:
- Merkle path from `cmun` to `hashFinalSaplingRoot`
- Encrypted note plaintext `Cenc` (so Vault can spend the note later)

**The Mint TX remains PENDING until confirmed.**

#### Step 5: Confirm or Challenge

**Path A - Confirm (Happy Path):**
Vault V:
1. Decrypts `Cenc` using their incoming viewing key
2. Verifies the decrypted note has commitment `cmun`
3. Calls `confirmIssue`
4. Mint TX is finalized, Alice receives ICZ

**Path B - Challenge (Bad Encryption):**
If V cannot decrypt `Cenc` properly:
1. V calls `challengeIssue`
2. Reveals the shared secret used in decryption
3. Chain verifies encryption was indeed wrong
4. Mint TX is **discarded**
5. Alice loses `ZEClock` (stuck on Zcash) AND `ICNw`

**Path C - Timeout:**
If V doesn't respond within `∆confirmIssue`:
1. `ICNw` is deducted from V's collateral and given to Alice
2. Mint TX is finalized anyway
3. This incentivizes V to always respond

---

## The Redeem Protocol

**Goal**: Burn ICZ on Issuing Chain → Receive ZEC on Zcash

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          REDEEM PROTOCOL                                │
└─────────────────────────────────────────────────────────────────────────┘

    REDEEMER (Dave)             ISSUING CHAIN (I)              VAULT (V)
         │                            │                            │
         │                            │                            │
         │  1. burn: Submit Burn Tx   │                            │
         │     - Requested note       │                            │
         │     - Encrypted to Vault   │                            │
         │     - zk-SNARK proof       │                            │
         │     - Lock ICNw            │                            │
         ├───────────────────────────>│                            │
         │                            │                            │
         │                      [TX PENDING]                       │
         │                            │                            │
         │                            │  2. Vault sees request     │
         │                            ├───────────────────────────>│
         │                            │                            │
         │                            │                            │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │          (Optional) CHALLENGE PATH                      │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │                            │                            │
         │                            │  2b. challengeRedeem       │
         │                            │      (if bad encryption)   │
         │                            │<───────────────────────────┤
         │                            │                            │
         │                      [TX DISCARDED]                     │
         │                            │                            │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │              HAPPY PATH                                 │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │                            │                            │
         │                            │                            │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │            ZCASH TRANSACTION                            │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │                            │                            │
         │  3. Vault releases ZEC     │                            │
         │     (creates requested note)                            │
         │<────────────────────────────────────────────────────────┤
         │                            │                            │
         │                            │                            │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │          BACK TO ISSUING CHAIN                          │
    ═════╪════════════════════════════╪════════════════════════════╪═════
         │                            │                            │
         │                            │  4. confirmRedeem          │
         │                            │     (submit inclusion      │
         │                            │      proof for the note)   │
         │                            │<───────────────────────────┤
         │                            │                            │
         │                      [TX CONFIRMED]                     │
         │                            │                            │
    ─────┴────────────────────────────┴────────────────────────────┴─────
```

### Step-by-Step Explanation

#### Step 1: Burn (Issuing Chain Transaction)
Dave submits a Burn transaction:

**Contents:**
- `cv`: Commitment to ICZ being burned
- `cvn`: Commitment to ZEC he wants to receive
- `(d, pkd)`: Vault he's redeeming from
- `cmun`: Commitment to the note he wants (on Zcash)
- `Cenc`: Encrypted note details (so Vault knows what to create)
- `πZKBurn`: zk-SNARK proof

**zk-SNARK (πZKBurn) proves:**
1. He knows a note `n` with commitment `cmun`
2. The note has value `ZECrelease`
3. `ZECrelease = ICZburn · (1 - f)` (correct fee deduction)
4. `ICZburn ≤ vmax` (within limits)

Dave also locks `ICNw` as warranty collateral.

**The Burn TX remains PENDING.**

#### Step 2: Vault Decision

**Path A - Challenge (Bad Encryption):**
If Vault V decrypts `Cenc` and finds it doesn't match `cmun`:
1. V calls `challengeRedeem`
2. Proves encryption was wrong
3. Burn TX is discarded
4. Dave loses `ICNw`

**Path B - Happy Path:**
V decrypts `Cenc` successfully and proceeds to Step 3.

#### Step 3: Release (Zcash Transaction)
Vault V creates the exact note Dave requested:
- Note commitment = `cmun`
- Value = `ZECrelease`
- Addressed to Dave's shielded address

#### Step 4: Confirm Redeem
V submits proof to issuing chain:
- Inclusion proof: Merkle path from `cmun` to a confirmed block's `hashFinalSaplingRoot`

Once verified:
- Burn TX is finalized
- ICZ is permanently destroyed
- Dave's warranty collateral is returned

#### Timeout Case
If V doesn't confirm within `∆confirmRedeem`:
- `ICNw` is deducted from V's collateral → given to Dave
- Burn TX is **discarded** (Dave keeps his ICZ)
- Dave can try again with a different vault

---

## Vault Balance Proofs

Since vault holdings are hidden, ZCLAIM requires three types of balance proofs:

### 1. Proof of Balance (POB)

**Purpose**: Prove vault has sufficient collateral for current obligations

**Proves in zero-knowledge:**
```
(Σ mint_values - Σ burn_values) · xr · σstd ≤ collateral
```

Where:
- `mint_values` = all ZEC locked with this vault
- `burn_values` = all ZEC released by this vault
- `xr` = exchange rate
- `σstd` = standard collateralization ratio

**When Required**: Periodically, or when exchange rate changes significantly

### 2. Proof of Capacity (POC)

**Purpose**: Prove vault can accept new deposits

**Proves**: After accepting a maximum-value deposit, the vault would still satisfy POB

**When Required**: Before vault can accept lock requests

### 3. Proof of Insolvency (POI)

**Purpose**: Prove vault has too little ZEC to service redeems

**Proves**: Current ZEC obligations < `vmax` (minimum redeem amount)

**When Required**: When vault wants to opt out of redeem requests

---

## The Splitting Strategy

### The Privacy Problem

Even with shielded transactions, vaults learn the **individual amounts** sent to/from them. A single large transaction could be identifying.

### The Solution: Split into Fixed Denominations

ZCLAIM recommends splitting transactions into powers of 2:

```
Example: Alice wants to issue 13.5 ZEC

Base-2 Splitting:
13.5 ZEC = 8 + 4 + 1 + 0.5 ZEC

Alice makes 4 separate transactions:
├── 8.0 ZEC → Vault A
├── 4.0 ZEC → Vault B  
├── 1.0 ZEC → Vault C
└── 0.5 ZEC → Vault D

Result: No single vault knows Alice's total (13.5 ZEC)
```

### Protocol Constants

| Constant | Description |
|:---------|:------------|
| `vmax` | Maximum value per transaction (power of 2) |
| `vmin` | Minimum value per transaction (power of 2) |
| `f` | Fee rate (e.g., 1/256) |
| `σstd` | Standard collateralization ratio (e.g., 1.5) |
| `σmin` | Minimum ratio before liquidation (e.g., 1.125) |
| `∆mint` | Timeout for mint after lock request |
| `∆confirmIssue` | Timeout for vault to confirm/challenge issue |
| `∆confirmRedeem` | Timeout for vault to confirm/challenge redeem |
| `ICNw` | Warranty collateral amount |

---

## Security Properties

### 1. Soundness
> Total circulating ICZ = Total ZEC obligations

**Achieved via**: Homomorphic value commitments aggregated in vault registry

### 2. Coverage
> ZEC obligations are backed by proportional collateral

**Achieved via**: 
- Periodic Proofs of Balance
- Liquidation when `σV ≤ σmin`

### 3. Fairness
> Honest participants don't lose funds

**Achieved via**:
- Challenge mechanism for bad encryption
- Timeouts with slashing for unresponsive vaults
- Warranty collateral for unresponsive users

### 4. Untraceability
> Cannot identify users through protocol observation

**Achieved via**:
- Splitting strategy
- Shielded addresses can be randomized per transaction
- No public amounts anywhere

---

## Challenges and Solutions

### Challenge 1: Opacity of Transactions

**Problem**: Can't see inside shielded transactions to verify them.

**Solution**: Use zk-SNARKs to prove statements about notes without revealing contents. The `hashFinalSaplingRoot` in block headers enables proving note existence via Merkle paths.

### Challenge 2: Note Encryption Verification

**Problem**: How to ensure the vault can actually spend the locked ZEC?

**Solution**: Challenge/Confirm mechanism:
- Sender publishes encrypted note
- Receiver can challenge if encryption is wrong
- If no challenge, transaction proceeds

### Challenge 3: Large Block Headers

**Problem**: Zcash headers are ~1.5KB (vs Bitcoin's 80 bytes). Storing all headers is impractical.

**Solution**: 
- FlyClient protocol (logarithmic verification)
- Selective header storage
- Only store confirmed block headers

### Challenge 4: Vault Collateralization

**Problem**: Can't see vault's actual ZEC holdings to verify collateral.

**Solution**: 
- Homomorphic commitments track obligations
- Vaults submit zk-SNARK balance proofs
- Automatic liquidation if observed ratio drops

---

## Summary

ZCLAIM successfully bridges Zcash to other chains while maintaining privacy by:

1. **Replacing SPV proofs with zk-SNARKs** that prove note existence without revealing details
2. **Using challenge/confirm mechanisms** to handle encrypted note transmission
3. **Introducing Mint/Burn transfers** that integrate seamlessly with Sapling
4. **Requiring periodic balance proofs** from vaults since their holdings are hidden
5. **Recommending splitting strategies** to prevent vaults from learning total transaction amounts

This makes ZCLAIM the first protocol to achieve **truly private cross-chain transfers**.

---

## References

- Sánchez, A. (2020). *Confidential Cross-Blockchain Exchanges: Designing a Privacy-Preserving Interoperability Scheme*. Master Thesis, ETH Zürich.
- Zamyatin, A. et al. (2019). *XCLAIM: Trustless, Interoperable, Cryptocurrency-Backed Assets*. IEEE S&P.
- Zcash Protocol Specification (Sapling). https://zips.z.cash/protocol/protocol.pdf
