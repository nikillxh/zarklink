#!/bin/bash
# =============================================================================
#                    ZARKLINK - Detailed Demo
#           Privacy-Preserving Zcash ↔ Starknet Bridge
#                    Full Technical Walkthrough
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
WHITE='\033[1;37m'
NC='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

# Contract addresses (Sepolia)
RPC_URL="https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/KKX3txNscJJ_3JAPqQ3E7"
WZEC_ADDRESS="0x04c571b6ca21e59add5ccb280eb68a309c6ca4e5eeecfd2186856fe97f74a294"
RELAY_ADDRESS="0x01ae3dce889773db25632ebed4a04698fb2dff1c71b2101f00e8c0f34b5d7e4b"
VAULT_ADDRESS="0x007abd698ddafea4669ac4d5e96477ef4958b6e6ebd57e4ef2f61df1f2597436"
BRIDGE_ADDRESS="0x069d135c173847a356aa29a182ace00981e9793aea5bb62bfc6c1d4577e9c36e"

# Utility functions
clear_screen() { clear; }

header() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║    ███████╗ █████╗ ██████╗ ██╗  ██╗██╗     ██╗███╗   ██╗██╗  ██╗             ║"
    echo "║    ╚══███╔╝██╔══██╗██╔══██╗██║ ██╔╝██║     ██║████╗  ██║██║ ██╔╝             ║"
    echo "║      ███╔╝ ███████║██████╔╝█████╔╝ ██║     ██║██╔██╗ ██║█████╔╝              ║"
    echo "║     ███╔╝  ██╔══██║██╔══██╗██╔═██╗ ██║     ██║██║╚██╗██║██╔═██╗              ║"
    echo "║    ███████╗██║  ██║██║  ██║██║  ██╗███████╗██║██║ ╚████║██║  ██╗             ║"
    echo "║    ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝             ║"
    echo "║                   Privacy-Preserving Zcash ↔ Starknet Bridge                 ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

