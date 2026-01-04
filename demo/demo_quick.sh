#!/bin/bash
# =============================================================================
#                    ZARKLINK - Quick Demo
#              Privacy-Preserving Zcash ↔ Starknet Bridge
#                        Minimal Presentation
# =============================================================================

# Colors
C='\033[0;36m'  # Cyan
G='\033[0;32m'  # Green
Y='\033[1;33m'  # Yellow
W='\033[1;37m'  # White
D='\033[2m'     # Dim
N='\033[0m'     # Reset
B='\033[1m'     # Bold

# Contracts
RPC="https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/KKX3txNscJJ_3JAPqQ3E7"
TOKEN="0x04c571b6ca21e59add5ccb280eb68a309c6ca4e5eeecfd2186856fe97f74a294"
RELAY="0x01ae3dce889773db25632ebed4a04698fb2dff1c71b2101f00e8c0f34b5d7e4b"
VAULT="0x007abd698ddafea4669ac4d5e96477ef4958b6e6ebd57e4ef2f61df1f2597436"
BRIDGE="0x069d135c173847a356aa29a182ace00981e9793aea5bb62bfc6c1d4577e9c36e"

clear
echo -e "${C}"
cat << 'LOGO'
    ███████╗ █████╗ ██████╗ ██╗  ██╗██╗     ██╗███╗   ██╗██╗  ██╗
    ╚══███╔╝██╔══██╗██╔══██╗██║ ██╔╝██║     ██║████╗  ██║██║ ██╔╝
      ███╔╝ ███████║██████╔╝█████╔╝ ██║     ██║██╔██╗ ██║█████╔╝ 
     ███╔╝  ██╔══██║██╔══██╗██╔═██╗ ██║     ██║██║╚██╗██║██╔═██╗ 
    ███████╗██║  ██║██║  ██║██║  ██╗███████╗██║██║ ╚████║██║  ██╗
    ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝
LOGO
echo -e "${N}"
echo -e "${W}    Privacy-Preserving Zcash ↔ Starknet Bridge${N}"
echo ""
echo -e "${Y}Press ENTER to start...${N}"
read -r

# ─────────────────────────────────────────────────────────────────────────────
clear
echo -e "${B}PROBLEM${N}"
echo ""
echo "  Cross-chain bridges expose:"
echo -e "  ${D}• Transaction amounts${N}"
echo -e "  ${D}• Sender/receiver addresses${N}"
echo -e "  ${D}• Transaction timing${N}"
echo ""
echo -e "${B}SOLUTION${N}"
echo ""
echo "  zarklink uses:"
echo -e "  ${G}✓${N} Zcash shielded transactions (z-addresses)"
echo -e "  ${G}✓${N} zk-SNARKs for verification"
echo -e "  ${G}✓${N} Overcollateralized vaults (trustless)"
echo ""
echo -e "${Y}[ENTER]${N}"
read -r

# ─────────────────────────────────────────────────────────────────────────────
clear
echo -e "${B}ARCHITECTURE${N}"
echo ""
echo -e "${C}"
cat << 'ARCH'
   ZCASH                              STARKNET
   ─────                              ────────
   
   ┌─────────┐    Block Headers    ┌───────────┐
   │ zcashd  │ ──────────────────> │   Relay   │
   └────┬────┘                     └─────┬─────┘
        │                                │
        ▼                                ▼
   ┌─────────┐    zk-SNARK Proofs  ┌───────────┐
   │ Shielded│ <─────────────────> │  Bridge   │
   │  Pool   │                     │           │
   └────┬────┘                     └─────┬─────┘
        │                                │
        ▼                                ▼
   ┌─────────┐    Collateral       ┌───────────┐
   │  Vault  │ <─────────────────> │  Registry │
   │ (z-addr)│                     └─────┬─────┘
   └─────────┘                           │
                                         ▼
                                   ┌───────────┐
                                   │   wZEC    │
                                   │  (ERC20)  │
                                   └───────────┘
