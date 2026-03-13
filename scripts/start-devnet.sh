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
#   ./scripts/start-devnet.sh --deploy --frontend   # Deploy + frontend
#   ./scripts/start-devnet.sh --services            # Register vault + start relayer/vault-daemon
#   ./scripts/start-devnet.sh --script0             # Enhanced setup: 8 vaults (varying collateral) + fund users + seed relay
#   ./scripts/start-devnet.sh --script1             # Simulate: issues, redeems, slashing, multi-user funding
#   ./scripts/start-devnet.sh --full-infra          # Deploy + 8 vaults (script0) + services + frontend
#   ./scripts/start-devnet.sh --full-stack          # Full-infra + simulation (script1)
#   ./scripts/start-devnet.sh stop                  # Stop all services
#   ./scripts/start-devnet.sh status                # Check service status
#   ./scripts/start-devnet.sh reset                 # Wipe state and restart
#   ./scripts/start-devnet.sh reset --full-stack
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
# Reuse the saved password if zcash.conf already exists (so status/stop/health work
# across invocations), otherwise generate a new one for fresh setups.
if [ -f "${ZCASH_CONF}" ]; then
  ZCASH_RPC_PASS=$(grep '^rpcpassword=' "${ZCASH_CONF}" 2>/dev/null | cut -d= -f2-)
fi
ZCASH_RPC_PASS="${ZCASH_RPC_PASS:-zarklink-dev-$(date +%s | sha256sum | head -c 16)}"
ZCASH_MINERS=3
ZCASH_INITIAL_BLOCKS=200

# ── Number of vault operators to register ─────────────────────────────────
# Change this default to control how many vaults are created in devnet.
# Override at runtime with: --vaults N
NUM_VAULTS=8

# Starknet devnet configuration
STARKNET_HOST="127.0.0.1"
STARKNET_PORT=5050
STARKNET_SEED=42
# Accounts: 1 deployer + NUM_VAULTS vaults + issuer + redeemer + relayer + oracle + 1 spare
STARKNET_ACCOUNTS=$((NUM_VAULTS + 7))
STARKNET_INITIAL_BALANCE="1000000000000000000000"

# Derived role indices (auto-computed from NUM_VAULTS)
ISSUER_INDEX=$((NUM_VAULTS + 1))
REDEEMER_INDEX=$((NUM_VAULTS + 2))
RELAYER_INDEX=$((NUM_VAULTS + 3))
ORACLE_INDEX=$((NUM_VAULTS + 4))

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

# Detect npm vs pnpm
detect_pkg_manager() {
  if [ -f "${PROJECT_ROOT}/pnpm-lock.yaml" ] && command -v pnpm &>/dev/null; then
    echo "pnpm"
  else
    echo "npm"
  fi
}

# Run a package.json script in a directory using the detected package manager
pkg_run() {
  local dir="$1"
  shift
  local pm
  pm=$(detect_pkg_manager)
  if [ "$pm" = "pnpm" ]; then
    (cd "$dir" && pnpm "$@")
  else
    (cd "$dir" && npm "$@")
  fi
}

# Install deps in a package directory
pkg_install() {
  local dir="$1"
  local pm
  pm=$(detect_pkg_manager)
  if [ "$pm" = "pnpm" ]; then
    (cd "${PROJECT_ROOT}" && pnpm install)
  else
    (cd "$dir" && npm install --silent)
  fi
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
    if [ $rpc_waited -ge 420 ]; then
      log_error "zcashd wallet failed to load within 420s"
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
    "$@"
}

# Quiet variant — suppresses stderr (for calls where failure is expected/handled)
zcash_rpc_quiet() {
  zcash_rpc "$@" 2>/dev/null
}

