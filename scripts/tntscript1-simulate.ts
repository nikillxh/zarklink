#!/usr/bin/env node
// ============================================================================
// Zarklink — Testnet Script 1: Issue Walkthrough (Starknet Sepolia)
// ============================================================================
// Walks through a single Issue cycle (request_lock → submit_mint →
// confirm_issue) using the deployer as both issuer and vault operator.
//
// Unlike devnet, there is no local zcashd — the actual TAZ transfer must
// happen manually by the user. This script exercises the Starknet side only.
//
// Prerequisites:
//   - tntscript0-setup.ts has been run (vault registered, funded)
//   - .env.sepolia and .sepolia/deployments.json exist
//
// Usage:  npx tsx scripts/tntscript1-simulate.ts
// ============================================================================

import { RpcProvider, Account, Contract, CallData, logger } from "starknet";
import * as fs from "fs";
import * as path from "path";

logger.setLogLevel("ERROR");

// ── Config ───────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, ".sepolia");
const ENV_FILE = path.join(PROJECT_ROOT, ".env.sepolia");
const DEPLOYMENTS_FILE = path.join(DATA_DIR, "deployments.json");

// Auto-load .env.sepolia
if (fs.existsSync(ENV_FILE)) {
  const envLines = fs.readFileSync(ENV_FILE, "utf-8").split("\n");
  for (const line of envLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}

// Also load frontend/.env.testnet for contract addresses
const FRONTEND_ENV = path.join(PROJECT_ROOT, "frontend", ".env.testnet");
if (fs.existsSync(FRONTEND_ENV)) {
  const envLines = fs.readFileSync(FRONTEND_ENV, "utf-8").split("\n");
  for (const line of envLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}

const STARKNET_RPC_URL =
  process.env.STARKNET_SEPOLIA_RPC_URL ||
  process.env.NEXT_PUBLIC_STARKNET_RPC_URL ||
  "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/demo";

const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS || process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS || "";
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || process.env.DEPLOYER_KEY || "";

// Optional Zcash testnet RPC for fetching block headers
const ZCASH_TESTNET_RPC = process.env.ZCASH_TESTNET_RPC_URL || "";
const TATUM_API_KEY = process.env.TATUM_API_KEY || "";

// ── Colors ───────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m", magenta: "\x1b[35m",
  dim: "\x1b[2m",
};

function info(msg: string) { console.log(`${C.cyan}[TNT-S1]${C.reset} ${msg}`); }
function ok(msg: string) { console.log(`${C.green}[TNT-S1]${C.reset} ${msg}`); }
function warn(msg: string) { console.log(`${C.yellow}[TNT-S1]${C.reset} ${msg}`); }
function err(msg: string) { console.log(`${C.red}[TNT-S1]${C.reset} ${msg}`); }
function header(msg: string) { console.log(`\n${C.bold}${C.blue}═══ ${msg} ═══${C.reset}\n`); }

// ── ABIs ─────────────────────────────────────────────────────────────────────

const BRIDGE_ABI = [
  { type: "function", name: "get_issue_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_redeem_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_issue_request", inputs: [{ name: "request_id", type: "core::felt252" }], outputs: [{ type: "core::felt252" }, { type: "core::starknet::contract_address::ContractAddress" }, { type: "core::integer::u32" }, { type: "core::integer::u8" }, { type: "core::felt252" }, { type: "core::felt252" }, { type: "core::felt252" }, { type: "core::integer::u256" }, { type: "core::integer::u256" }, { type: "core::integer::u64" }, { type: "core::integer::u64" }], state_mutability: "view" },
];
const RELAY_ABI = [
  { type: "function", name: "get_chain_tip", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_finalized_height", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_header_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_commitment_root", inputs: [{ name: "block_height", type: "core::integer::u32" }], outputs: [{ type: "core::felt252" }], state_mutability: "view" },
  { type: "function", name: "submit_header", inputs: [{ name: "header", type: "(core::integer::u32, core::felt252, core::felt252, core::felt252, core::integer::u32, core::integer::u32, core::felt252, core::integer::u32)" }], outputs: [], state_mutability: "external" },
];
const WZEC_ABI = [
  { type: "function", name: "total_supply", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "balance_of", inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
];
const POOL_ABI = [
  { type: "function", name: "get_active_vault_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_pool_capacity", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "get_total_deposited", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
];
const REGISTRY_ABI = [
  { type: "function", name: "get_vault_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTaz(zatoshi: bigint): string {
  return `${(Number(zatoshi) / 1e8).toFixed(8)} TAZ`;
}

// Attempt to fetch Zcash testnet block header via public RPC
async function zcashTestnetRpc(method: string, params: unknown[] = []): Promise<unknown> {
  if (!ZCASH_TESTNET_RPC) throw new Error("No ZCASH_TESTNET_RPC_URL configured");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (TATUM_API_KEY) headers["x-api-key"] = TATUM_API_KEY;
  const res = await fetch(ZCASH_TESTNET_RPC, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "1.0", id: "tnt-s1", method, params }),
  });
  if (!res.ok) throw new Error(`Zcash testnet RPC ${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? `RPC error in ${method}`);
  return json.result;
}

// Try to seed relay with a few Zcash testnet block headers
async function tryRelayHeaders(
  deployer: Account,
  relayAddr: string,
  provider: RpcProvider,
  count: number,
): Promise<number> {
  if (!ZCASH_TESTNET_RPC) {
    warn("No ZCASH_TESTNET_RPC_URL — skipping relay header seeding");
    return 0;
  }

  const relay = new Contract({ abi: RELAY_ABI, address: relayAddr, providerOrAccount: deployer });
  const currentTip = Number(await relay.call("get_chain_tip"));
  info(`Relay chain tip: ${currentTip}`);

  // Get Zcash testnet chain tip
  let zcashTip: number;
  try {
    zcashTip = await zcashTestnetRpc("getblockcount") as number;
    ok(`Zcash testnet chain tip: ${zcashTip}`);
  } catch (e: any) {
    warn("Cannot reach Zcash testnet RPC: " + (e?.message || "").slice(0, 100));
    return 0;
  }

  // Determine starting height — use recent blocks if relay is empty
  let startHeight: number;
  if (currentTip === 0) {
    // Start from a recent-ish block
    startHeight = Math.max(1, zcashTip - count - 5);
    info(`Relay empty — starting from testnet block ${startHeight}`);
  } else {
    startHeight = currentTip + 1;
  }

  let submitted = 0;
  const TX_WAIT_OPTS = { retryInterval: 5000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] as any };

  for (let h = startHeight; h < startHeight + count && h <= zcashTip; h++) {
    try {
      const bhash = await zcashTestnetRpc("getblockhash", [h]) as string;
      const hdr = await zcashTestnetRpc("getblockheader", [bhash]) as Record<string, unknown>;

      const cairoHeader = {
        version: "0x" + Number(hdr.version).toString(16),
        prev_block_hash: hdr.previousblockhash ? "0x" + String(hdr.previousblockhash).slice(0, 62) : "0x0",
        merkle_root: "0x" + String(hdr.merkleroot).slice(0, 62),
        commitment_root: "0x" + String(hdr.finalsaplingroot).slice(0, 62),
        timestamp: String(hdr.time),
        bits: "0x" + String(hdr.bits),
        nonce: "0x" + String(hdr.nonce).slice(0, 62),
        block_height: String(h),
      };

      const tx = await deployer.execute({
        contractAddress: relayAddr,
        entrypoint: "submit_header",
        calldata: CallData.compile({ header: cairoHeader }),
      });
      await provider.waitForTransaction(tx.transaction_hash, TX_WAIT_OPTS);
      submitted++;
      if (submitted % 5 === 0) info(`  Submitted ${submitted} headers...`);
    } catch (e: any) {
      // Non-fatal — continue with next block
      if (submitted === 0) {
        warn("  Header submit failed: " + (e?.message || "").slice(0, 80));
      }
    }
  }

  return submitted;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  header("Testnet Script 1 — Issue Walkthrough (Sepolia)");

  // ── Validate ──────────────────────────────────────────────────────────
  if (!DEPLOYER_ADDRESS || !DEPLOYER_KEY) {
    err("Missing DEPLOYER_ADDRESS / DEPLOYER_PRIVATE_KEY. Set in .env.sepolia.");
    process.exit(1);
  }
  if (!fs.existsSync(DEPLOYMENTS_FILE)) {
    err(`Deployments not found at ${DEPLOYMENTS_FILE}. Run deploy-sepolia.ts first.`);
    process.exit(1);
  }

  const deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf-8"));
  const bridgeAddr = deployments.contracts.bridge_protocol.address;
  const registryAddr = deployments.contracts.vault_registry.address;
  const poolAddr = deployments.contracts.vault_pool.address;
  const relayAddr = deployments.contracts.zcash_relay.address;
  const wzecAddr = deployments.contracts.wzec_token.address;

  const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });
  const deployerAccount = new Account({ provider, address: DEPLOYER_ADDRESS, signer: DEPLOYER_KEY });

  const bridge = new Contract({ abi: BRIDGE_ABI, address: bridgeAddr, providerOrAccount: provider });
  const relay = new Contract({ abi: RELAY_ABI, address: relayAddr, providerOrAccount: deployerAccount });
  const wzec = new Contract({ abi: WZEC_ABI, address: wzecAddr, providerOrAccount: provider });
  const pool = new Contract({ abi: POOL_ABI, address: poolAddr, providerOrAccount: provider });
  const registry = new Contract({ abi: REGISTRY_ABI, address: registryAddr, providerOrAccount: provider });

  info(`Deployer: ${DEPLOYER_ADDRESS.slice(0, 20)}...`);
  info(`RPC:      ${STARKNET_RPC_URL}`);

  const TX_WAIT_OPTS = { retryInterval: 5000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] as any };

  // ── Phase 1: Seed Relay with Testnet Headers ──────────────────────────
  header("Phase 1: Relay Header Seeding");
  info("Attempting to seed relay with Zcash testnet headers...");
  const relayedCount = await tryRelayHeaders(deployerAccount, relayAddr, provider, 15);
  ok(`Relayed ${relayedCount} headers`);

  // Check finalized state
  const finalizedHeight = Number(await relay.call("get_finalized_height"));
  info(`Relay finalized height: ${finalizedHeight}`);

  // Find a usable commitment root
  let commitmentRoot = "0x0";
  let commitmentHeight = 0;
  if (finalizedHeight > 0) {
    for (let h = finalizedHeight; h >= 1 && h > finalizedHeight - 10; h--) {
      try {
        const root = await relay.call("get_commitment_root", [h]);
        const rs = String(root);
        if (rs !== "0" && rs !== "0x0") {
          commitmentRoot = rs;
          commitmentHeight = h;
          break;
        }
      } catch { /* ignore */ }
    }
  }

  if (commitmentRoot === "0x0") {
    warn("No finalized block with commitment root — will use dummy commitment");
    // Use a synthetic commitment root for testing
    commitmentRoot = "0x" + BigInt(Date.now()).toString(16);
    commitmentHeight = Math.max(finalizedHeight, 1);
  }

  ok(`Using commitment root from height ${commitmentHeight}`);

  // ── Phase 2: Simulate Issue (request_lock → submit_mint → confirm) ─────
  header("Phase 2: Issue Walkthrough (0.1 TAZ)");

  const issueAmount = 0.1; // TAZ
  const zatoshi = Math.round(issueAmount * 1e8);

  // Step 2a: request_lock
  info(`Requesting lock for ${issueAmount} TAZ...`);
  let requestId = "0x0";
  try {
    const tx = await deployerAccount.execute({
      contractAddress: bridgeAddr,
      entrypoint: "request_lock",
      calldata: CallData.compile({
        mint_amount: { low: String(zatoshi), high: "0" },
        warranty_collateral: { low: "1000000", high: "0" }, // 0.01 TAZ warranty
      }),
    });
    await deployerAccount.waitForTransaction(tx.transaction_hash, TX_WAIT_OPTS);

    // Extract request_id from receipt
    const receipt = await provider.getTransactionReceipt(tx.transaction_hash);
    const events = (receipt as any)?.events ?? [];
    if (events.length > 0 && events[0].keys?.length > 1) requestId = events[0].keys[1];
    else if (events.length > 0 && events[0].data?.length > 0) requestId = events[0].data[0];

    if (requestId === "0x0") {
      warn("Could not extract request_id from events — using fallback");
      // Try reading issue count as fallback
      const count = Number(await bridge.call("get_issue_count"));
      requestId = "0x" + (count - 1).toString(16);
    }
    ok(`request_lock complete — request_id: ${requestId}`);
  } catch (e: any) {
    err("request_lock failed: " + (e?.message || "").slice(0, 150));
    info("This may mean the vault has no capacity or collateral. Check tntscript0 output.");
    process.exit(1);
  }

  // Read the vault_id assigned
  let vaultId = 0;
  try {
    const req: any = await bridge.call("get_issue_request", [requestId]);
    vaultId = Number(req[2] ?? 0);
    info(`Assigned to vault_id: ${vaultId}`);
  } catch (e: any) {
    warn("Could not read issue request: " + (e?.message || "").slice(0, 100));
  }

  // Step 2b: In testnet, the TAZ transfer is manual. Print instructions.
  console.log();
  console.log(`  ${C.bold}${C.yellow}ACTION REQUIRED: Send TAZ${C.reset}`);
  console.log(`  In a real testnet flow, you would now send ${issueAmount} TAZ`);
  console.log(`  from your Zcash testnet wallet to the vault's Zcash address.`);
  console.log(`  For this script, we'll skip the actual transfer and proceed`);
  console.log(`  with submit_mint using a synthetic proof.`);
  console.log();

  // Step 2c: submit_mint
  info("Submitting mint proof...");
  try {
    const tx = await deployerAccount.execute({
      contractAddress: bridgeAddr,
      entrypoint: "submit_mint",
      calldata: CallData.compile({
        request_id: requestId,
        note_commitment: commitmentRoot,
        inclusion_proof: [],
        block_height: commitmentHeight,
        note_ciphertext_hash: "0x" + BigInt(Date.now()).toString(16),
        zk_proof: ["0x1", "0x2"],
      }),
    });
    await deployerAccount.waitForTransaction(tx.transaction_hash, TX_WAIT_OPTS);
    ok("submit_mint complete");
  } catch (e: any) {
    err("submit_mint failed: " + (e?.message || "").slice(0, 150));
    info("This may be a relay finality issue. Try seeding more headers.");
  }

  // Step 2d: confirm_issue (deployer is the vault operator)
  info("Confirming issue (vault operator = deployer)...");
  try {
    const tx = await deployerAccount.execute({
      contractAddress: bridgeAddr,
      entrypoint: "confirm_issue",
      calldata: CallData.compile({ request_id: requestId }),
    });
    await deployerAccount.waitForTransaction(tx.transaction_hash, TX_WAIT_OPTS);
    ok("confirm_issue complete — wTAZ minted!");
  } catch (e: any) {
    err("confirm_issue failed: " + (e?.message || "").slice(0, 150));
  }

  // ── Phase 3: System State Summary ──────────────────────────────────────
  header("System State Summary");

  try {
    const relayTip = Number(await relay.call("get_chain_tip"));
    const relayFinalized = Number(await relay.call("get_finalized_height"));
    const headerCount = Number(await relay.call("get_header_count"));
    const totalIssues = Number(await bridge.call("get_issue_count"));
    const totalRedeems = Number(await bridge.call("get_redeem_count"));
    const totalSupply = BigInt(String(await wzec.call("total_supply")));
    const deployerBal = BigInt(String(await wzec.call("balance_of", [DEPLOYER_ADDRESS])));
    const activeVaults = Number(await pool.call("get_active_vault_count"));
    const poolCap = BigInt(String(await pool.call("get_pool_capacity")));
    const vaultCount = Number(await registry.call("get_vault_count"));

    console.log(`  ${C.bold}Bridge Protocol${C.reset}`);
    console.log(`  ├── Total Issues:      ${C.green}${totalIssues}${C.reset}`);
    console.log(`  ├── Total Redeems:     ${C.yellow}${totalRedeems}${C.reset}`);
    console.log(`  └── wTAZ Supply:       ${C.cyan}${formatTaz(totalSupply)}${C.reset}`);
    console.log();
    console.log(`  ${C.bold}Vault Registry${C.reset}`);
    console.log(`  ├── Registered:        ${vaultCount}`);
    console.log(`  ├── Active in Pool:    ${activeVaults}`);
    console.log(`  └── Pool Capacity:     ${formatTaz(poolCap)}`);
    console.log();
    console.log(`  ${C.bold}Deployer${C.reset}`);
    console.log(`  └── wTAZ Balance:      ${formatTaz(deployerBal)}`);
    console.log();
    console.log(`  ${C.bold}Zcash Relay${C.reset}`);
    console.log(`  ├── Chain Tip:         #${relayTip}`);
    console.log(`  ├── Finalized:         #${relayFinalized}`);
    console.log(`  └── Total Headers:     ${headerCount}`);
    console.log();
  } catch (e: any) {
    warn("Could not read final state: " + (e?.message || "").slice(0, 100));
  }

  ok("Testnet Script 1 complete — issue walkthrough finished!");
}

main().catch((e) => {
  err(`Testnet Script 1 failed: ${e.message || e}`);
  process.exit(1);
});
