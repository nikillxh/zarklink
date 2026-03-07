#!/usr/bin/env bash
# ============================================================================
# Zarklink — Local Development Infrastructure
# ============================================================================
# Starts Zcash regtest node + Starknet devnet (starknet-devnet) with
# pre-funded accounts for both chains. Generates all necessary keys,
# addresses, and configuration for local bridge development.
#
# Usage:
#   ./scripts/start-devnet.sh                       # Start both chains
#   ./scripts/start-devnet.sh --deploy              # Start + deploy contracts
#   ./scripts/start-devnet.sh --frontend            # Start + launch Next.js dev
#   ./scripts/start-devnet.sh --deploy --frontend   # Full stack
#   ./scripts/start-devnet.sh stop                  # Stop all services
#   ./scripts/start-devnet.sh status                # Check service status
#   ./scripts/start-devnet.sh reset                 # Wipe state and restart
#   ./scripts/start-devnet.sh reset --deploy --frontend
# ============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${PROJECT_ROOT}/.devnet"
LOG_DIR="${DATA_DIR}/logs"
PID_DIR="${DATA_DIR}/pids"

# Zcash regtest configuration
ZCASH_DIR="${DATA_DIR}/zcash"
ZCASH_CONF="${ZCASH_DIR}/zcash.conf"
ZCASH_RPC_PORT=18232
ZCASH_RPC_USER="zarklink"
ZCASH_RPC_PASS="zarklink-dev-$(date +%s | sha256sum | head -c 16)"
ZCASH_MINERS=3
ZCASH_INITIAL_BLOCKS=110

# Starknet devnet configuration
STARKNET_HOST="127.0.0.1"
STARKNET_PORT=5050
STARKNET_SEED=42
STARKNET_ACCOUNTS=10
STARKNET_INITIAL_BALANCE="1000000000000000000000"

# Frontend
FRONTEND_DIR="${PROJECT_ROOT}/frontend"
FRONTEND_PORT=3000

# Account configuration file (generated)
ACCOUNTS_FILE="${DATA_DIR}/accounts.json"
ENV_FILE="${PROJECT_ROOT}/.env.devnet"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log_info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error()   { echo -e "${RED}[ERR]${NC}   $*"; }
log_header()  { echo -e "\n${BOLD}${BLUE}═══ $* ═══${NC}\n"; }

check_command() {
  if ! command -v "$1" &>/dev/null; then
    log_error "$1 is not installed. Please install it first."
    echo "  Installation guide: $2"
    return 1
  fi
}

wait_for_port() {
  local port=$1 name=$2 max_wait=${3:-60}
  local waited=0
  log_info "Waiting for ${name} on port ${port}..."
  while ! (ss -tlnp 2>/dev/null | grep -q ":${port} " || bash -c "echo >/dev/tcp/127.0.0.1/${port}" 2>/dev/null); do
    sleep 1
    waited=$((waited + 1))
    if [ $waited -ge $max_wait ]; then
      log_error "${name} failed to start within ${max_wait}s"
      return 1
    fi
  done
  log_success "${name} is ready on port ${port} (${waited}s)"
}

save_pid() {
  local name=$1 pid=$2
  echo "$pid" > "${PID_DIR}/${name}.pid"
}

get_pid() {
  local name=$1
  local pidfile="${PID_DIR}/${name}.pid"
  if [ -f "$pidfile" ]; then
    cat "$pidfile"
  fi
}