fund_zcash_accounts() {
  log_header "Funding Zcash Regtest Accounts (${NUM_VAULTS} vaults)"

  local block_count
  block_count=$(zcash_rpc_quiet getblockcount || echo "0")

  if [ "$block_count" -lt "$ZCASH_INITIAL_BLOCKS" ]; then
    log_info "Mining ${ZCASH_INITIAL_BLOCKS} initial blocks..."
    zcash_rpc generate "${ZCASH_INITIAL_BLOCKS}" >/dev/null
    log_success "Mined ${ZCASH_INITIAL_BLOCKS} blocks"
  else
    log_info "Chain already has ${block_count} blocks, skipping mining"
  fi

  # Create transparent addresses for funding
  log_info "Creating ${ZCASH_MINERS} transparent funding addresses..."
  local t_addrs=()
  for i in $(seq 1 "$ZCASH_MINERS"); do
    local addr
    addr=$(zcash_rpc getnewaddress "")
    t_addrs+=("$addr")
    log_info "  T-addr ${i}: ${addr}"
  done

  # Create shielded (Sapling) addresses for each vault operator
  log_info "Creating ${NUM_VAULTS} vault shielded addresses..."
  local vault_z_addrs=()
  for i in $(seq 1 "$NUM_VAULTS"); do
    local addr
    addr=$(zcash_rpc z_getnewaddress sapling)
    vault_z_addrs+=("$addr")
    log_info "  Vault #${i}: ${addr:0:20}...${addr: -8}"
  done

  # Create shielded addresses for issuer and redeemer
  log_info "Creating issuer and redeemer shielded addresses..."
  local issuer_z_addr
  issuer_z_addr=$(zcash_rpc z_getnewaddress sapling)
  log_info "  Issuer:   ${issuer_z_addr:0:20}...${issuer_z_addr: -8}"

  local redeemer_z_addr
  redeemer_z_addr=$(zcash_rpc z_getnewaddress sapling)
  log_info "  Redeemer: ${redeemer_z_addr:0:20}...${redeemer_z_addr: -8}"

  # Fund transparent addresses (for shielding later)
  # sendtoaddress uses mature coinbase UTXOs from the initial blocks.
  # Zcash coinbase requires 100-block maturity; with 200 blocks mined,
  # blocks 1-100 are mature (~1000 ZEC spendable).
   # We need ~90 ZEC total (40 for vaults + 50 for users + fees).
  # Fund each T-addr with 55 ZEC (enough for any batch including ZIP 317 fees).
  log_info "Funding transparent addresses..."
  for addr in "${t_addrs[@]}"; do
    zcash_rpc sendtoaddress "$addr" 55.0 >/dev/null || log_warn "  sendtoaddress to ${addr} failed"
  done
  # Mine blocks to confirm transparent transfers
  zcash_rpc generate 10 >/dev/null

  # Shield funds to Sapling addresses in batches
  # NOTE: zcashd v6+ requires explicit privacyPolicy for transparent→shielded transfers.
  # "AllowFullyTransparent" is required because:
  #   1. Sending FROM a t-addr reveals the sender (needs AllowRevealedSenders)
  #   2. Change goes back to a t-addr which reveals recipients (needs AllowRevealedRecipients)
  #   3. AllowFullyTransparent covers both cases
  # Fee is set to 'null' to let zcashd auto-calculate ZIP 317 fees.
  # zcash-cli z_sendmany <from_addr> <recipients_json> <minconf> <fee> <privacyPolicy>
  log_info "Shielding funds to Sapling addresses..."
  local batch_json="" batch_count=0 funder_idx=0
  local per_vault="5.0"
  local all_opids=()

  for i in $(seq 0 $((NUM_VAULTS - 1))); do
    [ -z "$batch_json" ] && batch_json="[" || batch_json+=","
    batch_json+="{\"address\":\"${vault_z_addrs[$i]}\",\"amount\":${per_vault}}"
    batch_count=$((batch_count + 1))
    # Send batch every 5 recipients
    if [ "$batch_count" -ge 5 ] || [ "$i" -eq $((NUM_VAULTS - 1)) ]; then
      batch_json+="]"
      local opid
      opid=$(zcash_rpc z_sendmany "${t_addrs[$funder_idx]}" "$batch_json" 1 null "AllowFullyTransparent" 2>&1)
      local rpc_exit=$?
      if [ $rpc_exit -eq 0 ] && [ -n "$opid" ] && [[ "$opid" == opid-* ]]; then
        log_info "  Vault batch (${batch_count} addrs): ${opid}"
        all_opids+=("$opid")
      else
        log_warn "  Vault batch (${batch_count} addrs) FAILED (exit=$rpc_exit): ${opid}"
      fi
      batch_json="" ; batch_count=0
      funder_idx=$(( (funder_idx + 1) % ${#t_addrs[@]} ))
    fi
  done

  # Fund issuer and redeemer
  local user_batch="[{\"address\":\"${issuer_z_addr}\",\"amount\":25.0},{\"address\":\"${redeemer_z_addr}\",\"amount\":25.0}]"
  local opid_users
  opid_users=$(zcash_rpc z_sendmany "${t_addrs[$funder_idx]}" "$user_batch" 1 null "AllowFullyTransparent" 2>&1)
  local user_exit=$?
  if [ $user_exit -eq 0 ] && [ -n "$opid_users" ] && [[ "$opid_users" == opid-* ]]; then
    log_info "  User batch: ${opid_users}"
    all_opids+=("$opid_users")
  else
    log_warn "  User batch FAILED (exit=$user_exit): ${opid_users}"
  fi

  # Wait for all z_sendmany operations to complete before mining
  if [ ${#all_opids[@]} -gt 0 ]; then
    log_info "Waiting for ${#all_opids[@]} shielded transfers to complete..."
    local op_timeout=180
    for opid in "${all_opids[@]}"; do
      local op_waited=0
      while [ "$op_waited" -lt "$op_timeout" ]; do
        local status
        status=$(zcash_rpc_quiet z_getoperationstatus "[\"${opid}\"]" || echo "[]")
        if echo "$status" | grep -q '"success"'; then
          log_info "  ${opid}: success"
          break
        elif echo "$status" | grep -q '"failed"'; then
          local err_msg
          err_msg=$(echo "$status" | grep -o '"message":"[^"]*"' | head -1 || echo "unknown")
          log_warn "  ${opid}: FAILED — ${err_msg}"
          break
        fi
        sleep 2
        op_waited=$((op_waited + 2))
      done
      if [ "$op_waited" -ge "$op_timeout" ]; then
        log_warn "  ${opid}: timed out after ${op_timeout}s (still executing/queued)"
      fi
    done
  fi

  # Mine blocks to confirm shielded transfers
  sleep 2
  zcash_rpc generate 20 >/dev/null
  # Allow wallet time to scan new blocks containing Sapling outputs
  sleep 5

  # Verify shielded balances were actually funded
  log_info "Verifying shielded balances..."
  local funded_count=0
  for z_addr in "${vault_z_addrs[@]}"; do
    local bal
    bal=$(zcash_rpc_quiet z_getbalance "$z_addr" || echo "0")
    # Check if balance is non-zero (works without bc)
    if [ -n "$bal" ] && [ "$bal" != "0" ] && [ "$bal" != "0.00000000" ]; then
      funded_count=$((funded_count + 1))
    fi
  done
  log_info "  Vaults funded: ${funded_count}/${NUM_VAULTS}"
  
  local issuer_bal redeemer_bal
  issuer_bal=$(zcash_rpc_quiet z_getbalance "$issuer_z_addr" || echo "0")
  redeemer_bal=$(zcash_rpc_quiet z_getbalance "$redeemer_z_addr" || echo "0")
  log_info "  Issuer balance:   ${issuer_bal} ZEC"
  log_info "  Redeemer balance: ${redeemer_bal} ZEC"

  if [ "$funded_count" -eq 0 ]; then
    log_warn "WARNING: No vault accounts were funded! Check zcashd z_sendmany logs."
  fi

  # Get balances
  local total_balance
  total_balance=$(zcash_rpc_quiet z_gettotalbalance || echo "{}")

  log_success "Zcash accounts funded (${NUM_VAULTS} vaults + issuer + redeemer)"
  log_info "Total balance: ${total_balance}"

  # Export to JSON using Python for clean generation
  python3 - "${DATA_DIR}" "${NUM_VAULTS}" "${ZCASH_RPC_PORT}" "${ZCASH_RPC_USER}" "${ZCASH_RPC_PASS}" \
    "${issuer_z_addr}" "${redeemer_z_addr}" "${t_addrs[@]}" "--" "${vault_z_addrs[@]}" <<'ZACCTS_PY'
import sys, json
data_dir = sys.argv[1]
nv = int(sys.argv[2])
rpc_port, rpc_user, rpc_pass = sys.argv[3], sys.argv[4], sys.argv[5]
issuer_addr, redeemer_addr = sys.argv[6], sys.argv[7]
sep = sys.argv.index("--")
t_addrs = sys.argv[8:sep]
vault_addrs = sys.argv[sep+1:]
data = {
    "rpc_url": f"http://127.0.0.1:{rpc_port}",
    "rpc_user": rpc_user,
    "rpc_password": rpc_pass,
    "num_vaults": nv,
    "transparent_addresses": t_addrs,
    "vault_shielded_addresses": vault_addrs,
    "issuer_shielded_address": issuer_addr,
    "redeemer_shielded_address": redeemer_addr,
}
with open(f"{data_dir}/zcash-accounts.json", "w") as f:
    json.dump(data, f, indent=2)
print(f"  Saved {nv} vault + 2 user Zcash addresses")
ZACCTS_PY

  log_success "Zcash accounts saved to ${DATA_DIR}/zcash-accounts.json"
}

stop_zcash() {
  if is_running "zcashd"; then
    log_info "Stopping zcashd..."
    zcash_rpc_quiet stop || kill "$(get_pid zcashd)" 2>/dev/null || true
    # Wait for zcashd to fully exit (release DB locks)
    local waited=0
    while pgrep -x zcashd >/dev/null 2>&1 && [ $waited -lt 30 ]; do
      sleep 1
      waited=$((waited + 1))
    done
    if pgrep -x zcashd >/dev/null 2>&1; then
      log_warn "zcashd still running after 30s, killing..."
      pkill -9 -x zcashd 2>/dev/null || true
      sleep 2
    fi
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

  # Also check if devnet is running externally (e.g. in a separate terminal)
  if curl -s "http://${STARKNET_HOST}:${STARKNET_PORT}/is_alive" 2>/dev/null | grep -q "Alive"; then
    local ext_pid
    ext_pid=$(pgrep -f "starknet-devnet.*--port ${STARKNET_PORT}" 2>/dev/null | head -1)
    if [ -n "$ext_pid" ]; then
      save_pid "starknet-devnet" "$ext_pid"
      log_warn "starknet-devnet already running externally (PID: $ext_pid) — adopting"
      return 0
    fi
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
  count=$(echo "$response" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('result', [])))" 2>/dev/null || echo "?")

  log_success "${count} predeployed accounts available"

  # Display first few accounts
  python3 <<PYEOF
import json

with open("${DATA_DIR}/starknet-accounts.json") as f:
  accounts = json.load(f)

NV = ${NUM_VAULTS}
roles = ["Deployer / Admin"]
for vi in range(1, NV + 1):
  roles.append(f"Vault Operator #{vi}")
roles.extend(["Issuer (Alice)", "Redeemer (Dave)", "Relayer Service", "Oracle Service"])
base = len(roles)
for ti in range(base, len(accounts)):
  roles.append(f"Test User #{ti - base + 1}")

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

  # If already running, restart it so the latest .env.local is picked up
  # (Next.js only reads env files at server startup, NOT hot-reloaded)
  if is_running "next-dev"; then
    log_info "Restarting Next.js to pick up fresh .env.local..."
    stop_frontend
    sleep 1
  fi

  if [ ! -d "${FRONTEND_DIR}" ]; then
    log_error "Frontend directory not found: ${FRONTEND_DIR}"
    return 1
  fi

  # Install deps if node_modules missing
  if [ ! -d "${FRONTEND_DIR}/node_modules" ]; then
    log_info "Installing frontend dependencies..."
    pkg_install "${FRONTEND_DIR}" || {
      log_error "Package install failed"
      return 1
    }
  fi

  # Start Next.js dev server
  local pm
  pm=$(detect_pkg_manager)
  if [ "$pm" = "pnpm" ]; then
    (cd "${FRONTEND_DIR}" && pnpm dev --port "${FRONTEND_PORT}") \
      > "${LOG_DIR}/frontend.log" 2>&1 &
  else
    (cd "${FRONTEND_DIR}" && npm run dev -- --port "${FRONTEND_PORT}") \
      > "${LOG_DIR}/frontend.log" 2>&1 &
  fi

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
      local relayer_addr relayer_pk
      relayer_addr=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[${RELAYER_INDEX}]['address'])" 2>/dev/null || echo "")
      relayer_pk=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[${RELAYER_INDEX}]['private_key'])" 2>/dev/null || echo "")

      cat >> "${ENV_FILE}" <<EOF

# Deployer Account (auto-assigned from predeployed accounts[0])
DEPLOYER_ADDRESS=${deployer_addr}
DEPLOYER_PRIVATE_KEY=${deployer_pk}

# Vault Operator Account (primary vault — accounts[1])
VAULT_ADDRESS=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[1]['address'])" 2>/dev/null || echo "")
VAULT_PRIVATE_KEY=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[1]['private_key'])" 2>/dev/null || echo "")

# Issuer Account (accounts[NUM_VAULTS+1])
ISSUER_ADDRESS=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[${ISSUER_INDEX}]['address'])" 2>/dev/null || echo "")
ISSUER_PRIVATE_KEY=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[${ISSUER_INDEX}]['private_key'])" 2>/dev/null || echo "")

