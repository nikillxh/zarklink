#!/usr/bin/env node
// ============================================================================
// Zarklink — Script 0: Enhanced Devnet Setup
// ============================================================================
// Sets up 8 vaults with varying collateral (showing different vault "power"),
// funds user accounts with wZEC, seeds the relay with Zcash headers, and
// displays a comprehensive summary of the devnet state.
//
// Usage:  npx tsx scripts/devscript0-setup.ts
//         (Assumes chains are running + contracts deployed + .env.devnet populated)
// ============================================================================

import { RpcProvider, Account, Contract, CallData, logger } from "starknet";
import * as fs from "fs";
import * as path from "path";

// Suppress harmless fee-estimation warnings on devnet
logger.setLogLevel("ERROR");

// ── Config ───────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, ".devnet");
const ENV_FILE = path.join(PROJECT_ROOT, ".env.devnet");

const ZCASH_RPC_URL = process.env.ZCASH_RPC_URL ?? "http://127.0.0.1:18232";
const ZCASH_RPC_USER = process.env.ZCASH_RPC_USER ?? "zarklink";
const ZCASH_RPC_PASS = process.env.ZCASH_RPC_PASS ?? "";
const STARKNET_RPC_URL = process.env.STARKNET_RPC_URL ?? "http://127.0.0.1:5050";

// Varying collateral amounts per vault (in ZEC) — demonstrates vault "power"
const VAULT_COLLATERAL_ZEC = [20, 15, 10, 10, 5, 5, 2, 1]; // 8 vaults
const ISSUER_WZEC = 50_00000000; // 50 wZEC in zatoshi for issuer
const REDEEMER_WZEC = 25_00000000; // 25 wZEC in zatoshi for redeemer
const RELAY_SEED_HEADERS = 30; // Number of headers to seed into relay

// ── Colors ───────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m", magenta: "\x1b[35m",
  dim: "\x1b[2m",
};

function info(msg: string) { console.log(`${C.cyan}[SCRIPT0]${C.reset} ${msg}`); }
function ok(msg: string) { console.log(`${C.green}[SCRIPT0]${C.reset} ${msg}`); }
function warn(msg: string) { console.log(`${C.yellow}[SCRIPT0]${C.reset} ${msg}`); }
function err(msg: string) { console.log(`${C.red}[SCRIPT0]${C.reset} ${msg}`); }
function header(msg: string) { console.log(`\n${C.bold}${C.blue}═══ ${msg} ═══${C.reset}\n`); }

// ── Zcash RPC ────────────────────────────────────────────────────────────────