is_running() {
  local pid
  pid=$(get_pid "$1")
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Zcash Regtest Functions
# ---------------------------------------------------------------------------
setup_zcash_config() {
  mkdir -p "${ZCASH_DIR}"

  cat > "${ZCASH_CONF}" <<EOF
# Zarklink Zcash Regtest Configuration
regtest=1
txindex=1
experimentalfeatures=1
insightexplorer=1

# Acknowledge zcashd deprecation (required for v6.x+)
i-am-aware-zcashd-will-be-replaced-by-zebrad-and-zallet-in-2025=1

# RPC settings
rpcuser=${ZCASH_RPC_USER}
rpcpassword=${ZCASH_RPC_PASS}
rpcport=${ZCASH_RPC_PORT}
rpcallowip=127.0.0.1

# Network
listen=0
listenonion=0

# Mining
gen=0
genproclimit=0
equihashsolver=tromp

# Sapling activation (block 1 on regtest)
nuparams=5ba81b19:1
nuparams=76b809bb:1

# Debug logging
debug=zrpc
debug=zrpcunsafe

# Allow deprecated RPC methods for dev (getnewaddress, z_getnewaddress, etc.)
allowdeprecated=getnewaddress
allowdeprecated=z_getnewaddress
allowdeprecated=z_getbalance
allowdeprecated=z_gettotalbalance
allowdeprecated=z_listaddresses
EOF

  log_success "Zcash regtest config written to ${ZCASH_CONF}"
}

start_zcash() {
  log_header "Starting Zcash Regtest Node"

  if is_running "zcashd"; then
    log_warn "zcashd is already running (PID: $(get_pid zcashd))"
    return 0
  fi

  setup_zcash_config

  # Sapling/Orchard params are bundled with zcashd v6+, no fetch needed.
  # Only Sprout spending requires external params (not needed for our bridge).
  mkdir -p "${HOME}/.zcash-params"

  # Start zcashd in regtest mode
  zcashd \
    -datadir="${ZCASH_DIR}" \
    -conf="${ZCASH_CONF}" \
    -daemon \
    -pid="${PID_DIR}/zcashd.pid" \
    2>"${LOG_DIR}/zcashd-stderr.log"

  # zcashd writes its own PID file when -pid is given
  sleep 2

  # If zcashd wrote its own PID, use that; otherwise find it
  if [ ! -f "${PID_DIR}/zcashd.pid" ]; then
    local pid
    pid=$(pgrep -f "zcashd.*-datadir=${ZCASH_DIR}" || true)
    if [ -n "$pid" ]; then
      save_pid "zcashd" "$pid"
    fi
  fi

  wait_for_port "${ZCASH_RPC_PORT}" "zcashd" 120

  # Wait for wallet to finish loading (RPC returns -28 during loading)
  log_info "Waiting for zcashd wallet to load..."
  local rpc_waited=0
  while true; do
    local result
    result=$(zcash_rpc getblockcount 2>&1 || true)
    if echo "$result" | grep -qE '^[0-9]+$'; then
      break
    fi
    sleep 2
    rpc_waited=$((rpc_waited + 2))
    if [ $rpc_waited -ge 120 ]; then
      log_error "zcashd wallet failed to load within 120s"
      return 1
    fi
  done
  log_success "zcashd wallet ready (${rpc_waited}s)"

  log_success "zcashd started (PID: $(get_pid zcashd))"
}

zcash_rpc() {
  zcash-cli \
    -datadir="${ZCASH_DIR}" \
    -rpcuser="${ZCASH_RPC_USER}" \
    -rpcpassword="${ZCASH_RPC_PASS}" \
    -rpcport="${ZCASH_RPC_PORT}" \
    "$@" 2>/dev/null
}

fund_zcash_accounts() {
  log_header "Funding Zcash Regtest Accounts"

  local block_count
  block_count=$(zcash_rpc getblockcount 2>/dev/null || echo "0")

  if [ "$block_count" -lt "$ZCASH_INITIAL_BLOCKS" ]; then
    log_info "Mining ${ZCASH_INITIAL_BLOCKS} initial blocks..."
    zcash_rpc generate "${ZCASH_INITIAL_BLOCKS}" >/dev/null
    log_success "Mined ${ZCASH_INITIAL_BLOCKS} blocks"
  else
    log_info "Chain already has ${block_count} blocks, skipping mining"
  fi

  # Create transparent addresses for test accounts
  log_info "Creating transparent test addresses..."
  local t_addrs=()
  for i in $(seq 1 "$ZCASH_MINERS"); do
    local addr
    addr=$(zcash_rpc getnewaddress "")
    t_addrs+=("$addr")
    log_info "  T-addr ${i}: ${addr}"
  done

  # Create shielded (Sapling) addresses for vault + issuer + redeemer
  log_info "Creating shielded Sapling addresses..."
  local z_addrs=()
  local z_labels=("vault-operator" "issuer-alice" "redeemer-dave")
  for i in $(seq 0 2); do
    local addr
    addr=$(zcash_rpc z_getnewaddress sapling)
    z_addrs+=("$addr")
    log_info "  Z-addr (${z_labels[$i]}): ${addr:0:20}...${addr: -8}"
  done

  # Fund transparent addresses
  log_info "Funding transparent addresses..."
  for addr in "${t_addrs[@]}"; do
    zcash_rpc sendtoaddress "$addr" 100.0 >/dev/null 2>&1 || true
  done
  zcash_rpc generate 10 >/dev/null

  # Shield funds to Sapling addresses
  log_info "Shielding funds to Sapling addresses..."
  for z_addr in "${z_addrs[@]}"; do
    local opid
    opid=$(zcash_rpc z_sendmany "${t_addrs[0]}" \
      "[{\"address\": \"${z_addr}\", \"amount\": 50.0}]" 1 0.0001 2>/dev/null || true)
    if [ -n "$opid" ]; then
      log_info "  Shield operation: ${opid}"
    fi
  done

  # Mine blocks to confirm shielded transfers
  sleep 2
  zcash_rpc generate 20 >/dev/null

  # Get balances
  local total_balance
  total_balance=$(zcash_rpc z_gettotalbalance 2>/dev/null || echo "{}")

  log_success "Zcash accounts funded"
  log_info "Total balance: ${total_balance}"

  # Export to JSON
  cat > "${DATA_DIR}/zcash-accounts.json" <<EOF
{
  "rpc_url": "http://127.0.0.1:${ZCASH_RPC_PORT}",
  "rpc_user": "${ZCASH_RPC_USER}",
  "rpc_password": "${ZCASH_RPC_PASS}",
  "transparent_addresses": [
$(printf '    "%s",\n' "${t_addrs[@]}" | sed '$ s/,$//')
  ],
  "shielded_addresses": {
    "vault_operator": "${z_addrs[0]}",
    "issuer_alice": "${z_addrs[1]}",
    "redeemer_dave": "${z_addrs[2]}"
  },
  "labels": {
    "vault_operator": "Vault operator — custodial Sapling address",
    "issuer_alice": "Issuer — locks ZEC to mint wZEC",
    "redeemer_dave": "Redeemer — burns wZEC to unlock ZEC"
  }
}
EOF

  log_success "Zcash accounts saved to ${DATA_DIR}/zcash-accounts.json"
}

stop_zcash() {
  if is_running "zcashd"; then
    log_info "Stopping zcashd..."
    zcash_rpc stop 2>/dev/null || kill "$(get_pid zcashd)" 2>/dev/null || true
    sleep 3
    log_success "zcashd stopped"
  else
    log_info "zcashd is not running"
  fi
  rm -f "${PID_DIR}/zcashd.pid"
}

# ---------------------------------------------------------------------------
# Starknet Devnet Functions
# ---------------------------------------------------------------------------
start_starknet() {
  log_header "Starting Starknet Devnet"

  if is_running "starknet-devnet"; then
    log_warn "starknet-devnet is already running (PID: $(get_pid starknet-devnet))"
    return 0
  fi

  starknet-devnet \
    --host "${STARKNET_HOST}" \
    --port "${STARKNET_PORT}" \
    --seed "${STARKNET_SEED}" \
    --accounts "${STARKNET_ACCOUNTS}" \
    --initial-balance "${STARKNET_INITIAL_BALANCE}" \
    --state-archive-capacity full \
    > "${LOG_DIR}/starknet-devnet.log" 2>&1 &

  local pid=$!
  save_pid "starknet-devnet" "$pid"

  wait_for_port "${STARKNET_PORT}" "starknet-devnet" 30

  log_success "starknet-devnet started (PID: ${pid})"
}

fetch_starknet_accounts() {
  log_header "Fetching Starknet Predeployed Accounts"

  local response
  response=$(curl -s -X POST "http://${STARKNET_HOST}:${STARKNET_PORT}" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"devnet_getPredeployedAccounts","params":{},"id":1}')

  # Extract the result array from JSON-RPC response
  local accounts
  accounts=$(echo "$response" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('result', [])))" 2>/dev/null || echo "")

  if [ -z "$accounts" ] || [ "$accounts" = "[]" ] || [ "$accounts" = "null" ]; then
    log_error "Failed to fetch predeployed accounts"
    return 1
  fi

  echo "$accounts" > "${DATA_DIR}/starknet-accounts.json"

  # Parse and display accounts
  local count
  count=$(echo "$response" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")

  log_success "${count} predeployed accounts available"

  # Display first few accounts
  python3 <<PYEOF
import json

with open("${DATA_DIR}/starknet-accounts.json") as f:
  accounts = json.load(f)

roles = [
  "Deployer / Admin",
  "Vault Operator #1",
  "Vault Operator #2",
  "Issuer (Alice)",
  "Redeemer (Dave)",
  "Relayer Service",
  "Oracle Service",
  "Test User #1",
  "Test User #2",
  "Test User #3",
]

role_map = {}
for i, acc in enumerate(accounts):
  role = roles[i] if i < len(roles) else f"Account #{i}"
  addr = acc.get("address", "?")
  balance = acc.get("initial_balance", "?")
  pk = acc.get("private_key", "?")
  print(f"  [{i}] {role}")
  print(f"      Address:     {addr}")
  print(f"      Private Key: {pk}")
  print(f"      Balance:     {balance}")
  print()
  role_map[role.lower().replace(" ", "_").replace("#", "").replace("/", "")] = {
    "address": addr,
    "private_key": pk,
    "balance": str(balance),
    "role": role
  }

# Write labeled accounts
labeled = {
  "rpc_url": "http://${STARKNET_HOST}:${STARKNET_PORT}",
  "chain_id": "SN_SEPOLIA",
  "accounts": role_map,
  "all_accounts": accounts
}

with open("${DATA_DIR}/starknet-accounts-labeled.json", "w") as f:
  json.dump(labeled, f, indent=2)

PYEOF

  log_success "Labeled accounts saved to ${DATA_DIR}/starknet-accounts-labeled.json"
}

stop_starknet() {
  if is_running "starknet-devnet"; then
    log_info "Stopping starknet-devnet..."
    kill "$(get_pid starknet-devnet)" 2>/dev/null || true
    sleep 1
    log_success "starknet-devnet stopped"
  else
    log_info "starknet-devnet is not running"
  fi
  rm -f "${PID_DIR}/starknet-devnet.pid"
}

# ---------------------------------------------------------------------------
# Frontend Functions
# ---------------------------------------------------------------------------
start_frontend() {
  log_header "Starting Next.js Frontend"

  if is_running "next-dev"; then
    log_warn "Next.js is already running (PID: $(get_pid next-dev))"
    return 0
  fi

  if [ ! -d "${FRONTEND_DIR}" ]; then
    log_error "Frontend directory not found: ${FRONTEND_DIR}"
    return 1
  fi

  # Install deps if node_modules missing
  if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
    log_info "Installing frontend dependencies..."
    (cd "${FRONTEND_DIR}" && npm install --silent) || {
      log_error "npm install failed"
      return 1
    }
  fi

  # Start Next.js dev server
  (cd "${FRONTEND_DIR}" && npm run dev -- --port "${FRONTEND_PORT}") \
    > "${LOG_DIR}/frontend.log" 2>&1 &

  local pid=$!
  save_pid "next-dev" "$pid"

  wait_for_port "${FRONTEND_PORT}" "Next.js" 30
  log_success "Frontend running at http://localhost:${FRONTEND_PORT}"
}

stop_frontend() {
  if is_running "next-dev"; then
    log_info "Stopping Next.js frontend..."
    local pid
    pid=$(get_pid next-dev)
    # Kill the process group to ensure child node processes are also killed
    kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    sleep 1
    log_success "Frontend stopped"
  else
    log_info "Next.js is not running"
  fi
  rm -f "${PID_DIR}/next-dev.pid"
}

# ---------------------------------------------------------------------------
# Environment File Generation
# ---------------------------------------------------------------------------
generate_env_file() {
  log_header "Generating Environment File"

  cat > "${ENV_FILE}" <<EOF
# ============================================================================
# Zarklink Devnet Environment — Auto-generated $(date -Iseconds)
# ============================================================================

# Zcash Regtest
ZCASH_RPC_URL=http://127.0.0.1:${ZCASH_RPC_PORT}
ZCASH_RPC_USER=${ZCASH_RPC_USER}
ZCASH_RPC_PASS=${ZCASH_RPC_PASS}
ZCASH_NETWORK=regtest
ZCASH_DATADIR=${ZCASH_DIR}

# Starknet Devnet
STARKNET_RPC_URL=http://${STARKNET_HOST}:${STARKNET_PORT}
STARKNET_CHAIN_ID=SN_SEPOLIA
STARKNET_NETWORK=devnet

# Protocol Constants
BRIDGE_FEE_RATE=0.003
COLLATERAL_RATIO=1.5
FINALITY_DEPTH=24
MAX_LOCK_AMOUNT=1000
SPLITTING_K=16
WARRANTY_COLLATERAL=0.01

# Account files
ZCASH_ACCOUNTS_FILE=${DATA_DIR}/zcash-accounts.json
STARKNET_ACCOUNTS_FILE=${DATA_DIR}/starknet-accounts-labeled.json
EOF

  # Append Starknet deployer key if available
  if [ -f "${DATA_DIR}/starknet-accounts.json" ]; then
    local deployer_addr deployer_pk
    deployer_addr=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[0]['address'])" 2>/dev/null || echo "")
    deployer_pk=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[0]['private_key'])" 2>/dev/null || echo "")

    if [ -n "$deployer_addr" ]; then
      cat >> "${ENV_FILE}" <<EOF