# Redeemer Account (accounts[NUM_VAULTS+2])
REDEEMER_ADDRESS=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[${REDEEMER_INDEX}]['address'])" 2>/dev/null || echo "")
REDEEMER_PRIVATE_KEY=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[${REDEEMER_INDEX}]['private_key'])" 2>/dev/null || echo "")

# Relayer Account (accounts[NUM_VAULTS+3])
RELAYER_ADDRESS=${relayer_addr}
RELAYER_PRIVATE_KEY=${relayer_pk}

# Oracle Account (accounts[NUM_VAULTS+4])
ORACLE_ADDRESS=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[${ORACLE_INDEX}]['address'])" 2>/dev/null || echo "")
ORACLE_PRIVATE_KEY=$(python3 -c "import json; d=json.load(open('${DATA_DIR}/starknet-accounts.json')); print(d[${ORACLE_INDEX}]['private_key'])" 2>/dev/null || echo "")
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

# ── Network Mode ─────────────────────────────────────────────────────────
NEXT_PUBLIC_NETWORK=devnet

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

# ── Zcash RPC Credentials (server-only, for API routes) ─────────────────
ZCASH_RPC_USER=${ZCASH_RPC_USER}
ZCASH_RPC_PASS=${ZCASH_RPC_PASS}
EOF

  log_success "Frontend env written to ${frontend_env}"

  # Also write all devnet accounts as a JSON array for the account switcher
  if [ -f "${DATA_DIR}/starknet-accounts.json" ]; then
    local accounts_json
    accounts_json=$(python3 -c "
import json
NV = ${NUM_VAULTS}
with open('${DATA_DIR}/starknet-accounts.json') as f:
    accs = json.load(f)
try:
    with open('${DATA_DIR}/zcash-accounts.json') as f:
        zdata = json.load(f)
except Exception:
    zdata = {}
vault_z = zdata.get('vault_shielded_addresses', [])
issuer_z = zdata.get('issuer_shielded_address', '')
redeemer_z = zdata.get('redeemer_shielded_address', '')
roles = ['Deployer']
for vi in range(1, NV + 1):
    roles.append(f'Vault #{vi}')
roles.extend(['Issuer (Alice)', 'Redeemer (Dave)', 'Relayer', 'Oracle'])
result = []
for i, a in enumerate(accs):
    entry = {'address': a['address'], 'private_key': a['private_key'], 'label': roles[i] if i < len(roles) else f'User {i - len(roles) + 1}'}
    if 1 <= i <= NV and (i - 1) < len(vault_z):
        entry['zcash_shielded'] = vault_z[i - 1]
    elif i == NV + 1 and issuer_z:
        entry['zcash_shielded'] = issuer_z
    elif i == NV + 2 and redeemer_z:
        entry['zcash_shielded'] = redeemer_z
    result.append(entry)
print(json.dumps(result))
" 2>/dev/null || echo '[]')
    echo "" >> "${frontend_env}"
    echo "# ── Devnet Accounts (for account switcher) ────────────────────────" >> "${frontend_env}"
    echo "NEXT_PUBLIC_DEVNET_ACCOUNTS='${accounts_json}'" >> "${frontend_env}"

    # Also write to a static JSON file that the frontend can import reliably
    # (avoids dotenv parsing issues with large JSON values)
    local public_dir="${PROJECT_ROOT}/frontend/public"
    mkdir -p "${public_dir}"
    echo "${accounts_json}" > "${public_dir}/devnet-accounts.json"
    log_info "Devnet accounts also written to frontend/public/devnet-accounts.json"
  fi

  if [ -z "${bridge_addr}" ]; then
    log_warn "Contract addresses empty — run './scripts/deploy.sh' then re-run with 'start'"
    log_warn "  or use: ./scripts/start-devnet.sh start --deploy"
  fi
}

