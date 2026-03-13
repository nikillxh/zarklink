#!/usr/bin/env node
// ============================================================================
// Zarklink — Script 1: Simulate Bridge Activity
// ============================================================================
// Simulates realistic bridge activity: multiple issues/redeems, vault
// dynamics (add/drop/slash), relay header progression, and multi-account
// funding. Run AFTER script0 to populate the system with activity history.
//
// Usage:  npx tsx scripts/devscript1-simulate.ts
//         (Assumes devscript0 has already run — vaults registered, relay seeded)
// ============================================================================

import { RpcProvider, Account, Contract, CallData, logger } from "starknet";
import * as fs from "fs";
import * as path from "path";

logger.setLogLevel("ERROR");

// ── Config ───────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, ".devnet");

const ZCASH_RPC_URL = process.env.ZCASH_RPC_URL ?? "http://127.0.0.1:18232";
const ZCASH_RPC_USER = process.env.ZCASH_RPC_USER ?? "zarklink";
const ZCASH_RPC_PASS = process.env.ZCASH_RPC_PASS ?? "";
const STARKNET_RPC_URL = process.env.STARKNET_RPC_URL ?? "http://127.0.0.1:5050";

// ── Colors ───────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m", magenta: "\x1b[35m",
  dim: "\x1b[2m",
};

function info(msg: string) { console.log(`${C.cyan}[SIM]${C.reset}    ${msg}`); }
function ok(msg: string) { console.log(`${C.green}[SIM]${C.reset}    ${msg}`); }
function warn(msg: string) { console.log(`${C.yellow}[SIM]${C.reset}    ${msg}`); }
function err(msg: string) { console.log(`${C.red}[SIM]${C.reset}    ${msg}`); }
function header(msg: string) { console.log(`\n${C.bold}${C.blue}═══ ${msg} ═══${C.reset}\n`); }

// ── Zcash RPC ────────────────────────────────────────────────────────────────