# Deployer Account (auto-assigned from predeployed accounts[0])
DEPLOYER_ADDRESS=${deployer_addr}
DEPLOYER_PRIVATE_KEY=${deployer_pk}

# Vault Operator Account (auto-assigned from predeployed accounts[1])
VAULT_ADDRESS=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[1]['address'])" 2>/dev/null || echo "")
VAULT_PRIVATE_KEY=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[1]['private_key'])" 2>/dev/null || echo "")

# Issuer Account (auto-assigned from predeployed accounts[3])
ISSUER_ADDRESS=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[3]['address'])" 2>/dev/null || echo "")
ISSUER_PRIVATE_KEY=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[3]['private_key'])" 2>/dev/null || echo "")

# Redeemer Account (auto-assigned from predeployed accounts[4])
REDEEMER_ADDRESS=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[4]['address'])" 2>/dev/null || echo "")
REDEEMER_PRIVATE_KEY=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[4]['private_key'])" 2>/dev/null || echo "")
EOF
    fi
  fi

  log_success "Environment file written to ${ENV_FILE}"
}

# ---------------------------------------------------------------------------
# Combined Accounts Summary
# ---------------------------------------------------------------------------
generate_accounts_summary() {
  log_header "Combined Accounts Summary"

  python3 <<'PYEOF'
import json, os

data_dir = os.environ.get("DATA_DIR", "DEVNET_DATA_DIR_PLACEHOLDER")

# This is a workaround — we'll use the actual path
PYEOF

  python3 - "${DATA_DIR}" <<'PYEOF'
import json, sys

data_dir = sys.argv[1]

combined = {"zcash": {}, "starknet": {}}

try:
  with open(f"{data_dir}/zcash-accounts.json") as f:
    combined["zcash"] = json.load(f)
except FileNotFoundError:
  combined["zcash"] = {"error": "not available"}

try:
  with open(f"{data_dir}/starknet-accounts-labeled.json") as f:
    combined["starknet"] = json.load(f)
except FileNotFoundError:
  combined["starknet"] = {"error": "not available"}

with open(f"{data_dir}/accounts.json", "w") as f:
  json.dump(combined, f, indent=2)

print(f"  Combined accounts file: {data_dir}/accounts.json")
PYEOF

  log_success "All account data consolidated"
}