# ---------------------------------------------------------------------------
# Vault Registration (register vault + deposit collateral on Starknet)
# ---------------------------------------------------------------------------
setup_vault() {
  log_header "Setting Up ${NUM_VAULTS} Vault Operators"

  if [ ! -f "${DATA_DIR}/deployments.json" ]; then
    log_warn "No deployments found — skipping vault setup (deploy contracts first)"
    return 0
  fi

  local pm
  pm=$(detect_pkg_manager)

  # Resolve tsx
  local tsx_bin=""
  if [ -x "${PROJECT_ROOT}/relayer/node_modules/.bin/tsx" ]; then
    tsx_bin="${PROJECT_ROOT}/relayer/node_modules/.bin/tsx"
  elif [ "$pm" = "pnpm" ]; then
    tsx_bin="pnpm exec tsx"
  else
    tsx_bin="npx tsx"
  fi

  export NODE_PATH="${PROJECT_ROOT}/relayer/node_modules"

  # Load env
  if [ -f "${PROJECT_ROOT}/.env.devnet" ]; then
    set -a
    source "${PROJECT_ROOT}/.env.devnet"
    set +a
  fi

  # Run vault setup script inline via tsx — registers NUM_VAULTS vaults
  ${tsx_bin} --eval "
import { RpcProvider, Account, CallData, logger } from 'starknet';
import * as fs from 'fs';

// Suppress harmless fee-estimation warnings on devnet (too few txs for tip analysis)
logger.setLogLevel('ERROR');

const DATA_DIR = '${DATA_DIR}';
const NUM_VAULTS = ${NUM_VAULTS};
const deployments = JSON.parse(fs.readFileSync(DATA_DIR + '/deployments.json', 'utf-8'));
const accounts = JSON.parse(fs.readFileSync(DATA_DIR + '/starknet-accounts.json', 'utf-8'));

const provider = new RpcProvider({ nodeUrl: '${STARKNET_RPC_URL:-http://127.0.0.1:5050}' });

// Deployer (owner) = accounts[0]
const deployer = accounts[0];
const deployerAccount = new Account({ provider, address: deployer.address, signer: deployer.private_key });

const registryAddr = deployments.contracts.vault_registry.address;
const poolAddr = deployments.contracts.vault_pool.address;
const wzecAddr = deployments.contracts.wzec_token.address;
const bridgeAddr = deployments.contracts.bridge_protocol.address;
const collateralPerVault = '1000000000'; // 10 ZEC in zatoshi per vault

async function setupOneVault(index: number) {
  const vaultOp = accounts[index];
  if (!vaultOp) { console.error('[Vault ' + index + '] Account not found — increase STARKNET_ACCOUNTS'); return; }
  const vaultAccount = new Account({ provider, address: vaultOp.address, signer: vaultOp.private_key });
  const tag = '[Vault ' + index + ']';
  console.log(tag + ' Setting up: ' + vaultOp.address.slice(0, 16) + '...');

  // 1. Register vault
  try {
    const regTx = await vaultAccount.execute({
      contractAddress: registryAddr,
      entrypoint: 'register_vault',
      calldata: CallData.compile({
        zcash_addr_d: '0x' + (BigInt('0x1234567890abcdef') + BigInt(index)).toString(16),
        zcash_addr_pkd: '0x' + (BigInt('0xfedcba0987654321') + BigInt(index)).toString(16),
      }),
    });
    await vaultAccount.waitForTransaction(regTx.transaction_hash);
    console.log(tag + ' Registered');
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg.includes('already registered') || msg.includes('VAULT_ALREADY_EXISTS')) {
      console.log(tag + ' Already registered (skipping)');
    } else {
      console.error(tag + ' register_vault failed: ' + msg.slice(0, 200));
      return;
    }
  }

  // 2. Deployer mints wZEC to vault operator for collateral
  // (bridge authority is temporarily set to deployer in main())
  try {
    const mintTx = await deployerAccount.execute({
      contractAddress: wzecAddr,
      entrypoint: 'mint',
      calldata: CallData.compile({ to: vaultOp.address, amount: { low: collateralPerVault, high: '0' } }),
    });
    await deployerAccount.waitForTransaction(mintTx.transaction_hash);
    console.log(tag + ' Minted ' + collateralPerVault + ' wZEC');
  } catch (e: any) {
    console.error(tag + ' Mint FAILED: ' + (e?.message || String(e)).slice(0, 200));
  }

  // 3. Approve VaultPool to spend wZEC
  try {
    const appTx = await vaultAccount.execute({
      contractAddress: wzecAddr,
      entrypoint: 'approve',
      calldata: CallData.compile({ spender: poolAddr, amount: { low: collateralPerVault, high: '0' } }),
    });
    await vaultAccount.waitForTransaction(appTx.transaction_hash);
    console.log(tag + ' Approved VaultPool');
  } catch (e: any) {
    console.error(tag + ' Approve FAILED: ' + (e?.message || String(e)).slice(0, 100));
  }

  // 4. Deposit collateral into VaultRegistry (updates on-chain vault collateral)
  try {
    const regDepTx = await vaultAccount.execute({
      contractAddress: registryAddr,
      entrypoint: 'deposit_collateral',
      calldata: CallData.compile({ amount: { low: collateralPerVault, high: '0' } }),
    });
    await vaultAccount.waitForTransaction(regDepTx.transaction_hash);
    console.log(tag + ' Deposited to VaultRegistry');
  } catch (e: any) {
    console.error(tag + ' Registry deposit FAILED: ' + (e?.message || String(e)).slice(0, 100));
  }

  // 5. Deposit collateral into VaultPool (updates pool accounting)
  try {
    const depTx = await vaultAccount.execute({
      contractAddress: poolAddr,
      entrypoint: 'deposit_collateral',
      calldata: CallData.compile({ amount: { low: collateralPerVault, high: '0' } }),
    });
    await vaultAccount.waitForTransaction(depTx.transaction_hash);
    console.log(tag + ' Deposited to VaultPool');
  } catch (e: any) {
    console.error(tag + ' Pool deposit FAILED: ' + (e?.message || String(e)).slice(0, 100));
  }

  console.log(tag + ' Ready!');
}