async function zcashRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const auth = Buffer.from(`${ZCASH_RPC_USER}:${ZCASH_RPC_PASS}`).toString("base64");
  const res = await fetch(ZCASH_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: "1.0", id: "script1", method, params }),
  });
  if (!res.ok) throw new Error(`zcashd RPC ${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? `RPC error in ${method}`);
  return json.result;
}

// ── ABIs ─────────────────────────────────────────────────────────────────────

const BRIDGE_ABI = [
  { type: "function", name: "get_issue_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_redeem_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_issue_request", inputs: [{ name: "request_id", type: "core::felt252" }], outputs: [{ type: "core::felt252" }, { type: "core::starknet::contract_address::ContractAddress" }, { type: "core::integer::u32" }, { type: "core::integer::u8" }, { type: "core::felt252" }, { type: "core::felt252" }, { type: "core::felt252" }, { type: "core::integer::u256" }, { type: "core::integer::u256" }, { type: "core::integer::u64" }, { type: "core::integer::u64" }], state_mutability: "view" },
  { type: "function", name: "get_redeem_request", inputs: [{ name: "request_id", type: "core::felt252" }], outputs: [{ type: "core::felt252" }, { type: "core::starknet::contract_address::ContractAddress" }, { type: "core::integer::u32" }, { type: "core::integer::u8" }, { type: "core::felt252" }, { type: "core::felt252" }, { type: "core::integer::u256" }, { type: "core::integer::u256" }, { type: "core::integer::u64" }, { type: "core::integer::u64" }], state_mutability: "view" },
];
const RELAY_ABI = [
  { type: "function", name: "get_chain_tip", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_finalized_height", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_header_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_commitment_root", inputs: [{ name: "block_height", type: "core::integer::u32" }], outputs: [{ type: "core::felt252" }], state_mutability: "view" },
  { type: "function", name: "submit_header", inputs: [{ name: "header", type: "(core::integer::u32, core::felt252, core::felt252, core::felt252, core::integer::u32, core::integer::u32, core::felt252, core::integer::u32)" }], outputs: [], state_mutability: "external" },
];
const REGISTRY_ABI = [
  { type: "function", name: "get_vault_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_vault", inputs: [{ name: "vault_id", type: "core::integer::u32" }], outputs: [{ type: "core::starknet::contract_address::ContractAddress" }, { type: "core::felt252" }, { type: "core::felt252" }, { type: "core::integer::u256" }, { type: "core::integer::u8" }, { type: "core::integer::u64" }, { type: "core::integer::u64" }, { type: "core::integer::u64" }, { type: "core::integer::u256" }, { type: "core::integer::u256" }], state_mutability: "view" },
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatZec(zatoshi: bigint): string {
  return `${(Number(zatoshi) / 1e8).toFixed(8)} ZEC`;
}

async function findFinalizedBlock(relay: Contract): Promise<{ height: number; commitmentRoot: string } | null> {
  const fh = Number(await relay.call("get_finalized_height"));
  if (fh <= 0) return null;
  for (let h = fh; h >= 1 && h > fh - 10; h--) {
    const root = await relay.call("get_commitment_root", [h]);
    const rs = String(root);
    if (rs !== "0" && rs !== "0x0") return { height: h, commitmentRoot: rs };
  }
  return null;
}

async function mineAndRelay(
  deployer: Account,
  relayAddr: string,
  provider: RpcProvider,
  blocks: number,
): Promise<void> {
  // Mine Zcash blocks
  await zcashRpc("generate", [blocks]);

  // Submit headers to relay
  const relay = new Contract({ abi: RELAY_ABI, address: relayAddr, providerOrAccount: deployer });
  const currentTip = Number(await relay.call("get_chain_tip"));
  const zcashTip = await zcashRpc("getblockcount") as number;

  let submitted = 0;
  for (let h = currentTip + 1; h <= zcashTip && submitted < blocks; h++) {
    try {
      const bhash = await zcashRpc("getblockhash", [h]) as string;
      const hdr = await zcashRpc("getblockheader", [bhash]) as Record<string, unknown>;
      const tx = await deployer.execute({
        contractAddress: relayAddr,
        entrypoint: "submit_header",
        calldata: CallData.compile({
          header: {
            version: "0x" + Number(hdr.version).toString(16),
            prev_block_hash: hdr.previousblockhash ? "0x" + String(hdr.previousblockhash).slice(0, 62) : "0x0",
            merkle_root: "0x" + String(hdr.merkleroot).slice(0, 62),
            commitment_root: "0x" + String(hdr.finalsaplingroot).slice(0, 62),
            timestamp: String(hdr.time),
            bits: "0x" + String(hdr.bits),
            nonce: "0x" + String(hdr.nonce).slice(0, 62),
            block_height: String(h),
          },
        }),
      });
      await provider.waitForTransaction(tx.transaction_hash);
      submitted++;
    } catch { /* skip */ }
  }
  info(`  Mined ${blocks} blocks, relayed ${submitted} headers`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  header("Script 1 — Simulate Bridge Activity");

  // ── Load data ──────────────────────────────────────────────────────────
  const deployments = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "deployments.json"), "utf-8"));
  const starknetAccounts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "starknet-accounts.json"), "utf-8"));

  const NUM_VAULTS = 8;
  const ISSUER_INDEX = NUM_VAULTS + 1;
  const REDEEMER_INDEX = NUM_VAULTS + 2;

  const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });
  const deployer = starknetAccounts[0];
  const deployerAccount = new Account({ provider, address: deployer.address, signer: deployer.private_key });

  const bridgeAddr = deployments.contracts.bridge_protocol.address;
  const registryAddr = deployments.contracts.vault_registry.address;
  const poolAddr = deployments.contracts.vault_pool.address;
  const relayAddr = deployments.contracts.zcash_relay.address;
  const wzecAddr = deployments.contracts.wzec_token.address;

  const bridge = new Contract({ abi: BRIDGE_ABI, address: bridgeAddr, providerOrAccount: provider });
  const relay = new Contract({ abi: RELAY_ABI, address: relayAddr, providerOrAccount: deployerAccount });
  const registry = new Contract({ abi: REGISTRY_ABI, address: registryAddr, providerOrAccount: provider });
  const wzec = new Contract({ abi: WZEC_ABI, address: wzecAddr, providerOrAccount: provider });
  const pool = new Contract({ abi: POOL_ABI, address: poolAddr, providerOrAccount: provider });

  const issuerAcct = new Account({ provider, address: starknetAccounts[ISSUER_INDEX].address, signer: starknetAccounts[ISSUER_INDEX].private_key });

  // Track simulation stats
  const stats = { issues: 0, redeems: 0, relayed: 0, errors: 0 };

  // ── Phase 1: Progress Relay ────────────────────────────────────────────
  header("Phase 1: Advance Relay Chain");
  info("Mining and relaying 15 more blocks to ensure finality...");
  await mineAndRelay(deployerAccount, relayAddr, provider, 15);

  const finalized = await findFinalizedBlock(relay);
  if (!finalized) { err("No finalized blocks — cannot simulate issues/redeems"); process.exit(1); }
  ok(`Relay finalized at height ${finalized.height}`);

  // ── Phase 2: Simulate Multiple Issues ──────────────────────────────────
  header("Phase 2: Simulate Issues (ZEC → wZEC)");

  const issueAmounts = [0.5, 1.0, 0.25, 2.0, 0.75]; // 5 issues
  for (let i = 0; i < issueAmounts.length; i++) {
    const amt = issueAmounts[i];
    const zatoshi = Math.round(amt * 1e8);
    info(`Issue ${i + 1}/${issueAmounts.length}: ${amt} ZEC → wZEC`);

    try {
      // Step 1: request_lock
      const tx1 = await issuerAcct.execute({
        contractAddress: bridgeAddr,
        entrypoint: "request_lock",
        calldata: CallData.compile({
          mint_amount: { low: String(zatoshi), high: "0" },
          warranty_collateral: { low: "10000000", high: "0" },
        }),
      });
      await issuerAcct.waitForTransaction(tx1.transaction_hash);

      // Get request_id from receipt
      const receipt1 = await provider.getTransactionReceipt(tx1.transaction_hash);
      const events1 = (receipt1 as any)?.events ?? [];
      let reqId = "0x0";
      if (events1.length > 0 && events1[0].keys?.length > 1) reqId = events1[0].keys[1];
      else if (events1.length > 0 && events1[0].data?.length > 0) reqId = events1[0].data[0];
      if (reqId === "0x0") { warn(`  Could not extract request_id`); stats.errors++; continue; }

      // Read vault_id assigned
      const issueReq: any = await bridge.call("get_issue_request", [reqId]);
      const vaultId = Number(issueReq[2] ?? 0);

      // Step 2: submit_mint
      const tx2 = await issuerAcct.execute({
        contractAddress: bridgeAddr,
        entrypoint: "submit_mint",
        calldata: CallData.compile({
          request_id: reqId,
          note_commitment: finalized.commitmentRoot,
          inclusion_proof: [],
          block_height: finalized.height,
          note_ciphertext_hash: "0x" + BigInt(Date.now() + i).toString(16),
          zk_proof: ["0x1", "0x2"],
        }),
      });
      await issuerAcct.waitForTransaction(tx2.transaction_hash);

      // Step 3: confirm_issue as vault operator
      const vaultAcct = starknetAccounts[vaultId + 1];
      if (!vaultAcct) { warn(`  Vault #${vaultId + 1} account not found`); stats.errors++; continue; }
      const vaultOp = new Account({ provider, address: vaultAcct.address, signer: vaultAcct.private_key });

      const tx3 = await vaultOp.execute({
        contractAddress: bridgeAddr,
        entrypoint: "confirm_issue",
        calldata: CallData.compile({ request_id: reqId }),
      });
      await vaultOp.waitForTransaction(tx3.transaction_hash);

      ok(`  Issue ${i + 1}: ${amt} ZEC → wZEC via Vault #${vaultId + 1} ✓`);
      stats.issues++;
    } catch (e: any) {
      warn(`  Issue ${i + 1} failed: ${(e?.message || "").slice(0, 120)}`);
      stats.errors++;
    }

    // Mine a block between issues for realism
    await mineAndRelay(deployerAccount, relayAddr, provider, 2);
    stats.relayed += 2;
  }

  // ── Phase 3: Simulate Redeems ──────────────────────────────────────────
  header("Phase 3: Simulate Redeems (wZEC → ZEC)");

  const redeemAmounts = [0.25, 0.5, 1.0]; // 3 redeems
  for (let i = 0; i < redeemAmounts.length; i++) {
    const amt = redeemAmounts[i];
    const zatoshi = Math.round(amt * 1e8);
    info(`Redeem ${i + 1}/${redeemAmounts.length}: ${amt} wZEC → ZEC`);

    // Re-fetch finalized block for fresh data
    const fresh = await findFinalizedBlock(relay);
    if (!fresh) { warn("  No finalized block available"); stats.errors++; continue; }

    try {
      // Step 1: submit_burn
      const txBurn = await issuerAcct.execute({
        contractAddress: bridgeAddr,
        entrypoint: "submit_burn",
        calldata: CallData.compile({
          note_commitment: fresh.commitmentRoot,
          note_ciphertext_hash: "0x" + BigInt(Date.now() + 100 + i).toString(16),
          burn_amount: { low: String(zatoshi), high: "0" },
          warranty_collateral: { low: "10000000", high: "0" },
          zk_proof: ["0x1", "0x2"],
        }),
      });
      await issuerAcct.waitForTransaction(txBurn.transaction_hash);

      // Get redeem request_id
      const receipt = await provider.getTransactionReceipt(txBurn.transaction_hash);
      const events = (receipt as any)?.events ?? [];
      let redeemReqId = "0x0";
      if (events.length > 0 && events[0].keys?.length > 1) redeemReqId = events[0].keys[1];
      else if (events.length > 0 && events[0].data?.length > 0) redeemReqId = events[0].data[0];
      if (redeemReqId === "0x0") { warn("  Could not extract redeem request_id"); stats.errors++; continue; }

      // Read vault_id assigned
      const redeemReq: any = await bridge.call("get_redeem_request", [redeemReqId]);
      const rvaultId = Number(redeemReq[2] ?? 0);

      // Step 2: confirm_redeem as vault operator
      const rvaultAcct = starknetAccounts[rvaultId + 1];
      if (!rvaultAcct) { warn(`  Vault #${rvaultId + 1} account not found`); stats.errors++; continue; }
      const rvaultOp = new Account({ provider, address: rvaultAcct.address, signer: rvaultAcct.private_key });

      const txConfirm = await rvaultOp.execute({
        contractAddress: bridgeAddr,
        entrypoint: "confirm_redeem",
        calldata: CallData.compile({
          request_id: redeemReqId,
          inclusion_proof: [],
          block_height: fresh.height,
        }),
      });
      await rvaultOp.waitForTransaction(txConfirm.transaction_hash);

      ok(`  Redeem ${i + 1}: ${amt} wZEC burned via Vault #${rvaultId + 1} ✓`);
      stats.redeems++;
    } catch (e: any) {
      warn(`  Redeem ${i + 1} failed: ${(e?.message || "").slice(0, 120)}`);
      stats.errors++;
    }

    await mineAndRelay(deployerAccount, relayAddr, provider, 2);
    stats.relayed += 2;
  }

  // ── Phase 4: Vault Dynamics ────────────────────────────────────────────
  header("Phase 4: Vault Dynamics");

  // 4a. Slash the last vault (smallest collateral — 1 ZEC)
  // slash_vault is bridge-only, so temporarily set deployer as bridge_protocol
  const lastVaultId = NUM_VAULTS - 1; // 0-indexed: vault #8 → vault_id=7
  info(`Attempting to slash Vault #${lastVaultId + 1} (smallest collateral)...`);
  try {
    // Temporarily grant deployer bridge_protocol role on registry
    const setBridgeTx = await deployerAccount.execute({
      contractAddress: registryAddr,
      entrypoint: "set_bridge_protocol",
      calldata: CallData.compile({ bridge: deployer.address }),
    });
    await deployerAccount.waitForTransaction(setBridgeTx.transaction_hash);

    const tx = await deployerAccount.execute({
      contractAddress: registryAddr,
      entrypoint: "slash_vault",
      calldata: CallData.compile({
        vault_id: lastVaultId,
        amount: { low: String(50000000), high: "0" }, // slash 0.5 ZEC
      }),
    });
    await deployerAccount.waitForTransaction(tx.transaction_hash);
    ok(`Vault #${lastVaultId + 1} slashed (0.5 ZEC)`);

    // Restore bridge_protocol to actual bridge contract
    const restoreTx = await deployerAccount.execute({
      contractAddress: registryAddr,
      entrypoint: "set_bridge_protocol",
      calldata: CallData.compile({ bridge: bridgeAddr }),
    });
    await deployerAccount.waitForTransaction(restoreTx.transaction_hash);
  } catch (e: any) {
    warn("Slash Vault #8: " + (e?.message || "").slice(0, 120));
    // Restore bridge_protocol even on failure
    try {
      await deployerAccount.execute({
        contractAddress: registryAddr,
        entrypoint: "set_bridge_protocol",
        calldata: CallData.compile({ bridge: bridgeAddr }),
      });
    } catch { /* ignore restore failure */ }
  }

  // 4b. Fund extra Zcash shielded addresses (simulating new users joining)
  info("Creating 2 new Zcash shielded addresses (new users)...");
  try {
    const addr1 = await zcashRpc("z_getnewaddress", ["sapling"]) as string;
    const addr2 = await zcashRpc("z_getnewaddress", ["sapling"]) as string;
    ok(`  New user 1: ${String(addr1).slice(0, 20)}...`);
    ok(`  New user 2: ${String(addr2).slice(0, 20)}...`);

    // Fund them from transparent
    const tAddr = await zcashRpc("getnewaddress", [""]) as string;
    await zcashRpc("sendtoaddress", [tAddr, 100]);
    await zcashRpc("generate", [10]);

    const opid1 = await zcashRpc("z_sendmany", [tAddr, [{ address: addr1, amount: 5 }, { address: addr2, amount: 5 }], 0, null, "NoPrivacy"]);
    ok(`  Funding op: ${opid1}`);
    await zcashRpc("generate", [5]);
  } catch (e: any) {
    warn("Zcash user funding: " + (e?.message || "").slice(0, 100));
  }

  // 4c. Fund extra Starknet accounts with wZEC
  info("Funding 2 extra Starknet accounts with wZEC...");
  const extraAccounts = starknetAccounts.slice(NUM_VAULTS + 5, NUM_VAULTS + 7);
  if (extraAccounts.length > 0) {
    try {
      // Temporarily grant deployer mint authority
      const setTx = await deployerAccount.execute({
        contractAddress: wzecAddr,
        entrypoint: "set_bridge",
        calldata: CallData.compile({ bridge: deployer.address }),
      });
      await deployerAccount.waitForTransaction(setTx.transaction_hash);

      for (let i = 0; i < extraAccounts.length; i++) {
        const acc = extraAccounts[i];
        const mintTx = await deployerAccount.execute({
          contractAddress: wzecAddr,
          entrypoint: "mint",
          calldata: CallData.compile({ to: acc.address, amount: { low: "500000000", high: "0" } }), // 5 wZEC each
        });
        await deployerAccount.waitForTransaction(mintTx.transaction_hash);
        ok(`  User ${i + 1}: ${acc.address.slice(0, 16)}... → 5 wZEC`);
      }

      // Restore bridge
      const restoreTx = await deployerAccount.execute({
        contractAddress: wzecAddr,
        entrypoint: "set_bridge",
        calldata: CallData.compile({ bridge: bridgeAddr }),
      });
      await deployerAccount.waitForTransaction(restoreTx.transaction_hash);
    } catch (e: any) {
      warn("Extra account funding: " + (e?.message || "").slice(0, 100));
    }
  }

  // ── Phase 5: Final Relay Advancement ───────────────────────────────────
  header("Phase 5: Final Relay Advancement");
  info("Mining and relaying 10 more blocks for a healthy chain state...");
  await mineAndRelay(deployerAccount, relayAddr, provider, 10);
  stats.relayed += 10;

  // ── Phase 6: System State Summary ──────────────────────────────────────
  header("Simulation Summary");

  // Gather final stats
  const finalTip = Number(await relay.call("get_chain_tip"));
  const finalFinalized = Number(await relay.call("get_finalized_height"));
  const totalHeaders = Number(await relay.call("get_header_count"));
  const totalIssues = Number(await bridge.call("get_issue_count"));
  const totalRedeems = Number(await bridge.call("get_redeem_count"));
  const totalSupply = BigInt(String(await wzec.call("total_supply")));
  const activeVaults = Number(await pool.call("get_active_vault_count"));
  const poolCapacity = BigInt(String(await pool.call("get_pool_capacity")));
  const totalDeposited = BigInt(String(await pool.call("get_total_deposited")));
  const vaultCount = Number(await registry.call("get_vault_count"));

  console.log(`  ${C.bold}Bridge Protocol${C.reset}`);
  console.log(`  ├── Total Issues:     ${C.green}${totalIssues}${C.reset}`);
  console.log(`  ├── Total Redeems:    ${C.yellow}${totalRedeems}${C.reset}`);
  console.log(`  └── wZEC Supply:      ${C.cyan}${formatZec(totalSupply)}${C.reset}`);
  console.log();
  console.log(`  ${C.bold}Vault Registry${C.reset}`);
  console.log(`  ├── Registered:       ${vaultCount}`);
  console.log(`  ├── Active in Pool:   ${activeVaults}`);
  console.log(`  ├── Pool Capacity:    ${formatZec(poolCapacity)}`);
  console.log(`  └── Total Deposited:  ${formatZec(totalDeposited)}`);
  console.log();
  console.log(`  ${C.bold}Zcash Relay${C.reset}`);
  console.log(`  ├── Chain Tip:        #${finalTip}`);
  console.log(`  ├── Finalized:        #${finalFinalized}`);
  console.log(`  └── Total Headers:    ${totalHeaders}`);
  console.log();

  // Per-vault breakdown
  console.log(`  ${C.bold}Per-Vault Breakdown${C.reset}`);
  console.log(`  ┌──────┬──────────────────┬──────────────────┬──────────────────┬──────────┐`);
  console.log(`  │ ${C.bold}ID${C.reset}   │ ${C.bold}Collateral${C.reset}       │ ${C.bold}Issued${C.reset}           │ ${C.bold}Redeemed${C.reset}         │ ${C.bold}Status${C.reset}   │`);
  console.log(`  ├──────┼──────────────────┼──────────────────┼──────────────────┼──────────┤`);

  for (let vid = 0; vid < vaultCount; vid++) {
    try {
      const v: any = await registry.call("get_vault", [vid]);
      const collateral = BigInt(String(v[3]));
      const status = Number(v[4]);
      const issued = BigInt(String(v[8]));
      const redeemed = BigInt(String(v[9]));
      const statusLabels = ["Inactive", "Active", "Locked", "Suspnded", "Liquidtd"];
      const statusColors = [C.dim, C.green, C.yellow, C.yellow, C.red];
      const sLabel = statusLabels[status] ?? "Unknown";
      const sColor = statusColors[status] ?? C.dim;

      console.log(`  │ ${C.cyan}#${vid + 1}${C.reset}${vid + 1 < 10 ? " " : ""}  │ ${formatZec(collateral).padStart(16)} │ ${formatZec(issued).padStart(16)} │ ${formatZec(redeemed).padStart(16)} │ ${sColor}${sLabel.padEnd(8)}${C.reset} │`);
    } catch {
      console.log(`  │ ${C.cyan}#${vid + 1}${C.reset}${vid + 1 < 10 ? " " : ""}  │ ${C.dim}(error reading)${" ".repeat(2)}${C.reset} │ ${C.dim}—${" ".repeat(15)}${C.reset} │ ${C.dim}—${" ".repeat(15)}${C.reset} │ ${C.dim}—${" ".repeat(7)}${C.reset} │`);
    }
  }
  console.log(`  └──────┴──────────────────┴──────────────────┴──────────────────┴──────────┘`);
  console.log();

  console.log(`  ${C.bold}Simulation Stats${C.reset}`);
  console.log(`  ├── Issues simulated:  ${stats.issues}`);
  console.log(`  ├── Redeems simulated: ${stats.redeems}`);
  console.log(`  ├── Blocks relayed:    ${stats.relayed}`);
  console.log(`  └── Errors:            ${stats.errors}`);
  console.log();

  ok("Script 1 complete — system populated with activity history!");
}

main().catch((e) => {
  err(`Script 1 failed: ${e.message || e}`);
  process.exit(1);
});