async function zcashRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const auth = Buffer.from(`${ZCASH_RPC_USER}:${ZCASH_RPC_PASS}`).toString("base64");
  const res = await fetch(ZCASH_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: "1.0", id: "script0", method, params }),
  });
  if (!res.ok) throw new Error(`zcashd RPC ${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? `RPC error in ${method}`);
  return json.result;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  header("Script 0 — Enhanced Devnet Setup");

  // ── Load data ──────────────────────────────────────────────────────────
  const deployments = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "deployments.json"), "utf-8"));
  const starknetAccounts = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "starknet-accounts.json"), "utf-8"));

  const NUM_VAULTS = Math.min(VAULT_COLLATERAL_ZEC.length, starknetAccounts.length - 5);
  const ISSUER_INDEX = NUM_VAULTS + 1;
  const REDEEMER_INDEX = NUM_VAULTS + 2;
  const RELAYER_INDEX = NUM_VAULTS + 3;

  const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });
  const deployer = starknetAccounts[0];
  const deployerAccount = new Account({ provider, address: deployer.address, signer: deployer.private_key });

  const registryAddr = deployments.contracts.vault_registry.address;
  const poolAddr = deployments.contracts.vault_pool.address;
  const wzecAddr = deployments.contracts.wzec_token.address;
  const bridgeAddr = deployments.contracts.bridge_protocol.address;
  const relayAddr = deployments.contracts.zcash_relay.address;

  info(`Deployer: ${deployer.address.slice(0, 16)}...`);
  info(`Registry: ${registryAddr.slice(0, 16)}...`);
  info(`Relay:    ${relayAddr.slice(0, 16)}...`);
  info(`Vaults:   ${NUM_VAULTS} (collateral: ${VAULT_COLLATERAL_ZEC.slice(0, NUM_VAULTS).join(", ")} ZEC)`);

  // ── Phase 1: Register Vaults with Varying Collateral ──────────────────
  header("Phase 1: Register Vaults with Varying Collateral");

  // Grant deployer temporary mint authority
  info("Granting deployer temporary mint authority...");
  try {
    const tx = await deployerAccount.execute({
      contractAddress: wzecAddr,
      entrypoint: "set_bridge",
      calldata: CallData.compile({ bridge: deployer.address }),
    });
    await deployerAccount.waitForTransaction(tx.transaction_hash);
    ok("Deployer is now temporary bridge (can mint)");
  } catch (e: any) {
    warn("Could not set_bridge: " + (e?.message || "").slice(0, 120));
  }

  const vaultResults: { id: number; collateral: number; address: string; status: string }[] = [];

  for (let i = 0; i < NUM_VAULTS; i++) {
    const vaultIndex = i + 1; // accounts[1..N] are vault operators
    const vaultOp = starknetAccounts[vaultIndex];
    if (!vaultOp) { err(`Vault ${vaultIndex}: account not found`); continue; }

    const collateralZec = VAULT_COLLATERAL_ZEC[i];
    const collateralZatoshi = String(Math.round(collateralZec * 1e8));
    const vaultAccount = new Account({ provider, address: vaultOp.address, signer: vaultOp.private_key });
    const tag = `[Vault #${vaultIndex}]`;

    info(`${tag} Collateral: ${collateralZec} ZEC → ${vaultOp.address.slice(0, 16)}...`);

    // 1. Register vault
    try {
      const regTx = await vaultAccount.execute({
        contractAddress: registryAddr,
        entrypoint: "register_vault",
        calldata: CallData.compile({
          zcash_addr_d: "0x" + (BigInt("0x1234567890abcdef") + BigInt(vaultIndex)).toString(16),
          zcash_addr_pkd: "0x" + (BigInt("0xfedcba0987654321") + BigInt(vaultIndex)).toString(16),
        }),
      });
      await vaultAccount.waitForTransaction(regTx.transaction_hash);
      ok(`${tag} Registered`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("already registered") || msg.includes("VAULT_ALREADY_EXISTS")) {
        ok(`${tag} Already registered (skipping)`);
      } else {
        err(`${tag} register_vault failed: ${msg.slice(0, 150)}`);
        vaultResults.push({ id: vaultIndex, collateral: collateralZec, address: vaultOp.address, status: "FAILED" });
        continue;
      }
    }

    // 2. Mint wZEC for collateral
    try {
      const mintTx = await deployerAccount.execute({
        contractAddress: wzecAddr,
        entrypoint: "mint",
        calldata: CallData.compile({ to: vaultOp.address, amount: { low: collateralZatoshi, high: "0" } }),
      });
      await deployerAccount.waitForTransaction(mintTx.transaction_hash);
    } catch (e: any) {
      err(`${tag} Mint failed: ${(e?.message || "").slice(0, 120)}`);
    }

    // 3. Approve VaultPool
    try {
      const appTx = await vaultAccount.execute({
        contractAddress: wzecAddr,
        entrypoint: "approve",
        calldata: CallData.compile({ spender: poolAddr, amount: { low: collateralZatoshi, high: "0" } }),
      });
      await vaultAccount.waitForTransaction(appTx.transaction_hash);
    } catch (e: any) {
      err(`${tag} Approve failed: ${(e?.message || "").slice(0, 100)}`);
    }

    // 4. Deposit to VaultRegistry
    try {
      const depRegTx = await vaultAccount.execute({
        contractAddress: registryAddr,
        entrypoint: "deposit_collateral",
        calldata: CallData.compile({ amount: { low: collateralZatoshi, high: "0" } }),
      });
      await vaultAccount.waitForTransaction(depRegTx.transaction_hash);
    } catch (e: any) {
      err(`${tag} Registry deposit failed: ${(e?.message || "").slice(0, 100)}`);
    }

    // 5. Deposit to VaultPool
    try {
      const depPoolTx = await vaultAccount.execute({
        contractAddress: poolAddr,
        entrypoint: "deposit_collateral",
        calldata: CallData.compile({ amount: { low: collateralZatoshi, high: "0" } }),
      });
      await vaultAccount.waitForTransaction(depPoolTx.transaction_hash);
    } catch (e: any) {
      err(`${tag} Pool deposit failed: ${(e?.message || "").slice(0, 100)}`);
    }

    ok(`${tag} Ready — ${collateralZec} ZEC locked`);
    vaultResults.push({ id: vaultIndex, collateral: collateralZec, address: vaultOp.address, status: "Active" });
  }

  // ── Phase 2: Fund User Accounts with wZEC ─────────────────────────────
  header("Phase 2: Fund User Accounts with wZEC");

  // Mint wZEC to Issuer
  const issuer = starknetAccounts[ISSUER_INDEX];
  if (issuer) {
    try {
      info(`Minting ${ISSUER_WZEC / 1e8} wZEC to Issuer (Alice) — ${issuer.address.slice(0, 16)}...`);
      const tx = await deployerAccount.execute({
        contractAddress: wzecAddr,
        entrypoint: "mint",
        calldata: CallData.compile({ to: issuer.address, amount: { low: String(ISSUER_WZEC), high: "0" } }),
      });
      await deployerAccount.waitForTransaction(tx.transaction_hash);
      ok(`Issuer funded with ${ISSUER_WZEC / 1e8} wZEC`);
    } catch (e: any) {
      err(`Issuer mint failed: ${(e?.message || "").slice(0, 120)}`);
    }
  }

  // Mint wZEC to Redeemer
  const redeemer = starknetAccounts[REDEEMER_INDEX];
  if (redeemer) {
    try {
      info(`Minting ${REDEEMER_WZEC / 1e8} wZEC to Redeemer (Dave) — ${redeemer.address.slice(0, 16)}...`);
      const tx = await deployerAccount.execute({
        contractAddress: wzecAddr,
        entrypoint: "mint",
        calldata: CallData.compile({ to: redeemer.address, amount: { low: String(REDEEMER_WZEC), high: "0" } }),
      });
      await deployerAccount.waitForTransaction(tx.transaction_hash);
      ok(`Redeemer funded with ${REDEEMER_WZEC / 1e8} wZEC`);
    } catch (e: any) {
      err(`Redeemer mint failed: ${(e?.message || "").slice(0, 120)}`);
    }
  }

  // Restore bridge authority
  info("Restoring bridge authority to BridgeProtocol...");
  try {
    const tx = await deployerAccount.execute({
      contractAddress: wzecAddr,
      entrypoint: "set_bridge",
      calldata: CallData.compile({ bridge: bridgeAddr }),
    });
    await deployerAccount.waitForTransaction(tx.transaction_hash);
    ok(`Bridge authority restored to ${bridgeAddr.slice(0, 16)}...`);
  } catch (e: any) {
    err("CRITICAL: Failed to restore bridge! " + (e?.message || "").slice(0, 120));
  }

  // ── Phase 3: Authorize Relayer Account ─────────────────────────────────
  header("Phase 3: Authorize Relayer");

  const relayerAcct = starknetAccounts[RELAYER_INDEX];
  if (relayerAcct) {
    try {
      info(`Authorizing relayer: ${relayerAcct.address.slice(0, 16)}...`);
      const tx = await deployerAccount.execute({
        contractAddress: relayAddr,
        entrypoint: "authorize_relayer",
        calldata: CallData.compile({ relayer: relayerAcct.address }),
      });
      await deployerAccount.waitForTransaction(tx.transaction_hash);
      ok("Relayer account authorized");
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("already") || msg.includes("authorized")) {
        ok("Relayer already authorized");
      } else {
        warn("Authorize relayer: " + msg.slice(0, 120));
      }
    }
    // Also keep deployer authorized (belt and suspenders)
    try {
      await deployerAccount.execute({
        contractAddress: relayAddr,
        entrypoint: "authorize_relayer",
        calldata: CallData.compile({ relayer: deployer.address }),
      });
    } catch { /* already authorized from deploy.ts */ }
  }

  // ── Phase 4: Seed Relay with Zcash Headers ────────────────────────────
  header("Phase 4: Seed Relay with Zcash Block Headers");

  // Mine extra blocks to ensure we have enough for relay finality
  info("Mining Zcash blocks for relay headers...");
  try {
    await zcashRpc("generate", [RELAY_SEED_HEADERS + 10]);
    const blockCount = await zcashRpc("getblockcount") as number;
    ok(`Zcash chain tip: ${blockCount}`);
  } catch (e: any) {
    warn("Block mining: " + (e?.message || "").slice(0, 100));
  }

  // Use deployer (authorized relayer) to submit headers
  info(`Submitting ${RELAY_SEED_HEADERS} headers to relay contract...`);

  const RELAY_ABI = [
    { type: "function", name: "get_chain_tip", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
    { type: "function", name: "get_finalized_height", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
    { type: "function", name: "get_header_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
    { type: "function", name: "submit_header", inputs: [{ name: "header", type: "(core::integer::u32, core::felt252, core::felt252, core::felt252, core::integer::u32, core::integer::u32, core::felt252, core::integer::u32)" }], outputs: [], state_mutability: "external" },
  ];

  const relay = new Contract({ abi: RELAY_ABI, address: relayAddr, providerOrAccount: deployerAccount });
  const currentTip = Number(await relay.call("get_chain_tip"));
  const startHeight = currentTip + 1;
  info(`Relay tip: ${currentTip}, starting from block ${startHeight}`);

  let submitted = 0;
  let skipped = 0;
  for (let h = startHeight; h < startHeight + RELAY_SEED_HEADERS; h++) {
    try {
      const hash = await zcashRpc("getblockhash", [h]) as string;
      const hdr = await zcashRpc("getblockheader", [hash]) as Record<string, unknown>;

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

      const tx = await deployerAccount.execute({
        contractAddress: relayAddr,
        entrypoint: "submit_header",
        calldata: CallData.compile({ header: cairoHeader }),
      });
      await provider.waitForTransaction(tx.transaction_hash);
      submitted++;
      if (submitted % 10 === 0) info(`  Submitted ${submitted} headers...`);
    } catch {
      skipped++;
    }
  }

  const newTip = Number(await relay.call("get_chain_tip"));
  const newFinalized = Number(await relay.call("get_finalized_height"));
  const headerCount = Number(await relay.call("get_header_count"));
  ok(`Relay seeded: ${submitted} submitted, ${skipped} skipped → tip=${newTip}, finalized=${newFinalized}, total=${headerCount}`);

  // ── Phase 5: Summary ──────────────────────────────────────────────────
  header("Setup Summary");

  const totalCollateral = VAULT_COLLATERAL_ZEC.slice(0, NUM_VAULTS).reduce((a, b) => a + b, 0);
  const maxCollateral = Math.max(...VAULT_COLLATERAL_ZEC.slice(0, NUM_VAULTS));

  console.log(`  ${C.bold}Vault Registry${C.reset}`);
  console.log(`  ┌──────┬────────────────┬──────────────────┬──────────┐`);
  console.log(`  │ ${C.bold}ID${C.reset}   │ ${C.bold}Collateral${C.reset}     │ ${C.bold}Pool Share${C.reset}       │ ${C.bold}Status${C.reset}   │`);
  console.log(`  ├──────┼────────────────┼──────────────────┼──────────┤`);

  for (const v of vaultResults) {
    const pct = ((v.collateral / totalCollateral) * 100).toFixed(2);
    const bar = "█".repeat(Math.round((v.collateral / maxCollateral) * 12));
    const pad = " ".repeat(12 - bar.length);
    const statusColor = v.status === "Active" ? C.green : C.red;
    console.log(`  │ ${C.cyan}#${v.id}${C.reset}${v.id < 10 ? " " : ""}  │ ${String(v.collateral).padStart(5)} ZEC${" ".repeat(5)} │ ${C.magenta}${bar}${pad}${C.reset} ${pct.padStart(6)}% │ ${statusColor}${v.status.padEnd(8)}${C.reset} │`);
  }
  console.log(`  └──────┴────────────────┴──────────────────┴──────────┘`);
  console.log(`  ${C.dim}Total collateral: ${totalCollateral} ZEC across ${NUM_VAULTS} vaults${C.reset}`);
  console.log();

  console.log(`  ${C.bold}User Accounts${C.reset}`);
  console.log(`  • Issuer (Alice)   — ${ISSUER_WZEC / 1e8} wZEC funded`);
  console.log(`  • Redeemer (Dave)  — ${REDEEMER_WZEC / 1e8} wZEC funded`);
  console.log();

  console.log(`  ${C.bold}Zcash Relay${C.reset}`);
  console.log(`  • Chain tip:       #${newTip}`);
  console.log(`  • Finalized:       #${newFinalized}`);
  console.log(`  • Total headers:   ${headerCount}`);
  console.log();

  ok("Script 0 complete — devnet is fully set up!");
}

main().catch((e) => {
  err(`Script 0 failed: ${e.message || e}`);
  process.exit(1);
});