async function main() {
  // Temporarily grant deployer mint authority so we can mint wZEC for collateral.
  // WzecToken.mint() asserts caller == bridge, so we set_bridge to deployer,
  // mint all tokens, then restore bridge to BridgeProtocol.
  console.log('[Setup] Granting deployer temporary mint authority...');
  try {
    const setBridgeTx = await deployerAccount.execute({
      contractAddress: wzecAddr,
      entrypoint: 'set_bridge',
      calldata: CallData.compile({ bridge: deployer.address }),
    });
    await deployerAccount.waitForTransaction(setBridgeTx.transaction_hash);
    console.log('[Setup] Deployer is now temporary bridge (can mint)');
  } catch (e: any) {
    console.error('[Setup] WARN: Could not set_bridge to deployer: ' + (e?.message || '').slice(0, 150));
  }

  console.log('[Setup] Registering ' + NUM_VAULTS + ' vault operators (accounts[1..' + NUM_VAULTS + '])...');
  for (let i = 1; i <= NUM_VAULTS; i++) {
    await setupOneVault(i);
  }

  // Restore bridge authority to BridgeProtocol
  console.log('[Setup] Restoring bridge authority to BridgeProtocol...');
  try {
    const restoreTx = await deployerAccount.execute({
      contractAddress: wzecAddr,
      entrypoint: 'set_bridge',
      calldata: CallData.compile({ bridge: bridgeAddr }),
    });
    await deployerAccount.waitForTransaction(restoreTx.transaction_hash);
    console.log('[Setup] Bridge authority restored to ' + bridgeAddr.slice(0, 16) + '...');
  } catch (e: any) {
    console.error('[Setup] CRITICAL: Failed to restore bridge! ' + (e?.message || '').slice(0, 150));
  }

  console.log('[Setup] All ' + NUM_VAULTS + ' vaults configured!');
}

