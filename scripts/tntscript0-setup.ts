#!/usr/bin/env node
// ============================================================================
// Zarklink — Testnet Script 0: Vault Setup (Starknet Sepolia)
// ============================================================================
// Sets up a single vault (the deployer) on Starknet Sepolia testnet.
// Unlike devnet, the user only controls their own account — there are no
// pre-funded devnet accounts.
//
// Prerequisites:
//   - Contracts deployed via deploy-sepolia.ts
//   - .env.sepolia and .sepolia/deployments.json exist
//   - Deployer account funded with STRK on Sepolia
//
// Usage:  npx tsx scripts/tntscript0-setup.ts
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

// Also load frontend/.env.testnet for contract addresses if .env.sepolia doesn't have them
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

// Vault collateral (TAZ, in whole units — 1 TAZ for a minimal testnet vault)
const VAULT_COLLATERAL_TAZ = 1;
// wTAZ to mint for the deployer (acting as issuer) — 5 wTAZ
const DEPLOYER_WZEC = 5_00000000;

// ── Colors ───────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", cyan: "\x1b[36m", magenta: "\x1b[35m",
  dim: "\x1b[2m",
};

function info(msg: string) { console.log(`${C.cyan}[TNT-S0]${C.reset} ${msg}`); }
function ok(msg: string) { console.log(`${C.green}[TNT-S0]${C.reset} ${msg}`); }
function warn(msg: string) { console.log(`${C.yellow}[TNT-S0]${C.reset} ${msg}`); }
function err(msg: string) { console.log(`${C.red}[TNT-S0]${C.reset} ${msg}`); }
function header(msg: string) { console.log(`\n${C.bold}${C.blue}═══ ${msg} ═══${C.reset}\n`); }

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  header("Testnet Script 0 — Vault Setup (Sepolia)");

  // ── Validate ──────────────────────────────────────────────────────────
  if (!DEPLOYER_ADDRESS || !DEPLOYER_KEY) {
    err("Missing DEPLOYER_ADDRESS and/or DEPLOYER_PRIVATE_KEY.");
    console.log(`
Set these in .env.sepolia:
  DEPLOYER_ADDRESS=0x...
  DEPLOYER_PRIVATE_KEY=0x...

Or run: npx tsx scripts/create-sepolia-account.ts
`);
    process.exit(1);
  }

  // ── Load deployments ──────────────────────────────────────────────────
  if (!fs.existsSync(DEPLOYMENTS_FILE)) {
    err(`Deployments not found at ${DEPLOYMENTS_FILE}`);
    console.log("Run deploy-sepolia.ts first: npx tsx scripts/deploy-sepolia.ts");
    process.exit(1);
  }

  const deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_FILE, "utf-8"));
  const registryAddr = deployments.contracts.vault_registry.address;
  const poolAddr = deployments.contracts.vault_pool.address;
  const wzecAddr = deployments.contracts.wzec_token.address;
  const bridgeAddr = deployments.contracts.bridge_protocol.address;
  const relayAddr = deployments.contracts.zcash_relay.address;

  const provider = new RpcProvider({ nodeUrl: STARKNET_RPC_URL });
  const deployerAccount = new Account({ provider, address: DEPLOYER_ADDRESS, signer: DEPLOYER_KEY });

  info(`Deployer:     ${DEPLOYER_ADDRESS.slice(0, 20)}...`);
  info(`RPC:          ${STARKNET_RPC_URL}`);
  info(`Registry:     ${registryAddr.slice(0, 20)}...`);
  info(`Bridge:       ${bridgeAddr.slice(0, 20)}...`);

  // ── Check connectivity ────────────────────────────────────────────────
  try {
    const chainId = await provider.getChainId();
    ok(`Connected to chain: ${chainId}`);
  } catch (e) {
    err(`Cannot connect to ${STARKNET_RPC_URL}`);
    process.exit(1);
  }

  // ── Check STRK balance ────────────────────────────────────────────────
  const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
  try {
    const result = await provider.callContract({
      contractAddress: STRK_TOKEN,
      entrypoint: "balanceOf",
      calldata: [DEPLOYER_ADDRESS],
    });
    const balLow = BigInt(result[0] || "0");
    const balHigh = BigInt(result[1] || "0");
    const balance = balLow + (balHigh << 128n);
    const strkBal = Number(balance) / 1e18;
    info(`STRK balance: ${strkBal.toFixed(6)} STRK`);
    if (strkBal < 0.5) {
      warn("Low STRK balance — transactions may fail. Fund at https://starknet-faucet.vercel.app/");
    }
  } catch (e: any) {
    warn(`Could not check STRK balance: ${e.message?.slice(0, 100)}`);
  }

  const TX_WAIT_OPTS = { retryInterval: 5000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] as any };

  // ── Phase 1: Register Deployer as Vault Operator ──────────────────────
  header("Phase 1: Register Vault (Deployer)");

  const collateralZatoshi = String(Math.round(VAULT_COLLATERAL_TAZ * 1e8));

  // 1a. Grant deployer temporary mint authority
  info("Granting deployer temporary mint authority...");
  try {
    const tx = await deployerAccount.execute({
      contractAddress: wzecAddr,
      entrypoint: "set_bridge",
      calldata: CallData.compile({ bridge: DEPLOYER_ADDRESS }),
    });
    await deployerAccount.waitForTransaction(tx.transaction_hash, TX_WAIT_OPTS);
    ok("Deployer is now temporary bridge (can mint)");
  } catch (e: any) {
    warn("set_bridge: " + (e?.message || "").slice(0, 120));
  }

  // 1b. Register vault
  info("Registering deployer as vault operator...");
  try {
    const regTx = await deployerAccount.execute({
      contractAddress: registryAddr,
      entrypoint: "register_vault",
      calldata: CallData.compile({
        zcash_addr_d: "0x1234567890abcdf0",
        zcash_addr_pkd: "0xfedcba0987654322",
      }),
    });
    await deployerAccount.waitForTransaction(regTx.transaction_hash, TX_WAIT_OPTS);
    ok("Vault registered");
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg.includes("already registered") || msg.includes("VAULT_ALREADY_EXISTS")) {
      ok("Vault already registered (skipping)");
    } else {
      err("register_vault failed: " + msg.slice(0, 150));
      // Continue — it may still work if already registered
    }
  }

  // 1c. Mint wTAZ for collateral
  info(`Minting ${VAULT_COLLATERAL_TAZ} wTAZ for vault collateral...`);
  try {
    const mintTx = await deployerAccount.execute({
      contractAddress: wzecAddr,
      entrypoint: "mint",
      calldata: CallData.compile({ to: DEPLOYER_ADDRESS, amount: { low: collateralZatoshi, high: "0" } }),
    });
    await deployerAccount.waitForTransaction(mintTx.transaction_hash, TX_WAIT_OPTS);
    ok(`Minted ${VAULT_COLLATERAL_TAZ} wTAZ`);
  } catch (e: any) {
    err("Mint failed: " + (e?.message || "").slice(0, 120));
  }

  // 1d. Approve VaultPool to spend wTAZ
  info("Approving VaultPool...");
  try {
    const appTx = await deployerAccount.execute({
      contractAddress: wzecAddr,
      entrypoint: "approve",
      calldata: CallData.compile({ spender: poolAddr, amount: { low: collateralZatoshi, high: "0" } }),
    });
    await deployerAccount.waitForTransaction(appTx.transaction_hash, TX_WAIT_OPTS);
    ok("Approved");
  } catch (e: any) {
    err("Approve failed: " + (e?.message || "").slice(0, 100));
  }

  // 1e. Deposit to VaultRegistry
  info("Depositing collateral to VaultRegistry...");
  try {
    const depTx = await deployerAccount.execute({
      contractAddress: registryAddr,
      entrypoint: "deposit_collateral",
      calldata: CallData.compile({ amount: { low: collateralZatoshi, high: "0" } }),
    });
    await deployerAccount.waitForTransaction(depTx.transaction_hash, TX_WAIT_OPTS);
    ok("Registry deposit complete");
  } catch (e: any) {
    err("Registry deposit failed: " + (e?.message || "").slice(0, 100));
  }

  // 1f. Deposit to VaultPool
  info("Depositing collateral to VaultPool...");
  try {
    const depPoolTx = await deployerAccount.execute({
      contractAddress: poolAddr,
      entrypoint: "deposit_collateral",
      calldata: CallData.compile({ amount: { low: collateralZatoshi, high: "0" } }),
    });
    await deployerAccount.waitForTransaction(depPoolTx.transaction_hash, TX_WAIT_OPTS);
    ok("Pool deposit complete");
  } catch (e: any) {
    err("Pool deposit failed: " + (e?.message || "").slice(0, 100));
  }

  ok(`Vault ready — ${VAULT_COLLATERAL_TAZ} TAZ locked`);

  // ── Phase 2: Mint wTAZ for Deployer (as Issuer) ───────────────────────
  header("Phase 2: Fund Deployer with wTAZ (for Issue testing)");

  info(`Minting ${DEPLOYER_WZEC / 1e8} wTAZ to deployer...`);
  try {
    const tx = await deployerAccount.execute({
      contractAddress: wzecAddr,
      entrypoint: "mint",
      calldata: CallData.compile({ to: DEPLOYER_ADDRESS, amount: { low: String(DEPLOYER_WZEC), high: "0" } }),
    });
    await deployerAccount.waitForTransaction(tx.transaction_hash, TX_WAIT_OPTS);
    ok(`Deployer funded with ${DEPLOYER_WZEC / 1e8} wTAZ`);
  } catch (e: any) {
    err("Mint failed: " + (e?.message || "").slice(0, 120));
  }

  // ── Phase 3: Restore Bridge Authority ──────────────────────────────────
  header("Phase 3: Restore Bridge Authority");

  info("Restoring bridge authority to BridgeProtocol...");
  try {
    const tx = await deployerAccount.execute({
      contractAddress: wzecAddr,
      entrypoint: "set_bridge",
      calldata: CallData.compile({ bridge: bridgeAddr }),
    });
    await deployerAccount.waitForTransaction(tx.transaction_hash, TX_WAIT_OPTS);
    ok(`Bridge authority restored to ${bridgeAddr.slice(0, 20)}...`);
  } catch (e: any) {
    err("CRITICAL: Failed to restore bridge! " + (e?.message || "").slice(0, 120));
  }

  // ── Phase 4: Authorize Deployer as Relayer ─────────────────────────────
  header("Phase 4: Authorize Relayer");

  info("Authorizing deployer as relayer...");
  try {
    const tx = await deployerAccount.execute({
      contractAddress: relayAddr,
      entrypoint: "authorize_relayer",
      calldata: CallData.compile({ relayer: DEPLOYER_ADDRESS }),
    });
    await deployerAccount.waitForTransaction(tx.transaction_hash, TX_WAIT_OPTS);
    ok("Deployer authorized as relayer");
  } catch (e: any) {
    const msg = e?.message || "";
    if (msg.includes("already") || msg.includes("authorized")) {
      ok("Deployer already authorized as relayer");
    } else {
      warn("Authorize relayer: " + msg.slice(0, 120));
    }
  }

  // ── Phase 5: Summary ──────────────────────────────────────────────────
  header("Testnet Setup Summary");

  // Read final state
  const REGISTRY_ABI = [
    { type: "function", name: "get_vault_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
    { type: "function", name: "get_vault", inputs: [{ name: "vault_id", type: "core::integer::u32" }], outputs: [{ type: "core::starknet::contract_address::ContractAddress" }, { type: "core::felt252" }, { type: "core::felt252" }, { type: "core::integer::u256" }, { type: "core::integer::u8" }, { type: "core::integer::u64" }, { type: "core::integer::u64" }, { type: "core::integer::u64" }, { type: "core::integer::u256" }, { type: "core::integer::u256" }], state_mutability: "view" },
  ];
  const WZEC_ABI = [
    { type: "function", name: "balance_of", inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  ];
  const RELAY_ABI = [
    { type: "function", name: "get_chain_tip", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
    { type: "function", name: "get_header_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  ];

  try {
    const registry = new Contract({ abi: REGISTRY_ABI, address: registryAddr, providerOrAccount: provider });
    const wzec = new Contract({ abi: WZEC_ABI, address: wzecAddr, providerOrAccount: provider });
    const relay = new Contract({ abi: RELAY_ABI, address: relayAddr, providerOrAccount: provider });

    const vaultCount = Number(await registry.call("get_vault_count"));
    const balance = BigInt(String(await wzec.call("balance_of", [DEPLOYER_ADDRESS])));
    const relayTip = Number(await relay.call("get_chain_tip"));
    const headerCount = Number(await relay.call("get_header_count"));

    console.log(`  ${C.bold}Vault Registry${C.reset}`);
    console.log(`  ├── Vault count:       ${vaultCount}`);
    console.log(`  └── Collateral locked: ${VAULT_COLLATERAL_TAZ} TAZ`);
    console.log();
    console.log(`  ${C.bold}Deployer Account${C.reset}`);
    console.log(`  ├── Address:  ${DEPLOYER_ADDRESS}`);
    console.log(`  └── wTAZ:     ${(Number(balance) / 1e8).toFixed(8)} wTAZ`);
    console.log();
    console.log(`  ${C.bold}Zcash Relay${C.reset}`);
    console.log(`  ├── Chain tip:     #${relayTip}`);
    console.log(`  └── Total headers: ${headerCount}`);
    console.log();
  } catch (e: any) {
    warn("Could not read final state: " + (e?.message || "").slice(0, 100));
  }

  console.log(`  ${C.bold}Next Steps${C.reset}`);
  console.log(`  1. Get TAZ from a Zcash testnet faucet`);
  console.log(`  2. Associate your Zcash address on the /account page`);
  console.log(`  3. Run tntscript1-simulate.ts for an Issue walkthrough`);
  console.log(`  4. Or use the bridge UI at http://localhost:3000/bridge`);
  console.log();

  ok("Testnet Script 0 complete — vault is set up on Sepolia!");
}

main().catch((e) => {
  err(`Testnet Script 0 failed: ${e.message || e}`);
  process.exit(1);
});