# ---------------------------------------------------------------------------
# Deploy Contracts (optional)
# ---------------------------------------------------------------------------
deploy_contracts() {
  if [ -f "${PROJECT_ROOT}/scripts/deploy.sh" ]; then
    log_header "Deploying Cairo Contracts"
    bash "${PROJECT_ROOT}/scripts/deploy.sh" all
    log_success "Contracts deployed via deploy.sh"
  else
    log_warn "deploy.sh not found — skipping contract deployment"
  fi
}

# ---------------------------------------------------------------------------
# Generate Frontend .env.local
# ---------------------------------------------------------------------------
generate_frontend_env() {
  log_header "Generating Frontend Environment (frontend/.env.local)"

  local frontend_env="${PROJECT_ROOT}/frontend/.env.local"

  # Read deployer account
  local deployer_addr="" deployer_key=""
  if [ -f "${DATA_DIR}/starknet-accounts.json" ]; then
    deployer_addr=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[0]['address'])" 2>/dev/null || echo "")
    deployer_key=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[0]['private_key'])" 2>/dev/null || echo "")
  fi

  # Read deployed contract addresses (if contracts were deployed)
  local bridge_addr="" registry_addr="" pool_addr="" relay_addr="" wzec_addr="" oracle_addr=""
  if [ -f "${DATA_DIR}/deployments.json" ]; then
    bridge_addr=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/deployments.json')); print(d['contracts']['bridge_protocol']['address'])" 2>/dev/null || echo "")
    registry_addr=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/deployments.json')); print(d['contracts']['vault_registry']['address'])" 2>/dev/null || echo "")
    pool_addr=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/deployments.json')); print(d['contracts']['vault_pool']['address'])" 2>/dev/null || echo "")
    relay_addr=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/deployments.json')); print(d['contracts']['zcash_relay']['address'])" 2>/dev/null || echo "")
    wzec_addr=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/deployments.json')); print(d['contracts']['wzec_token']['address'])" 2>/dev/null || echo "")
    oracle_addr=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/deployments.json')); print(d['contracts']['oracle']['address'])" 2>/dev/null || echo "")
  fi

  cat > "${frontend_env}" <<EOF