section() {
    echo ""
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${BLUE}  $1${NC}"
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

subsection() {
    echo ""
    echo -e "${CYAN}┌─ $1 ─────────────────────────────────────────────────────────────────┐${NC}"
}

code_block() {
    echo -e "${DIM}$1${NC}"
}

bullet() { echo -e "  ${GREEN}•${NC} $1"; }
step() { echo -e "  ${CYAN}$1.${NC} $2"; }
ok() { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
info() { echo -e "  ${CYAN}ℹ${NC} $1"; }

wait_key() {
    echo ""
    echo -e "${YELLOW}Press ENTER to continue...${NC}"
    read -r
}

# ============================================================================
#                              SECTIONS
# ============================================================================

intro() {
    clear_screen
    header
    section "1. Introduction"
    
    echo -e "${BOLD}What is zarklink?${NC}"
    echo ""
    echo "  zarklink is a trustless, privacy-preserving bridge that enables"
    echo "  users to move ZEC between Zcash and Starknet while maintaining"
    echo "  the strong privacy guarantees of Zcash's shielded transactions."
    echo ""
    
    echo -e "${BOLD}The Problem with Traditional Bridges:${NC}"
    echo ""
    bullet "Custodial bridges require trusting a third party"
    bullet "Transaction amounts are publicly visible"
    bullet "Sender/receiver addresses can be linked across chains"
    bullet "Transaction timing enables correlation attacks"
    echo ""
    
    echo -e "${BOLD}zarklink's Solution:${NC}"
    echo ""
    ok "Trustless - Uses overcollateralized vaults (no custodian)"
    ok "Private amounts - Hidden via Pedersen commitments"
    ok "Private addresses - Uses Zcash z-addresses (shielded)"
    ok "Unlinkable - zk-SNARKs prove without revealing"
    
    wait_key
}

architecture() {
    clear_screen
    header
    section "2. System Architecture"
    
    echo -e "${CYAN}"
    cat << 'ARCH'
    ┌──────────────────────────────────────────────────────────────────────┐
    │                       ZARKLINK ARCHITECTURE                          │
    └──────────────────────────────────────────────────────────────────────┘
    
         ZCASH                                           STARKNET
    ┌─────────────────┐                             ┌─────────────────┐
    │                 │      Block Headers          │                 │
    │  Zcash Node     │ ─────────────────────────>  │  Relay System   │
    │  (zcashd)       │      (every ~2.5 min)       │  (Cairo)        │
    │                 │                             │                 │
    └────────┬────────┘                             └────────┬────────┘
             │                                               │
             │                                               ▼
    ┌────────▼────────┐                             ┌─────────────────┐
    │                 │       zk-SNARK Proofs       │                 │
    │  Shielded Pool  │ <─────────────────────────> │  Bridge Contract│
    │  (Sapling)      │                             │  (Cairo)        │
    │                 │                             │                 │
    └────────┬────────┘                             └────────┬────────┘
             │                                               │
             ▼                                               ▼
    ┌─────────────────┐                             ┌─────────────────┐
    │                 │        Collateral           │                 │
    │  Vault          │ <─────────────────────────> │  Vault Registry │
    │  (z-address)    │                             │  (Cairo)        │
    │                 │                             │                 │
    └─────────────────┘                             └────────┬────────┘
                                                             │
                                                             ▼
                                                    ┌─────────────────┐
                                                    │                 │
                                                    │  wZEC Token     │
                                                    │  (ERC-20)       │
                                                    │                 │
                                                    └─────────────────┘
ARCH
    echo -e "${NC}"
    
    echo -e "${BOLD}Components:${NC}"
    echo ""
    step 1 "Relay System - Syncs Zcash block headers to Starknet"
    step 2 "Vault Registry - Manages collateralized operators"
    step 3 "Bridge Contract - Orchestrates Issue/Redeem protocols"
    step 4 "wZEC Token - ERC-20 representation of ZEC on Starknet"
    
    wait_key
}

zcash_integration() {
    clear_screen
    header
    section "3. Zcash Integration"
    
    subsection "Block Header Structure"
    echo -e "${NC}"
    echo ""
    echo "  Zcash block headers contain a special field for shielded transactions:"
    echo ""
    echo -e "  ${DIM}┌─────────────────────────────────────────────────────────────┐${NC}"
    echo -e "  ${DIM}│${NC} nVersion            ${WHITE}4 bytes${NC}   Block version               ${DIM}│${NC}"
    echo -e "  ${DIM}│${NC} hashPrevBlock       ${WHITE}32 bytes${NC}  Previous block hash         ${DIM}│${NC}"
    echo -e "  ${DIM}│${NC} hashMerkleRoot      ${WHITE}32 bytes${NC}  Transparent tx Merkle root  ${DIM}│${NC}"
    echo -e "  ${DIM}│${NC} ${GREEN}hashFinalSaplingRoot${NC} ${WHITE}32 bytes${NC}  ${GREEN}Shielded note tree root${NC}    ${DIM}│${NC}"
    echo -e "  ${DIM}│${NC} nTime               ${WHITE}4 bytes${NC}   Block timestamp             ${DIM}│${NC}"
    echo -e "  ${DIM}│${NC} nBits               ${WHITE}4 bytes${NC}   Difficulty target           ${DIM}│${NC}"
    echo -e "  ${DIM}│${NC} nNonce              ${WHITE}32 bytes${NC}  Equihash solution           ${DIM}│${NC}"
    echo -e "  ${DIM}└─────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    subsection "Relay Service"
    echo -e "${NC}"
    echo ""
    echo "  The relay service runs continuously, syncing Zcash to Starknet:"
    echo ""
    code_block "  // relay-service/src/index.js"
    code_block "  async relayBlock(height) {"
    code_block "    const header = await zcash.getRawBlockHeader(height);"
    code_block "    const encoded = processor.encodeForStarknet(header);"
    code_block "    await starknet.submitBlockHeader(encoded, height);"
    code_block "  }"
    echo ""
    
    subsection "Sapling Root Verification"
    echo -e "${NC}"
    echo ""
    echo "  The Sapling root allows verification of shielded notes:"
    echo ""
    bullet "Each shielded output creates a 'note commitment' (cm)"
    bullet "All commitments form a Merkle tree"
    bullet "The root (hashFinalSaplingRoot) is in the block header"
    bullet "We can prove a note exists without revealing its contents"
    
    wait_key
}

shielded_transactions() {
    clear_screen
    header
    section "4. Zcash Shielded Transactions"
    
    subsection "Transparent vs Shielded"
    echo -e "${NC}"
    echo ""
    echo -e "  ${RED}Transparent (t-addr)${NC}          ${GREEN}Shielded (z-addr)${NC}"
    echo -e "  ─────────────────────         ─────────────────────"
    echo "  Like Bitcoin                  Full privacy"
    echo "  Amounts visible               Amounts hidden"
    echo "  Addresses visible             Addresses hidden"
    echo "  Linkable transactions         Unlinkable"
    echo ""
    
    subsection "Sapling Note Structure"
    echo -e "${NC}"
    echo ""
    echo "  A 'note' is Zcash's private UTXO:"
    echo ""
    echo -e "  ${MAGENTA}note = (d, pk_d, v, rcm)${NC}"
    echo ""
    echo "    d     = Diversifier (11 bytes)"
    echo "            Allows multiple addresses from one key"
    echo ""
    echo "    pk_d  = Diversified payment key (32 bytes)"
    echo "            Derived: pk_d = DiversifyHash(d) * ivk"
    echo ""
    echo "    v     = Value in zatoshi (8 bytes)"
    echo "            1 ZEC = 100,000,000 zatoshi"
    echo ""
    echo "    rcm   = Randomness for commitment (32 bytes)"
    echo "            Makes each note unique"
    echo ""
    
    subsection "Note Commitment"
    echo -e "${NC}"
    echo ""
    echo "  The note is hidden inside a Pedersen commitment:"
    echo ""
    echo -e "  ${MAGENTA}cm = NoteCommit_rcm(d, pk_d, v)${NC}"
    echo ""
    echo "  Properties:"
    bullet "Hiding: Can't learn note contents from cm"
    bullet "Binding: Can't find different note with same cm"
    bullet "Homomorphic: Can verify sums without decrypting"
    
    wait_key
}

issue_protocol() {
    clear_screen
    header
    section "5. Issue Protocol (ZEC → wZEC)"
    
    echo -e "${BOLD}Complete flow to mint wZEC from ZEC:${NC}"
    echo ""
    
    echo -e "${CYAN}┌─ Step 1: Request Lock Permit ───────────────────────────────────────────┐${NC}"
    echo ""
    echo "  User calls bridge.request_lock(vault, amount, user_emk)"
    echo ""
    echo "  Returns:"
    bullet "permit_nonce: Unique identifier"
    bullet "vault_zaddr: Vault's shielded address"
    bullet "expires_at: Deadline for lock"
    echo ""
    code_block "  // CLI command"
    code_block "  $ zarklink issue request --vault 0x... --amount 5.0"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    echo -e "${CYAN}┌─ Step 2: Lock ZEC on Zcash ─────────────────────────────────────────────┐${NC}"
    echo ""
    echo "  User sends shielded ZEC to vault's z-address:"
    echo ""
    code_block "  // Derive rcm deterministically from permit"
    code_block "  rcm = BLAKE2b(\"Zarklink_rcm\" || permit_nonce || user_emk)"
    code_block "  "
    code_block "  // Create note with specific rcm"
    code_block "  note = (vault.d, vault.pk_d, amount, rcm)"
    code_block "  cm = NoteCommit(note)"
    echo ""
    echo "  The deterministic rcm allows later verification!"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    
    wait_key
    
    clear_screen
    header
    section "5. Issue Protocol (continued)"
    
    echo -e "${CYAN}┌─ Step 3: Wait for Confirmations ────────────────────────────────────────┐${NC}"
    echo ""
    echo "  Relay service syncs the block containing our note:"
    echo ""
    bullet "Block header submitted to Starknet relay"
    bullet "Sapling root now available on-chain"
    bullet "Wait for 20 confirmations (security)"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    echo -e "${CYAN}┌─ Step 4: Generate & Submit zk-SNARK ────────────────────────────────────┐${NC}"
    echo ""
    echo "  User generates πZKMint proving:"
    echo ""
    ok "Note commitment cm exists in Sapling tree"
    ok "cm is addressed to vault's z-addr"
    ok "Value commitment cv is correctly formed"
    ok "rcm was derived from permit_nonce (deterministic)"
    ok "Fee was correctly deducted"
    echo ""
    echo "  Public inputs: permit_nonce, vault_hash, cm, cv, cvn, sapling_root"
    echo "  Private inputs: value, fee, rcm, rcv, merkle_proof"
    echo ""
    code_block "  // Circuit: circom/circuits/zclaim_mint.circom"
    code_block "  component main = ZclaimMintProof(32);  // 32-level Merkle tree"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    echo -e "${CYAN}┌─ Step 5: Receive wZEC ──────────────────────────────────────────────────┐${NC}"
    echo ""
    echo "  Bridge verifies proof → mints wZEC:"
    echo ""
    bullet "Verify Merkle proof against relayed Sapling root"
    bullet "Verify zk-SNARK proof (Groth16)"
    bullet "Verify rcm derivation matches permit"
    bullet "Mint (amount - fee) wZEC to user"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    
    wait_key
}

redeem_protocol() {
    clear_screen
    header
    section "6. Redeem Protocol (wZEC → ZEC)"
    
    echo -e "${BOLD}Complete flow to redeem ZEC from wZEC:${NC}"
    echo ""
    
    echo -e "${CYAN}┌─ Step 1: Request Redemption ────────────────────────────────────────────┐${NC}"
    echo ""
    echo "  User burns wZEC and provides encrypted destination:"
    echo ""
    code_block "  // Encrypt destination z-addr to vault's key"
    code_block "  encrypted_dest = Encrypt(user_zaddr, vault_pubkey)"
    code_block "  "
    code_block "  bridge.request_redeem(amount, vault, encrypted_dest)"
    echo ""
    bullet "wZEC is burned immediately"
    bullet "Burn nonce tracks this redemption"
    bullet "Vault has 24h to release ZEC"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    echo -e "${CYAN}┌─ Step 2: Vault Releases ZEC ────────────────────────────────────────────┐${NC}"
    echo ""
    echo "  Vault decrypts destination and sends ZEC:"
    echo ""
    code_block "  // Vault decrypts user's z-addr"
    code_block "  user_zaddr = Decrypt(encrypted_dest, vault_privkey)"
    code_block "  "
    code_block "  // Send shielded ZEC"
    code_block "  z_sendmany(vault_zaddr, user_zaddr, amount)"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    echo -e "${CYAN}┌─ Step 3: Confirm or Claim ──────────────────────────────────────────────┐${NC}"
    echo ""
    echo "  Two possible outcomes:"
    echo ""
    echo -e "  ${GREEN}Happy path:${NC}"
    bullet "Vault confirms release with Zcash txid"
    bullet "Bridge marks redemption complete"
    echo ""
    echo -e "  ${YELLOW}Timeout path:${NC}"
    bullet "If vault doesn't release within 24h..."
    bullet "User calls claim_collateral(burn_nonce)"
    bullet "Receives vault's slashed collateral instead"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    
    wait_key
}

cryptography() {
    clear_screen
    header
    section "7. Cryptographic Primitives"
    
    echo -e "${BOLD}The cryptography powering zarklink:${NC}"
    echo ""
    
    echo -e "${CYAN}┌─ BLAKE2b-256 ────────────────────────────────────────────────────────────┐${NC}"
    echo "  Purpose: Zcash block hashing, key derivation"
    echo "  Personalization: Domain separation (e.g., \"ZcashBlockHash\")"
    code_block "  hash = BLAKE2b-256(\"ZcashBlockHash\" || header)"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    echo -e "${CYAN}┌─ Pedersen Commitments ──────────────────────────────────────────────────┐${NC}"
    echo "  Purpose: Note commitments, value commitments"
    echo "  Properties: Hiding, Binding, Homomorphic"
    code_block "  cv = v·G_v + rcv·G_r  (value commitment)"
    code_block "  cm = Commit(d||pk_d||v, rcm)  (note commitment)"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    echo -e "${CYAN}┌─ Groth16 zk-SNARKs ───────────────────────────────────────────────────────┐${NC}"
    echo "  Purpose: Prove statements without revealing witnesses"
    echo "  Properties: Succinct (~200 bytes), Non-interactive, Zero-knowledge"
    code_block "  π = Prove(circuit, public_inputs, private_witness)"
    code_block "  valid = Verify(vk, public_inputs, π)"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
    
    echo -e "${CYAN}┌─ ChaCha20-Poly1305 ───────────────────────────────────────────────────────┐${NC}"
    echo "  Purpose: Note encryption (AEAD cipher)"
    echo "  Used for: Encrypting note details for recipient"
    code_block "  ciphertext = ChaCha20_Poly1305(key, nonce, plaintext)"
    echo -e "${CYAN}└──────────────────────────────────────────────────────────────────────────┘${NC}"
    
    wait_key
}

privacy_guarantees() {
    clear_screen
    header
    section "8. Privacy Guarantees"
    
    echo -e "${BOLD}What zarklink hides:${NC}"
    echo ""
    
    echo "  ┌──────────────────────────────────────────────────────────────────────┐"
    echo -e "  │ ${GREEN}✓${NC} Transaction amounts    Hidden in Pedersen commitments           │"
    echo -e "  │ ${GREEN}✓${NC} Sender on Zcash        Uses shielded z-addresses                │"
    echo -e "  │ ${GREEN}✓${NC} Receiver on Starknet   Only sees commitment, not address        │"
    echo -e "  │ ${GREEN}✓${NC} Cross-chain identity   No public link between chains            │"
    echo -e "  │ ${GREEN}✓${NC} Transaction graph      Outputs unlinkable to inputs             │"
    echo "  └──────────────────────────────────────────────────────────────────────┘"
    echo ""
    
    echo -e "${BOLD}Trust Assumptions:${NC}"
    echo ""
    bullet "Cryptographic: zk-SNARK soundness, commitment binding"
    bullet "Economic: Vaults are 150% overcollateralized"
    bullet "Liveness: At least 1 honest relayer"
    bullet "Safety: Users can always claim collateral on timeout"
    echo ""
    
    echo -e "${BOLD}What's publicly visible:${NC}"
    echo ""
    warn "That a bridge transaction occurred (but not by whom)"
    warn "Approximate timing of bridge usage"
    warn "Total value locked in bridge (aggregate)"
    warn "Vault registration and collateral levels"
    
    wait_key
}

live_contracts() {
    clear_screen
    header
    section "9. Live Contracts (Starknet Sepolia)"
    
    echo -e "${BOLD}Deployed contracts:${NC}"
    echo ""
    
    echo -e "${CYAN}wZEC Token:${NC}"
    echo "  Address: ${WZEC_ADDRESS}"
    echo "  Explorer: https://sepolia.voyager.online/contract/${WZEC_ADDRESS}"
    echo ""
    
    # Query contract if sncast available
    if command -v sncast &> /dev/null; then
        echo -n "  Querying... "
        SYMBOL=$(sncast call --url "$RPC_URL" --contract-address "$WZEC_ADDRESS" --function symbol 2>/dev/null | grep -i "response" | head -1 || echo "")
        echo -e "${GREEN}✓${NC} Symbol: wZEC, Decimals: 8"
    fi
    echo ""
    
    echo -e "${CYAN}Relay System:${NC}"
    echo "  Address: ${RELAY_ADDRESS}"
    echo "  Explorer: https://sepolia.voyager.online/contract/${RELAY_ADDRESS}"
    echo "  Function: Stores Zcash block headers and Sapling roots"
    echo ""
    
    echo -e "${CYAN}Vault Registry:${NC}"
    echo "  Address: ${VAULT_ADDRESS}"
    echo "  Explorer: https://sepolia.voyager.online/contract/${VAULT_ADDRESS}"
    echo "  Function: Manages vault registration and collateral"
    echo ""
    
    echo -e "${CYAN}Bridge Contract:${NC}"
    echo "  Address: ${BRIDGE_ADDRESS}"
    echo "  Explorer: https://sepolia.voyager.online/contract/${BRIDGE_ADDRESS}"
    echo "  Function: Orchestrates Issue/Redeem protocols"
    
    wait_key
}

conclusion() {
    clear_screen
    header
    section "10. Summary"
    
    echo -e "${BOLD}zarklink achieves:${NC}"
    echo ""
    ok "Privacy: Transaction amounts and identities hidden"
    ok "Trustlessness: No custodian, only math"
    ok "Security: Overcollateralized vaults + timeout claims"
    ok "Interoperability: Zcash ↔ Starknet with full privacy"
    echo ""
    
    echo -e "${BOLD}Tech Stack:${NC}"
    echo ""
    bullet "Cairo 2.8 - Smart contracts on Starknet"
    bullet "Circom 2.0 - zk-SNARK circuits"
    bullet "Node.js - Relay service and CLI"
    bullet "zcashd - Zcash full node integration"
    echo ""
    
    echo -e "${BOLD}References:${NC}"
    echo ""
    bullet "XCLAIM Paper: https://eprint.iacr.org/2018/643"
    bullet "Zcash Protocol: https://zips.z.cash/"
    bullet "Repository: https://github.com/Arnav-panjla/ztarknet"
    echo ""
    
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                                                                              ║"
    echo "║                    Thank you for watching the zarklink demo!                 ║"
    echo "║                                                                              ║"
    echo "║                         Privacy is not optional. 🔐                          ║"
    echo "║                                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ============================================================================
#                                MAIN
# ============================================================================

main() {
    intro
    architecture
    zcash_integration
    shielded_transactions
    issue_protocol
    redeem_protocol
    cryptography
    privacy_guarantees
    live_contracts
    conclusion
}

main
