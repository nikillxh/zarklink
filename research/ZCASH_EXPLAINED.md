# Understanding Zcash: A Complete Guide

This document explains how **Zcash** works, from its foundational concepts to its cryptographic mechanisms. Understanding Zcash is essential before building a Zcash bridge (ZCLAIM).

---

## Table of Contents

1. [What is Zcash?](#what-is-zcash)
2. [Transparent vs Shielded Transactions](#transparent-vs-shielded-transactions)
3. [Key Cryptographic Concepts](#key-cryptographic-concepts)
4. [The Sapling Protocol](#the-sapling-protocol)
5. [How Shielded Transactions Work](#how-shielded-transactions-work)
6. [Address Types](#address-types)
7. [Why This Matters for Bridges](#why-this-matters-for-bridges)

---

## What is Zcash?

**Zcash (ZEC)** is a privacy-focused cryptocurrency that launched in 2016. It is a fork of Bitcoin but adds **optional privacy features** using advanced cryptography called **zk-SNARKs** (Zero-Knowledge Succinct Non-Interactive Arguments of Knowledge).

### Key Properties

| Property                | Bitcoin         | Zcash                 |
| :---------------------- | :-------------- | :-------------------- |
| **Transaction Amounts** | Public          | Can be hidden         |
| **Sender Address**      | Public          | Can be hidden         |
| **Receiver Address**    | Public          | Can be hidden         |
| **Transaction Graph**   | Fully traceable | Optionally unlinkable |

> **In simple terms:** Bitcoin is like writing a check — everyone can see who paid whom and how much. Zcash (shielded) is like handing over cash in a sealed envelope — only the sender and receiver know what's inside.

---

## Transparent vs Shielded Transactions

Zcash supports **two types of transactions**:

### 1. Transparent Transactions (t-addresses)

- Work exactly like Bitcoin.
- All inputs, outputs, and amounts are **publicly visible** on the blockchain.
- Addresses start with `t1` or `t3`.

### 2. Shielded Transactions (z-addresses)

- Use **zk-SNARKs** to hide transaction details.
- Sender, receiver, and amount are **encrypted**.
- Addresses start with `zs` (Sapling) or `zc` (legacy Sprout).

### Transaction Types

```
┌─────────────────────────────────────────────────────────────────┐
│                    ZCASH TRANSACTION TYPES                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  t-addr ──────> t-addr     (Fully Transparent - like Bitcoin)  │
│                                                                 │
│  t-addr ──────> z-addr     (Shielding - entering private pool) │
│                                                                 │
│  z-addr ──────> z-addr     (Fully Shielded - maximum privacy)  │
│                                                                 │
│  z-addr ──────> t-addr     (Deshielding - exiting private pool)│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Cryptographic Concepts

### 1. zk-SNARKs (Zero-Knowledge Proofs)

A **zk-SNARK** allows someone to prove they know something **without revealing the thing itself**.

**Example:**

- Alice wants to prove she has more than 10 ZEC without revealing her exact balance.
- She generates a zk-SNARK proof.
- Anyone can verify the proof is valid, but they learn nothing about her actual balance.

**Properties:**

- **Zero-Knowledge:** Reveals nothing beyond the statement's truth.
- **Succinct:** The proof is small (a few hundred bytes).
- **Non-Interactive:** No back-and-forth communication needed.

### 2. Pedersen Commitments (Value Commitments)

A **commitment** is a cryptographic way to "lock in" a value without revealing it.

```
Commitment = Hash(value, random_blinding_factor)
```

- You can later "open" the commitment by revealing the value and blinding factor.
- Without the blinding factor, no one can determine the value from the commitment.

In Zcash, **value commitments** hide transaction amounts while still allowing the network to verify that inputs equal outputs.

### 3. Merkle Trees

Zcash uses **Merkle trees** to efficiently store and verify data:

```
                    [Root Hash]
                    /         \
            [Hash AB]         [Hash CD]
            /      \          /      \
        [Hash A] [Hash B] [Hash C] [Hash D]
           |        |        |        |
        Note 1   Note 2   Note 3   Note 4
```

- The **Note Commitment Tree** stores all note commitments ever created.
- To prove a note exists, you only need to provide a **Merkle path** (a few hashes), not the entire tree.

---

## The Sapling Protocol

**Sapling** is Zcash's current shielded protocol (activated in 2018). It replaced the older "Sprout" protocol with significant improvements:

| Feature                     | Sprout (Legacy) | Sapling (Current)  |
| :-------------------------- | :-------------- | :----------------- |
| **Proving Time**            | ~40 seconds     | ~2 seconds         |
| **Memory Required**         | ~3 GB           | ~40 MB             |
| **Key Separation**          | No              | Yes (viewing keys) |
| **Hardware Wallet Support** | No              | Yes                |

### Key Innovation: Viewing Keys

Sapling introduced **viewing keys** that allow:

- **Incoming Viewing Key:** See all incoming transactions to an address.
- **Full Viewing Key:** See all incoming and outgoing transactions.
- **Spending Key:** Actually spend the funds.

This enables use cases like auditing without giving up control of funds.

---

## How Shielded Transactions Work

### Core Concept: Notes

In Zcash's shielded pool, value is represented as **Notes** (not UTXOs like Bitcoin).

A **Note** contains:

```
Note = {
    d:        diversifier (address component)
    pk_d:     diversified transmission key (address component)
    v:        value (amount of ZEC)
    rcm:      random commitment trapdoor (blinding factor)
}
```

### The Note Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           NOTE LIFECYCLE                                    │
└─────────────────────────────────────────────────────────────────────────────┘

  1. NOTE CREATION (Output Transfer)
  ───────────────────────────────────
     Sender creates a note for the recipient.

     → Note Commitment = Hash(note)
     → Note Commitment is added to the Note Commitment Tree (public)
     → Encrypted note values are published (only recipient can decrypt)


  2. NOTE EXISTS (Unspent)
  ────────────────────────
     The note sits in the "shielded pool."

     → Only the owner (with spending key) can spend it.
     → No one else knows who owns it or its value.


  3. NOTE SPENDING (Spend Transfer)
  ─────────────────────────────────
     Owner spends the note.

     → Generates a zk-SNARK proving:
        • They know a valid note
        • Its commitment is in the Commitment Tree
        • They have the spending key

     → Reveals the NULLIFIER (unique to this note)
     → Nullifier is added to the Nullifier Set (public)
     → Original note commitment CANNOT be linked to nullifier
```

### Preventing Double-Spending

The **Nullifier** mechanism prevents double-spending without revealing which note was spent:

1. Each note has a unique nullifier (derived from the note and spending key).
2. When a note is spent, its nullifier is published.
3. If someone tries to spend the same note again, the nullifier would already be in the set → rejected.
4. **Crucially:** The nullifier cannot be linked back to the note commitment, preserving privacy.

### Transaction Balance

Even though amounts are hidden, Zcash ensures **value is conserved**:

```
Sum(Input Value Commitments) + Sum(Transparent Inputs)
    =
Sum(Output Value Commitments) + Sum(Transparent Outputs) + Fee
```

This is verified using **homomorphic properties** of Pedersen commitments — you can add commitments without knowing the underlying values.

---

## Address Types

### Sapling Addresses (z-addresses)

```
zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtaqa...
```

Components:

- **Diversifier (d):** 11 bytes, allows generating many addresses from one key.
- **Transmission Key (pk_d):** Used to encrypt note data to the recipient.

### Transparent Addresses (t-addresses)

```
t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs
```

Work exactly like Bitcoin addresses (P2PKH or P2SH).

### Unified Addresses (Orchard - Newest)

Zcash's latest upgrade, **Orchard**, introduced **Unified Addresses** that combine transparent and shielded capabilities in a single address string.

---

## Why This Matters for Bridges

Building a Zcash bridge (like ZCLAIM) is complex because of these privacy features:

### Challenge 1: Proving Funds Were Locked

In Bitcoin (XCLAIM), you can submit an **SPV proof** showing a transaction sent funds to a specific address. Anyone can verify this.

In Zcash (ZCLAIM), shielded transactions don't reveal the recipient or amount. Instead:

- You must provide a **zk-SNARK** proving a valid note was created.
- The proof reveals nothing about the note's contents.

### Challenge 2: Vaults Can't See Their Balances

Vaults receive shielded ZEC but the amounts are hidden. To manage collateral:

- Vaults must periodically submit **proofs of balance** (zk-SNARKs proving their obligations match their holdings).

### Challenge 3: Note Encryption

When sending to a Vault:

- The note's values must be encrypted to the Vault so they can eventually spend it.
- But if the sender encrypts garbage, the Vault can't spend the ZEC.
- ZCLAIM handles this with a **challenge period** where Vaults can prove bad encryption.

### Challenge 4: Amount Hiding from Vaults

Even with encryption, Vaults learn the individual amounts sent to them. ZCLAIM uses a **splitting strategy**:

- Split your total into N parts.
- Send each part to a different Vault.
- No single Vault knows your total transaction amount.

---

## Summary

| Concept              | What It Does                                             |
| :------------------- | :------------------------------------------------------- |
| **zk-SNARK**         | Proves a statement without revealing underlying data     |
| **Note**             | A private representation of value (like a shielded UTXO) |
| **Note Commitment**  | A hash of a note, added to a public tree                 |
| **Nullifier**        | Revealed when spending a note; prevents double-spend     |
| **Value Commitment** | Hides the amount while allowing balance verification     |
| **Spending Key**     | Required to spend notes                                  |
| **Viewing Key**      | Allows viewing transactions without spending ability     |

---

## References

- [Zcash Protocol Specification](https://zips.z.cash/protocol/protocol.pdf)
- [Sapling Specification](https://github.com/zcash/zips/blob/main/protocol/sapling.pdf)
- [What are zk-SNARKs?](https://z.cash/technology/zksnarks/)
- [Zcash Explained (Electric Coin Co.)](https://electriccoin.co/zcash-explained/)