# ==========================================================================
# Zarklink Frontend — Auto-generated $(date -Iseconds)
# ==========================================================================
# This file was generated by start-devnet.sh. It provides the NEXT_PUBLIC_*
# environment variables consumed by the Next.js frontend at build/dev time.

# ── Chain RPC Endpoints ──────────────────────────────────────────────────
NEXT_PUBLIC_STARKNET_RPC_URL=http://${STARKNET_HOST}:${STARKNET_PORT}
NEXT_PUBLIC_ZCASH_RPC_URL=http://127.0.0.1:${ZCASH_RPC_PORT}

# ── Deployer / Dev Account ──────────────────────────────────────────────
NEXT_PUBLIC_DEPLOYER_ADDRESS=${deployer_addr}
NEXT_PUBLIC_DEPLOYER_KEY=${deployer_key}

# ── Deployed Contract Addresses ─────────────────────────────────────────
NEXT_PUBLIC_BRIDGE_ADDRESS=${bridge_addr}
NEXT_PUBLIC_REGISTRY_ADDRESS=${registry_addr}
NEXT_PUBLIC_POOL_ADDRESS=${pool_addr}
NEXT_PUBLIC_RELAY_ADDRESS=${relay_addr}
NEXT_PUBLIC_WZEC_ADDRESS=${wzec_addr}
NEXT_PUBLIC_ORACLE_ADDRESS=${oracle_addr}
EOF

  log_success "Frontend env written to ${frontend_env}"

  # Also write all devnet accounts as a JSON array for the account switcher
  if [ -f "${DATA_DIR}/starknet-accounts.json" ]; then
    local accounts_json
    accounts_json=$(python3 -c "
import json
with open('${DATA_DIR}/starknet-accounts.json') as f:
    accs = json.load(f)
roles = ['Deployer','Vault Operator','Relayer','Issuer','Redeemer','User A','User B','User C','User D','User E']
result = []
for i, a in enumerate(accs):
    result.append({'address': a['address'], 'private_key': a['private_key'], 'label': roles[i] if i < len(roles) else f'Account {i}'})
print(json.dumps(result))
" 2>/dev/null || echo '[]')
    echo "" >> "${frontend_env}"
    echo "# ── Devnet Accounts (for account switcher) ────────────────────────" >> "${frontend_env}"
    echo "NEXT_PUBLIC_DEVNET_ACCOUNTS=${accounts_json}" >> "${frontend_env}"
  fi

  if [ -z "${bridge_addr}" ]; then
    log_warn "Contract addresses empty — run './scripts/deploy.sh' then re-run with 'start'"
    log_warn "  or use: ./scripts/start-devnet.sh start --deploy"
  fi
}