main().catch(e => { console.error('[Setup] Fatal: ' + e.message); process.exit(1); });
" || {
    log_warn "Vault setup had errors (see output above)"
  }

  log_success "${NUM_VAULTS} vault operators configured"
}

# ---------------------------------------------------------------------------
# Relayer Service
# ---------------------------------------------------------------------------
start_relayer() {
  log_header "Starting Zcash Header Relayer"

  if is_running "relayer"; then
    log_warn "Relayer is already running (PID: $(get_pid relayer))"
    return 0
  fi

  if [ ! -d "${PROJECT_ROOT}/relayer/node_modules" ]; then
    log_info "Installing relayer dependencies..."
    pkg_install "${PROJECT_ROOT}/relayer"
  fi

  # Load env
  if [ -f "${PROJECT_ROOT}/.env.devnet" ]; then
    set -a
    source "${PROJECT_ROOT}/.env.devnet"
    set +a
  fi

  local pm
  pm=$(detect_pkg_manager)
  if [ "$pm" = "pnpm" ]; then
    (cd "${PROJECT_ROOT}/relayer" && pnpm dev) \
      > "${LOG_DIR}/relayer.log" 2>&1 &
  else
    (cd "${PROJECT_ROOT}/relayer" && npm run dev) \
      > "${LOG_DIR}/relayer.log" 2>&1 &
  fi

  local pid=$!
  save_pid "relayer" "$pid"

  sleep 3
  if kill -0 "$pid" 2>/dev/null; then
    log_success "Relayer started (PID: ${pid})"
  else
    log_error "Relayer failed to start — check ${LOG_DIR}/relayer.log"
  fi
}

stop_relayer() {
  if is_running "relayer"; then
    log_info "Stopping relayer..."
    kill "$(get_pid relayer)" 2>/dev/null || true
    sleep 1
    log_success "Relayer stopped"
  else
    log_info "Relayer is not running"
  fi
  rm -f "${PID_DIR}/relayer.pid"
}

# ---------------------------------------------------------------------------
# Vault Daemon
# ---------------------------------------------------------------------------
start_vault_daemon() {
  log_header "Starting Vault Daemon"

  if is_running "vault-daemon"; then
    log_warn "Vault daemon is already running (PID: $(get_pid vault-daemon))"
    return 0
  fi

  if [ ! -d "${PROJECT_ROOT}/vault-daemon/node_modules" ]; then
    log_info "Installing vault-daemon dependencies..."
    pkg_install "${PROJECT_ROOT}/vault-daemon"
  fi

  # Load env
  if [ -f "${PROJECT_ROOT}/.env.devnet" ]; then
    set -a
    source "${PROJECT_ROOT}/.env.devnet"
    set +a
  fi

  local pm
  pm=$(detect_pkg_manager)
  if [ "$pm" = "pnpm" ]; then
    (cd "${PROJECT_ROOT}/vault-daemon" && pnpm dev) \
      > "${LOG_DIR}/vault-daemon.log" 2>&1 &
  else
    (cd "${PROJECT_ROOT}/vault-daemon" && npm run dev) \
      > "${LOG_DIR}/vault-daemon.log" 2>&1 &
  fi

  local pid=$!
  save_pid "vault-daemon" "$pid"

  sleep 3
  if kill -0 "$pid" 2>/dev/null; then
    log_success "Vault daemon started (PID: ${pid})"
  else
    log_error "Vault daemon failed to start — check ${LOG_DIR}/vault-daemon.log"
  fi
}

