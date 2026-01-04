# Research: XCLAIM vs ZCLAIM

This document analyzes and compares two research papers: **XCLAIM** and **ZCLAIM**, to support the development of a Zcash bridge.

## Executive Summary

- **XCLAIM** provides the foundational framework for trustless, cross-chain assets using collateralized intermediaries ("Vaults") and chain relays. It focuses on efficiency and decentralization but operates on public ledgers (Bitcoin/Ethereum).
- **ZCLAIM** extends the XCLAIM framework specifically for **privacy**. It integrates Zcash's Sapling protocol (zk-SNARKs) to ensure that cross-chain transfers do not reveal transaction amounts or participant identities, addressing the privacy leakage inherent in standard XCLAIM.

---

## Common Factors

Both protocols share the same fundamental architecture for bridging assets without a trusted central authority.

1.  **Architecture (The "Lock-Mint-Burn-Redeem" Model):**

    - **Issuing (Lock/Mint):** Users lock the native asset (e.g., BTC or ZEC) on the backing chain to mint a 1:1 tokenized representation (wrapped asset) on the issuing chain.
    - **Redeeming (Burn/Unlock):** Users burn the wrapped asset on the issuing chain to release the native asset on the backing chain.

2.  **Role of Intermediaries (Vaults):**

    - Both rely on a dynamic set of untrusted intermediaries called **Vaults**.
    - Vaults lock collateral (in the issuing chain's currency) to guarantee honest behavior.
    - If a Vault steals funds or fails to execute a redemption, their collateral is slashed (proof-or-punishment) to reimburse the user.

3.  **Cross-Chain Verification (Relays):**

    - Both utilize **Chain Relays** (smart contracts acting as light clients) on the issuing chain to verify the state and transactions of the backing chain.

4.  **Trust Model:**
    - Both are **trustless** (or trust-minimized) regarding intermediaries. Security relies on economic incentives (collateral > value locked) and cryptographic proofs rather than reputation.

---

## How XCLAIM Works (Step-by-Step)

XCLAIM enables users to issue Bitcoin-backed tokens on Ethereum (or any smart contract chain) without trusting a central party.

### Actors

| Actor                            | Role                                                                                                                      |
| :------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| **Requester**                    | Locks BTC on Bitcoin to receive iBTC (wrapped BTC) on the issuing chain.                                                  |
| **Redeemer**                     | Burns iBTC on the issuing chain to receive BTC back on Bitcoin.                                                           |
| **Vault**                        | A non-trusted intermediary that holds locked BTC and fulfills redemptions. Must post collateral.                          |
| **Issuing Smart Contract (iSC)** | A public smart contract on the issuing chain that manages all operations and enforces rules.                              |
| **BTC-Relay**                    | A smart contract on the issuing chain that acts as a Bitcoin light client, verifying Bitcoin transactions via SPV proofs. |

### Protocol 1: Issue (Lock BTC → Mint iBTC)

```
┌─────────────┐                      ┌─────────────┐                      ┌─────────────┐
│   BITCOIN   │                      │  ETHEREUM   │                      │    VAULT    │
│  (Backing)  │                      │  (Issuing)  │                      │ (Collateral │
│             │                      │             │                      │   Posted)   │
└─────────────┘                      └─────────────┘                      └─────────────┘
      │                                    │                                    │
      │  1. Alice locks X BTC              │                                    │
      │     to Vault's BTC address         │                                    │
      ├───────────────────────────────────>│                                    │
      │                                    │                                    │
      │  2. Alice submits SPV proof        │                                    │
      │     of her BTC lock tx             │                                    │
      │                                    │                                    │
      │                              ┌─────┴─────┐                              │
      │                              │ BTC-Relay │                              │
      │                              │ verifies  │                              │
      │                              │ the proof │                              │
      │                              └─────┬─────┘                              │
      │                                    │                                    │
      │  3. iSC mints X iBTC to Alice      │                                    │
      │                                    │                                    │
      │                              [Alice now owns X iBTC on Ethereum]        │
```

**Key Point:** The Vault never needs to "approve" the issuance. The smart contract automatically mints iBTC once it cryptographically verifies the Bitcoin lock transaction.

### Protocol 2: Transfer (iBTC on Issuing Chain)

Transferring iBTC is a standard token transfer on the issuing chain (e.g., an ERC-20 transfer on Ethereum). No interaction with Bitcoin or Vaults is needed.

### Protocol 3: Swap (iBTC ↔ ETH Atomically)

The iSC can facilitate atomic swaps between iBTC and other assets on the issuing chain using a simple lock/release mechanism within the smart contract.

### Protocol 4: Redeem (Burn iBTC → Unlock BTC)

```
┌─────────────┐                      ┌─────────────┐                      ┌─────────────┐
│   BITCOIN   │                      │  ETHEREUM   │                      │    VAULT    │
│  (Backing)  │                      │  (Issuing)  │                      │             │
└─────────────┘                      └─────────────┘                      └─────────────┘
      │                                    │                                    │
      │                   1. Dave burns X iBTC on iSC                           │
      │                      and requests redemption to his BTC address         │
      │                                    ├───────────────────────────────────>│
      │                                    │                                    │
      │                   2. Vault sees the request                             │
      │                                    │                                    │
      │  3. Vault sends X BTC to Dave's    │                                    │
      │     specified BTC address          │<───────────────────────────────────┤
      │                                    │                                    │
      │  4. Vault submits SPV proof        │                                    │
      │     of BTC release tx to iSC       │                                    │
      │                                    ├───────────────────────────────────>│
      │                              ┌─────┴─────┐                              │
      │                              │ BTC-Relay │                              │
      │                              │ verifies  │                              │
      │                              └─────┬─────┘                              │
      │                                    │                                    │
      │                   5. iSC confirms redemption complete                   │
      │                                    │                                    │
      │                              [Dave now owns X BTC on Bitcoin]           │
```

**What if Vault Fails to Redeem?**
If the Vault does not provide a valid SPV proof of the BTC release within a timeout period (∆redeem), the iSC automatically **slashes the Vault's collateral** and reimburses Dave with an equivalent value on the issuing chain.

---

## How ZCLAIM Works (Step-by-Step)

ZCLAIM is XCLAIM adapted for **Zcash's privacy-preserving Sapling protocol**. The core difference is that it uses **shielded transactions** and **zk-SNARKs** to hide all amounts and identities.

### Key Concepts from Zcash

| Concept             | Explanation                                                                                                                           |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------ |
| **Note**            | A Zcash note is like a "private coin." It encapsulates a value `v` that can be spent by the holder of a specific spending key.        |
| **Note Commitment** | A cryptographic commitment to a note. Added to a public tree when a note is created. Reveals nothing about the note's value or owner. |
| **Nullifier**       | A unique identifier revealed when a note is spent. Prevents double-spending without linking back to the original note.                |
| **zk-SNARK**        | A zero-knowledge proof that allows proving a statement is true without revealing any underlying information.                          |

### Components on the Issuing Chain

1.  **Vault Registry:** Keeps track of registered Vaults, their shielded addresses, and their collateral status.
2.  **Relay System:** Verifies Zcash block headers and allows verification of Zcash notes via Merkle proofs.
3.  **Exchange Rate Oracle:** Provides the ZEC/i (issuing chain currency) exchange rate for collateral calculations.
4.  **Protocol Logic (Smart Contract):** Manages issue/redeem logic, including zk-SNARK verification.

### Protocol 1: Issue (Lock ZEC → Mint wZEC)

```
┌─────────────┐                      ┌─────────────┐                      ┌─────────────┐
│    ZCASH    │                      │ ISSUING     │                      │    VAULT    │
│  (Backing)  │                      │   CHAIN     │                      │ (Shielded   │
│             │                      │             │                      │   Address)  │
└─────────────┘                      └─────────────┘                      └─────────────┘
      │                                    │                                    │
      │                   1. Alice commits to issue request                     │
      │                      (locks small warranty collateral iw)               │
      │                                    │                                    │
      │  2. Alice creates a SHIELDED       │                                    │
      │     tx on Zcash, sending ZEC       │                                    │
      │     to Vault's shielded address    │                                    │
      │     (Amount is HIDDEN)             │                                    │
      ├───────────────────────────────────>│                                    │
      │                                    │                                    │
      │  3. Alice submits a zk-SNARK proof │                                    │
      │     to the issuing chain proving:  │                                    │
      │     - A valid note was created     │                                    │
      │     - The note is addressed to V   │                                    │
      │     - wZEC_create = ZEC_lock*(1-f) │                                    │
      │     (Without revealing ZEC_lock!)  │                                    │
      │                                    │                                    │
      │                              ┌─────┴─────┐                              │
      │                              │  Verify   │                              │
      │                              │ zk-SNARK  │                              │
      │                              └─────┬─────┘                              │
      │                                    │                                    │
      │                   4. Pending tx: Wait for Vault to Confirm/Challenge    │
      │                                    │                                    │
      │                   5a. CONFIRM: Vault decrypts encrypted note data,      │
      │                       verifies it matches, confirms the tx.             │
      │                       -> wZEC is minted to Alice's shielded address.    │
      │                                    │                                    │
      │                   5b. CHALLENGE: Vault proves Alice encrypted bad data. │
      │                       -> Tx is cancelled, Alice loses ZEC + iw.         │
      │                                    │                                    │
```

**Privacy Enhancement (Splitting Strategy):**
To prevent a Vault from knowing Alice's total transfer amount, Alice splits her ZEC into `n` parts and sends each to a different Vault. No single Vault knows the total. On the issuing chain, she can then combine the minted wZEC privately.

### Protocol 2: Redeem (Burn wZEC → Unlock ZEC)

```
┌─────────────┐                      ┌─────────────┐                      ┌─────────────┐
│    ZCASH    │                      │ ISSUING     │                      │    VAULT    │
│  (Backing)  │                      │   CHAIN     │                      │             │
└─────────────┘                      └─────────────┘                      └─────────────┘
      │                                    │                                    │
      │                   1. Dave submits a BURN tx on the issuing chain:       │
      │                      - Burns wZEC_burn                                  │
      │                      - Includes a commitment to a note he wants on Zcash│
      │                      - Proves ZEC_release = wZEC_burn * (1-f)           │
      │                      - Encrypts note details to the Vault               │
      │                                    ├───────────────────────────────────>│
      │                                    │                                    │
      │                   2. Vault decrypts note details                        │
      │                                    │                                    │
      │                   2a. CHALLENGE: If encryption was wrong, Vault         │
      │                       challenges -> tx is cancelled.                    │
      │                                    │                                    │
      │  3. Vault creates the specified    │                                    │
      │     note on Zcash (sends ZEC to    │                                    │
      │     Dave's shielded address)       │                                    │
      │<───────────────────────────────────┤                                    │
      │                                    │                                    │
      │  4. Vault submits inclusion proof  │                                    │
      │     for the note to issuing chain  │                                    │
      │                                    │<───────────────────────────────────┤
      │                              ┌─────┴─────┐                              │
      │                              │  Verify   │                              │
      │                              │  Proof    │                              │
      │                              └─────┬─────┘                              │
      │                                    │                                    │
      │                   5. Burn tx is finalized.                              │
      │                                    │                                    │
      │                              [Dave now owns ZEC on Zcash]               │
```

**What if Vault Fails?**
Similar to XCLAIM, if the Vault fails to provide the inclusion proof within a timeout, its collateral is slashed. The key difference is that the proof must verify a _shielded_ note creation.

---

## Key Differences

The primary divergence lies in **Privacy** and the **Cryptographic Primitives** used to achieve it.

| Feature               | XCLAIM                                                                                                                | ZCLAIM                                                                                                                                                                                 |
| :-------------------- | :-------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Primary Goal**      | Trustless, efficient interoperability.                                                                                | **Private** trustless interoperability.                                                                                                                                                |
| **Privacy Level**     | **Public/Transparent.** All transaction amounts, sender/receiver identities, and vault holdings are visible on-chain. | **Private/Shielded.** Uses Zcash's shielded pool. Hides sender/receiver identities and transaction amounts.                                                                            |
| **Backing Chain**     | Designed for **Bitcoin** (and similar transparent ledgers).                                                           | Designed for **Zcash** (specifically the Sapling upgrade).                                                                                                                             |
| **Cryptography**      | Standard signatures (ECDSA) and SPV proofs (Merkle paths).                                                            | **zk-SNARKs** (Zero-Knowledge Succinct Non-Interactive Arguments of Knowledge) and Note Encryption.                                                                                    |
| **Vault Interaction** | User sends funds to a Vault's public address. The amount is known.                                                    | User sends funds to a Vault's **shielded address**. The amount is hidden using a "splitting strategy" (sending partial amounts to multiple vaults) so no single vault knows the total. |
| **Issuing Process**   | 1. Lock BTC.<br>2. Submit SPV proof to Smart Contract.<br>3. Mint tokens.                                             | 1. Lock ZEC (Shielded Transfer).<br>2. Submit **zk-SNARK** to Smart Contract proving a note exists without revealing details.<br>3. Mint tokens.                                       |
| **Complexity**        | Lower. Relies on standard smart contract logic.                                                                       | Higher. Requires verification of zk-SNARKs on the issuing chain and handling encrypted notes.                                                                                          |

## Implications for Zcash Bridge Development

To build a Zcash bridge for a direct chain:

1.  **Base Logic:** You can reuse the core state machine of XCLAIM (Vault registry, collateral management, liquidation logic).
2.  **Privacy Layer:** You must implement the ZCLAIM enhancements:
    - **On-Chain Verification:** The issuing chain must be able to verify Zcash's zk-SNARKs (Groth16 or similar).
    - **Shielded Awareness:** The bridge contract needs to understand Zcash "Notes" and "Nullifiers" to prevent double-spending without seeing the values.
    - **Encryption:** You need a mechanism for users to securely transmit note decryption keys to Vaults so Vaults can eventually spend/redeem the ZEC.

## References

- **XCLAIM:** _XCLAIM: Trustless, Interoperable, Cryptocurrency-Backed Assets_ (Zamyatin et al., 2019)
- **ZCLAIM:** _Bridging Sapling: Private Cross-Chain Transfers_ (Sanchez et al., 2022)