# ---------------------------------------------------------------------------
# Status Display
# ---------------------------------------------------------------------------
show_status() {
  log_header "Zarklink Devnet Status"

  echo -e "  ${BOLD}Service              Status          PID       Port${NC}"
  echo "  ─────────────────────────────────────────────────────"

  # zcashd
  if is_running "zcashd"; then
    local zec_blocks
    zec_blocks=$(zcash_rpc getblockcount 2>/dev/null || echo "?")
    echo -e "  zcashd               ${GREEN}RUNNING${NC}         $(get_pid zcashd)     ${ZCASH_RPC_PORT}  (${zec_blocks} blocks)"
  else
    echo -e "  zcashd               ${RED}STOPPED${NC}"
  fi

  # starknet-devnet
  if is_running "starknet-devnet"; then
    echo -e "  starknet-devnet      ${GREEN}RUNNING${NC}         $(get_pid starknet-devnet)     ${STARKNET_PORT}"
  else
    echo -e "  starknet-devnet      ${RED}STOPPED${NC}"
  fi

  # Next.js frontend
  if is_running "next-dev"; then
    echo -e "  next.js frontend     ${GREEN}RUNNING${NC}         $(get_pid next-dev)     ${FRONTEND_PORT}"
  else
    echo -e "  next.js frontend     ${YELLOW}NOT STARTED${NC}      (use --frontend)"
  fi

  echo ""

  # Show key files
  if [ -f "${ENV_FILE}" ]; then
    echo -e "  ${BOLD}Config files:${NC}"
    echo "  ├── ${ENV_FILE}"
    echo "  ├── ${DATA_DIR}/zcash-accounts.json"
    echo "  ├── ${DATA_DIR}/starknet-accounts-labeled.json"
    echo "  └── ${DATA_DIR}/accounts.json"
  fi

  echo ""
}