stop_vault_daemon() {
  if is_running "vault-daemon"; then
    log_info "Stopping vault daemon..."
    kill "$(get_pid vault-daemon)" 2>/dev/null || true
    sleep 1
    log_success "Vault daemon stopped"
  else
    log_info "Vault daemon is not running"
  fi
  rm -f "${PID_DIR}/vault-daemon.pid"
}

# ---------------------------------------------------------------------------
# Mine Extra Zcash Blocks (for relay finality)
# ---------------------------------------------------------------------------
mine_relay_blocks() {
  log_header "Mining Zcash Blocks for Relay Finality"

  local needed=10
  log_info "Mining ${needed} extra blocks so relayer has finalized headers..."
  zcash_rpc generate "${needed}" >/dev/null 2>&1 || {
    log_warn "Failed to mine blocks (zcashd may not be running)"
    return 0
  }
  local tip
  tip=$(zcash_rpc getblockcount 2>/dev/null || echo "?")
  log_success "Zcash chain tip: ${tip}"
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
    zec_blocks=$(zcash_rpc_quiet getblockcount || echo "?")
    echo -e "  zcashd               ${GREEN}RUNNING${NC}         $(get_pid zcashd)     ${ZCASH_RPC_PORT}  (${zec_blocks} blocks)"
  else
    echo -e "  zcashd               ${RED}STOPPED${NC}"
  fi

  # starknet-devnet
  if is_running "starknet-devnet"; then
    echo -e "  starknet-devnet      ${GREEN}RUNNING${NC}         $(get_pid starknet-devnet)     ${STARKNET_PORT}"
  elif curl -s "http://${STARKNET_HOST}:${STARKNET_PORT}/is_alive" 2>/dev/null | grep -q "Alive"; then
    local devnet_pid
    devnet_pid=$(pgrep -f "starknet-devnet.*--port ${STARKNET_PORT}" 2>/dev/null | head -1)
    echo -e "  starknet-devnet      ${GREEN}RUNNING${NC}         ${devnet_pid:-?}     ${STARKNET_PORT}  (external)"
  else
    echo -e "  starknet-devnet      ${RED}STOPPED${NC}"
  fi

  # Next.js frontend
  if is_running "next-dev"; then
    echo -e "  next.js frontend     ${GREEN}RUNNING${NC}         $(get_pid next-dev)     ${FRONTEND_PORT}"
  else
    echo -e "  next.js frontend     ${YELLOW}NOT STARTED${NC}      (use --frontend)"
  fi

  # Relayer
  if is_running "relayer"; then
    echo -e "  relayer              ${GREEN}RUNNING${NC}         $(get_pid relayer)"
  else
    echo -e "  relayer              ${YELLOW}NOT STARTED${NC}      (use --services)"
  fi

  # Vault daemon
  if is_running "vault-daemon"; then
    echo -e "  vault-daemon         ${GREEN}RUNNING${NC}         $(get_pid vault-daemon)"
  else
    echo -e "  vault-daemon         ${YELLOW}NOT STARTED${NC}      (use --services)"
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
  stop_vault_daemon
  stop_relayer
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

  # Setup vault + start off-chain services if --services flag was passed
  if [ "${START_SERVICES:-false}" = "true" ]; then
    if [ -f "${DATA_DIR}/deployments.json" ]; then
      # If --script0 was also requested, use enhanced setup instead of basic
      if [ "${RUN_SCRIPT0:-false}" = "true" ]; then
        run_script0
      else
        setup_vault
      fi
      mine_relay_blocks
      start_relayer
      start_vault_daemon
    else
      log_warn "Contracts not deployed — skipping service startup (use --deploy --services)"
    fi
  elif [ "${RUN_SCRIPT0:-false}" = "true" ]; then
    # script0 requested standalone (without --services)
    run_script0
  fi

  # Run simulation script if --script1 was passed
  if [ "${RUN_SCRIPT1:-false}" = "true" ]; then
    run_script1
  fi

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
    local pm_hint
    pm_hint=$(detect_pkg_manager)
    if [ "$pm_hint" = "pnpm" ]; then
      echo "    pnpm -C frontend dev         # Start Next.js on http://localhost:3000"
    else
      echo "    cd frontend && npm run dev    # Start Next.js on http://localhost:3000"
    fi
  fi
  echo ""
  echo -e "  ${CYAN}Stop:${NC}  ./scripts/start-devnet.sh stop"
  echo -e "  ${CYAN}Reset:${NC} ./scripts/start-devnet.sh reset"
  echo ""
}

# ---------------------------------------------------------------------------
# Script 0 — Enhanced Setup (varying collateral, funded users, relay seeding)
# ---------------------------------------------------------------------------
run_script0() {
  log_header "Running Script 0 — Enhanced Devnet Setup"

  if [ ! -f "${DATA_DIR}/deployments.json" ]; then
    log_error "No deployments found — deploy contracts first (--deploy)"
    return 1
  fi

  local pm
  pm=$(detect_pkg_manager)

  local tsx_bin=""
  if [ -x "${PROJECT_ROOT}/relayer/node_modules/.bin/tsx" ]; then
    tsx_bin="${PROJECT_ROOT}/relayer/node_modules/.bin/tsx"
  elif [ "$pm" = "pnpm" ]; then
    tsx_bin="pnpm exec tsx"
  else
    tsx_bin="npx tsx"
  fi

  export NODE_PATH="${PROJECT_ROOT}/relayer/node_modules"

  if [ -f "${PROJECT_ROOT}/.env.devnet" ]; then
    set -a
    source "${PROJECT_ROOT}/.env.devnet"
    set +a
  fi

  ${tsx_bin} "${PROJECT_ROOT}/scripts/devscript0-setup.ts" || {
    log_warn "Script 0 had warnings (see output above)"
  }

  log_success "Script 0 complete"
}