ARCH
echo -e "${N}"
echo -e "${Y}[ENTER]${N}"
read -r

# ─────────────────────────────────────────────────────────────────────────────
clear
echo -e "${B}ISSUE PROTOCOL (ZEC → wZEC)${N}"
echo ""
echo "  1. User requests lock permit"
echo "  2. User sends ZEC to vault's z-address"
echo "  3. Relay syncs block header to Starknet"
echo "  4. User submits zk-SNARK proof"
echo "  5. Bridge mints wZEC"
echo ""
echo -e "${D}  Privacy: Amount and addresses hidden throughout${N}"
echo ""
echo -e "${Y}[ENTER]${N}"
read -r

# ─────────────────────────────────────────────────────────────────────────────
clear
echo -e "${B}REDEEM PROTOCOL (wZEC → ZEC)${N}"
echo ""
echo "  1. User burns wZEC + encrypted destination"
echo "  2. Vault decrypts and sends ZEC"
echo "  3. Vault confirms release"
echo ""
echo -e "  ${Y}Safety:${N} If vault fails → claim collateral"
echo ""
echo -e "${Y}[ENTER]${N}"
read -r

# ─────────────────────────────────────────────────────────────────────────────
clear
echo -e "${B}CRYPTOGRAPHY${N}"
echo ""
echo -e "  ${C}BLAKE2b-256${N}    Block hashing"
echo -e "  ${C}Pedersen${N}       Value/note commitments"
echo -e "  ${C}Groth16${N}        zk-SNARK proofs"
echo -e "  ${C}ChaCha20${N}       Note encryption"
echo ""
echo -e "${Y}[ENTER]${N}"
read -r

# ─────────────────────────────────────────────────────────────────────────────
clear
echo -e "${B}DEPLOYED CONTRACTS (Sepolia)${N}"
echo ""
echo -e "  ${C}wZEC Token${N}"
echo -e "  ${D}${TOKEN}${N}"
echo ""
echo -e "  ${C}Relay System${N}"
echo -e "  ${D}${RELAY}${N}"
echo ""
echo -e "  ${C}Vault Registry${N}"
echo -e "  ${D}${VAULT}${N}"
echo ""
echo -e "  ${C}Bridge${N}"
echo -e "  ${D}${BRIDGE}${N}"
echo ""
echo -e "${Y}[ENTER]${N}"
read -r

# ─────────────────────────────────────────────────────────────────────────────
clear
echo -e "${B}PRIVACY GUARANTEES${N}"
echo ""
echo -e "  ${G}✓${N} Hidden amounts"
echo -e "  ${G}✓${N} Hidden addresses"
echo -e "  ${G}✓${N} Unlinkable cross-chain identity"
echo -e "  ${G}✓${N} No trusted custodian"
echo ""
echo -e "${Y}[ENTER]${N}"
read -r

# ─────────────────────────────────────────────────────────────────────────────
clear
echo -e "${C}"
cat << 'LOGO'
    ███████╗ █████╗ ██████╗ ██╗  ██╗██╗     ██╗███╗   ██╗██╗  ██╗
    ╚══███╔╝██╔══██╗██╔══██╗██║ ██╔╝██║     ██║████╗  ██║██║ ██╔╝
      ███╔╝ ███████║██████╔╝█████╔╝ ██║     ██║██╔██╗ ██║█████╔╝ 
     ███╔╝  ██╔══██║██╔══██╗██╔═██╗ ██║     ██║██║╚██╗██║██╔═██╗ 
    ███████╗██║  ██║██║  ██║██║  ██╗███████╗██║██║ ╚████║██║  ██╗
    ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝
LOGO
echo -e "${N}"
echo ""
echo -e "  ${G}Privacy is not optional.${N}"
echo ""
echo -e "  ${D}github.com/Arnav-panjla/ztarknet${N}"
echo ""