# ---------------------------------------------------------------------------
# Stop All
# ---------------------------------------------------------------------------
stop_all() {
  log_header "Stopping Zarklink Devnet"
  stop_frontend
  stop_zcash
  stop_starknet
  log_success "All services stopped"
}

# ---------------------------------------------------------------------------
# Reset (Wipe + Restart)
# ---------------------------------------------------------------------------
reset_all() {
  log_header "Resetting Zarklink Devnet"
  stop_all
  log_info "Wiping devnet state..."
  rm -rf "${DATA_DIR}"
  log_success "State wiped. Restarting..."
  start_all
}

# ---------------------------------------------------------------------------
# Start All
# ---------------------------------------------------------------------------
start_all() {
  log_header "🔗 Zarklink Development Infrastructure"
  echo -e "  ${BOLD}Version:${NC} Zarklink v0.1.0-alpha"
  echo -e "  ${BOLD}Date:${NC}    $(date -Iseconds)"
  echo ""

  # Prerequisites check
  log_info "Checking prerequisites..."
  check_command "zcashd"          "https://zcash.readthedocs.io/en/latest/rtd_pages/install_binary_tarball.html"
  check_command "zcash-cli"       "https://zcash.readthedocs.io/en/latest/rtd_pages/install_binary_tarball.html"
  check_command "starknet-devnet" "https://github.com/0xSpaceShard/starknet-devnet-rs"
  check_command "python3"         "https://python.org"
  check_command "curl"            "apt install curl"
  log_success "All prerequisites found"

  # Create directories
  mkdir -p "${DATA_DIR}" "${LOG_DIR}" "${PID_DIR}"

  # Start services
  start_zcash
  fund_zcash_accounts
  start_starknet
  fetch_starknet_accounts
  generate_env_file
  generate_accounts_summary

  # Deploy contracts if --deploy flag was passed
  if [ "${DEPLOY_CONTRACTS:-false}" = "true" ]; then
    deploy_contracts
  fi

  # Generate frontend .env.local
  generate_frontend_env

  # Start frontend if --frontend flag was passed
  if [ "${START_FRONTEND:-false}" = "true" ]; then
    start_frontend
  fi

  # Final status
  show_status

  log_header "✅ Zarklink Devnet Ready!"
  echo -e "  ${BOLD}Zcash RPC:${NC}       http://127.0.0.1:${ZCASH_RPC_PORT}"
  echo -e "  ${BOLD}Starknet RPC:${NC}    http://${STARKNET_HOST}:${STARKNET_PORT}"
  echo -e "  ${BOLD}Environment:${NC}     ${ENV_FILE}"
  echo -e "  ${BOLD}Frontend env:${NC}    ${PROJECT_ROOT}/frontend/.env.local"
  echo -e "  ${BOLD}Accounts:${NC}        ${DATA_DIR}/accounts.json"
  if is_running "next-dev"; then
    echo -e "  ${BOLD}Frontend:${NC}        http://localhost:${FRONTEND_PORT}"
  fi
  echo ""
  echo -e "  ${CYAN}Quick commands:${NC}"
  echo "    zcash-cli -datadir=${ZCASH_DIR} -rpcport=${ZCASH_RPC_PORT} getblockcount"
  echo "    curl http://${STARKNET_HOST}:${STARKNET_PORT}/is_alive"
  if ! is_running "next-dev"; then
    echo "    cd frontend && npm run dev    # Start Next.js on http://localhost:3000"
  fi
  echo ""
  echo -e "  ${CYAN}Stop:${NC}  ./scripts/start-devnet.sh stop"
  echo -e "  ${CYAN}Reset:${NC} ./scripts/start-devnet.sh reset"
  echo ""
}

# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------
health_check() {
  log_header "Health Check"

  local healthy=true

  # Check zcashd
  if is_running "zcashd"; then
    local info
    info=$(zcash_rpc getblockchaininfo 2>/dev/null)
    if [ -n "$info" ]; then
      log_success "zcashd: healthy"
    else
      log_error "zcashd: running but RPC unresponsive"
      healthy=false
    fi
  else
    log_error "zcashd: not running"
    healthy=false
  fi

  # Check starknet-devnet
  if is_running "starknet-devnet"; then
    local alive
    alive=$(curl -s "http://${STARKNET_HOST}:${STARKNET_PORT}/is_alive" 2>/dev/null)
    if [ -n "$alive" ]; then
      log_success "starknet-devnet: healthy"
    else
      log_error "starknet-devnet: running but HTTP unresponsive"
      healthy=false
    fi
  else
    log_error "starknet-devnet: not running"
    healthy=false
  fi

  # Check frontend
  if is_running "next-dev"; then
    local fe_alive
    fe_alive=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${FRONTEND_PORT}" 2>/dev/null)
    if [ "$fe_alive" = "200" ] || [ "$fe_alive" = "304" ]; then
      log_success "next.js frontend: healthy"
    else
      log_warn "next.js frontend: running but HTTP returned ${fe_alive}"
    fi
  fi

  if $healthy; then
    log_success "All services healthy ✓"
  else
    log_error "Some services are unhealthy"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# Parse flags from any position
DEPLOY_CONTRACTS=false
START_FRONTEND=false
MAIN_CMD=""
for arg in "$@"; do
  case "$arg" in
    --deploy)   DEPLOY_CONTRACTS=true ;;
    --frontend) START_FRONTEND=true ;;
    *)          [ -z "$MAIN_CMD" ] && MAIN_CMD="$arg" ;;
  esac
done
MAIN_CMD="${MAIN_CMD:-start}"
export DEPLOY_CONTRACTS
export START_FRONTEND

case "${MAIN_CMD}" in
  start)    start_all ;;
  stop)     stop_all ;;
  status)   show_status ;;
  reset)    reset_all ;;
  health)   health_check ;;
  *)
    echo "Usage: $0 {start|stop|status|reset|health} [--deploy] [--frontend]"
    echo ""
    echo "Commands:"
    echo "  start    Start Zcash regtest + Starknet devnet (default)"
    echo "  stop     Stop all services (incl. frontend if running)"
    echo "  status   Show service status"
    echo "  reset    Wipe state and restart"
    echo "  health   Run health checks on running services"
    echo ""
    echo "Flags:"
    echo "  --deploy    Build and deploy Cairo contracts after chains start"
    echo "  --frontend  Also start the Next.js frontend dev server on port ${FRONTEND_PORT}"
    exit 1
    ;;
esac