# ---------------------------------------------------------------------------
# Script 1 — Simulate Bridge Activity
# ---------------------------------------------------------------------------
run_script1() {
  log_header "Running Script 1 — Simulate Bridge Activity"

  if [ ! -f "${DATA_DIR}/deployments.json" ]; then
    log_error "No deployments found — run script0 first"
    return 1
  fi

  local pm
  pm=$(detect_pkg_manager)

  local tsx_bin=""
  if [ -x "${PROJECT_ROOT}/relayer/node_modules/.bin/tsx" ]; then
    tsx_bin="${PROJECT_ROOT}/relayer/node_modules/.bin/tsx"
  elif [ "$pm" = "pnpm" ]; then
    tsx_bin="pnpm exec tsx"
  else
    tsx_bin="npx tsx"
  fi

  export NODE_PATH="${PROJECT_ROOT}/relayer/node_modules"

  if [ -f "${PROJECT_ROOT}/.env.devnet" ]; then
    set -a
    source "${PROJECT_ROOT}/.env.devnet"
    set +a
  fi

  ${tsx_bin} "${PROJECT_ROOT}/scripts/devscript1-simulate.ts" || {
    log_warn "Script 1 had warnings (see output above)"
  }

  log_success "Script 1 complete"
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
    info=$(zcash_rpc_quiet getblockchaininfo)
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

  # Check relayer
  if is_running "relayer"; then
    log_success "relayer: running"
  fi

  # Check vault-daemon
  if is_running "vault-daemon"; then
    log_success "vault-daemon: running"
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
START_SERVICES=false
RUN_SCRIPT0=false
RUN_SCRIPT1=false
MAIN_CMD=""
ARGS=("$@")
i=0
while [ $i -lt ${#ARGS[@]} ]; do
  case "${ARGS[$i]}" in
    --deploy)     DEPLOY_CONTRACTS=true ;;
    --frontend)   START_FRONTEND=true ;;
    --services)   START_SERVICES=true ;;
    --script0)    RUN_SCRIPT0=true ;;
    --script1)    RUN_SCRIPT1=true ;;
    --full-infra) DEPLOY_CONTRACTS=true; START_SERVICES=true; START_FRONTEND=true; RUN_SCRIPT0=true ;;
    --full-stack) DEPLOY_CONTRACTS=true; START_SERVICES=true; START_FRONTEND=true; RUN_SCRIPT0=true; RUN_SCRIPT1=true ;;
    --vaults)     i=$((i + 1)); NUM_VAULTS="${ARGS[$i]}"
                  STARKNET_ACCOUNTS=$((NUM_VAULTS + 7))
                  ISSUER_INDEX=$((NUM_VAULTS + 1))
                  REDEEMER_INDEX=$((NUM_VAULTS + 2))
                  RELAYER_INDEX=$((NUM_VAULTS + 3))
                  ORACLE_INDEX=$((NUM_VAULTS + 4)) ;;
    *)            [ -z "$MAIN_CMD" ] && MAIN_CMD="${ARGS[$i]}" ;;
  esac
  i=$((i + 1))
done
MAIN_CMD="${MAIN_CMD:-start}"
export DEPLOY_CONTRACTS
export START_FRONTEND
export START_SERVICES
export RUN_SCRIPT0
export RUN_SCRIPT1

case "${MAIN_CMD}" in
  start)    start_all ;;
  stop)     stop_all ;;
  status)   show_status ;;
  reset)    reset_all ;;
  health)   health_check ;;
  *)
    echo "Usage: $0 {start|stop|status|reset|health} [flags]"
    echo ""
    echo "Commands:"
    echo "  start    Start Zcash regtest + Starknet devnet (default)"
    echo "  stop     Stop all services (incl. frontend, relayer, vault-daemon)"
    echo "  status   Show service status"
    echo "  reset    Wipe state and restart"
    echo "  health   Run health checks on running services"
    echo ""
    echo "Flags:"
    echo "  --deploy      Build and deploy Cairo contracts after chains start"
    echo "  --frontend    Also start the Next.js frontend dev server on port ${FRONTEND_PORT}"
    echo "  --services    Register vault(s), start relayer & vault-daemon"
    echo "  --script0     Enhanced setup: 8 vaults with varying collateral, fund users, seed relay"
    echo "  --script1     Simulate bridge activity: issues, redeems, vault dynamics"
    echo "  --vaults N    Number of vaults to register (default: ${NUM_VAULTS})"
    echo ""
    echo "Combo flags:"
    echo "  --full-infra  --deploy + --services + --script0 + --frontend (fully provisioned)"
    echo "  --full-stack  --full-infra + --script1 (fully provisioned + simulated activity)"
    echo ""
    echo "Examples:"
    echo "  $0                                 # Just start chains"
    echo "  $0 --deploy                        # Start + deploy contracts"
    echo "  $0 --deploy --services             # Start + deploy + basic vault setup + services"
    echo "  $0 --full-infra                    # Everything up, 8 vaults with varying collateral"
    echo "  $0 --full-stack                    # Full infrastructure + simulated bridge activity"
    echo "  $0 reset --full-stack              # Wipe state + full rebuild"
    exit 1
    ;;
esac
