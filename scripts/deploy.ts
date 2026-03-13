#!/usr/bin/env node
// ============================================================================
// Zarklink — Contract Deployment Script (starknet.js)
// ============================================================================
// Declares and deploys all 6 Zarklink contracts to the local Starknet devnet.
// Uses starknet.js v9 to avoid starkli version incompatibilities.
//
// Usage:  npx tsx scripts/deploy.ts
//         npx tsx scripts/deploy.ts --build     # scarb build first
//         npx tsx scripts/deploy.ts --skip-config  # skip post-deploy invokes
// ============================================================================

import { RpcProvider, Account, json, CallData, shortString, hash, logger } from "starknet";
import * as fs from "fs";
import * as path from "path";

// Suppress starknet.js fee-estimation warnings on devnet
// ("Insufficient transaction data" — benign, devnet has too few txs for tip estimation)
logger.setLogLevel('ERROR');
import { execSync } from "child_process";

// ── Config ───────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONTRACTS_DIR = path.join(PROJECT_ROOT, "contracts");
const DATA_DIR = path.join(PROJECT_ROOT, ".devnet");
const ENV_FILE = path.join(PROJECT_ROOT, ".env.devnet");
const DEPLOYMENTS_FILE = path.join(DATA_DIR, "deployments.json");

const RPC_URL = process.env.STARKNET_RPC_URL || "http://127.0.0.1:5050";

// ── Colors ───────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function info(msg: string) { console.log(`${C.cyan}[INFO]${C.reset}  ${msg}`); }
function ok(msg: string) { console.log(`${C.green}[OK]${C.reset}    ${msg}`); }
function warn(msg: string) { console.log(`${C.yellow}[WARN]${C.reset}  ${msg}`); }
function err(msg: string) { console.log(`${C.red}[ERR]${C.reset}   ${msg}`); }
function header(msg: string) { console.log(`\n${C.bold}${C.blue}═══ ${msg} ═══${C.reset}\n`); }

// ── Helpers ──────────────────────────────────────────────────────────────────

function readArtifact(contractName: string): { sierra: object; casm: object } {
  const sierraPath = path.join(CONTRACTS_DIR, "target", "dev", `zarklink_${contractName}.contract_class.json`);
  const casmPath = path.join(CONTRACTS_DIR, "target", "dev", `zarklink_${contractName}.compiled_contract_class.json`);

  if (!fs.existsSync(sierraPath)) {
    throw new Error(`Sierra artifact not found: ${sierraPath}`);
  }
  if (!fs.existsSync(casmPath)) {
    throw new Error(`CASM artifact not found: ${casmPath}`);
  }

  return {
    sierra: json.parse(fs.readFileSync(sierraPath, "utf-8")),
    casm: json.parse(fs.readFileSync(casmPath, "utf-8")),
  };
}

async function declareAndDeploy(
  account: Account,
  contractName: string,
  constructorCalldata: (string | number | bigint)[],
  step: string,
): Promise<{ classHash: string; address: string }> {
  header(`${step} — ${contractName}`);

  const { sierra, casm } = readArtifact(contractName);

  // Declare
  info(`Declaring ${contractName}...`);
  let classHash: string;
  try {
    const declareResult = await account.declare({
      contract: sierra as any,
      casm: casm as any,
    });
    classHash = declareResult.class_hash;
    ok(`Declared: ${classHash}`);
    // Wait for tx
    await account.waitForTransaction(declareResult.transaction_hash);
  } catch (e: any) {
    const msg = e?.message || String(e);
    // Already declared — extract class hash
    if (msg.includes("already declared") || msg.includes("StarknetErrorCode.CLASS_ALREADY_DECLARED") || msg.includes("is already declared")) {
      classHash = hash.computeContractClassHash(sierra as any);
      ok(`Already declared: ${classHash}`);
    } else {
      err(`Failed to declare ${contractName}: ${msg}`);
      throw e;
    }
  }

  // Deploy
  info(`Deploying ${contractName}...`);
  const deployResult = await account.deploy({
    classHash,
    constructorCalldata: CallData.compile(constructorCalldata),
  });
  await account.waitForTransaction(deployResult.transaction_hash);
  const address = deployResult.contract_address[0] ?? deployResult.contract_address;
  ok(`Deployed ${contractName} at: ${address}`);

  return { classHash, address: String(address) };
}

async function invokeContract(
  account: Account,
  contractAddress: string,
  functionName: string,
  calldata: (string | number | bigint)[],
): Promise<void> {
  info(`  Invoking ${functionName} on ${contractAddress.slice(0, 12)}...`);
  try {
    const result = await account.execute({
      contractAddress,
      entrypoint: functionName,
      calldata: CallData.compile(calldata),
    });
    await account.waitForTransaction(result.transaction_hash);
    ok(`  ${functionName} called`);
  } catch (e: any) {
    warn(`  ${functionName} failed: ${e?.message?.slice(0, 120) || e}`);
  }
}

// ── Build ────────────────────────────────────────────────────────────────────

function buildContracts() {
  header("Building Cairo Contracts");
  info("Running scarb build...");
  execSync("scarb build", { cwd: CONTRACTS_DIR, stdio: "inherit" });
  ok("Contracts compiled successfully");
}

// ── Main Deploy ──────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const shouldBuild = args.includes("--build");
  const skipConfig = args.includes("--skip-config");

  if (shouldBuild) {
    buildContracts();
  }

  // ── Load deployer account ──────────────────────────────────────────────
  header("Setting Up Deployer");

  const accountsPath = path.join(DATA_DIR, "starknet-accounts.json");
  if (!fs.existsSync(accountsPath)) {
    err("No starknet accounts found. Run start-devnet.sh first.");
    process.exit(1);
  }

  const accounts = JSON.parse(fs.readFileSync(accountsPath, "utf-8"));
  const deployer = accounts[0];

  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const account = new Account({
    provider,
    address: deployer.address,
    signer: deployer.private_key,
  });

  info(`Deployer: ${deployer.address}`);
  info(`RPC: ${RPC_URL}`);

  // Verify connectivity
  try {
    const chainId = await provider.getChainId();
    ok(`Connected to chain: ${chainId}`);
  } catch (e) {
    err(`Cannot connect to ${RPC_URL}. Is starknet-devnet running?`);
    process.exit(1);
  }

  info("Deployment order:");
  console.log("  1. wZEC Token");
  console.log("  2. Oracle");
  console.log("  3. Vault Registry");
  console.log("  4. Zcash Relay");
  console.log("  5. Vault Pool");
  console.log("  6. Bridge Protocol");
  console.log("");

  // ── 1. wZEC Token ────────────────────────────────────────────────────────
  // constructor(owner: ContractAddress, bridge: ContractAddress)
  // Bridge not deployed yet — use deployer as placeholder, update after
  const wzec = await declareAndDeploy(account, "WzecToken", [
    deployer.address, // owner
    deployer.address, // bridge (placeholder)
  ], "1/6");

  // ── 2. Oracle ────────────────────────────────────────────────────────────
  // constructor(owner: ContractAddress, initial_rate: u256, max_deviation_bps: u256)
  const oracle = await declareAndDeploy(account, "Oracle", [
    deployer.address, // owner
    "100000000", "0", // initial_rate: 1 ZEC = 100_000_000 (u256 as low, high)
    "500", "0",       // max_deviation_bps: 5% (u256 as low, high)
  ], "2/6");

  // ── 3. Vault Registry ───────────────────────────────────────────────────
  // constructor(owner, collateral_token, standard_collateral_ratio, max_lock_amount, fee_rate)
  const registry = await declareAndDeploy(account, "VaultRegistry", [
    deployer.address,     // owner
    wzec.address,         // collateral_token
    "15000", "0",         // standard_collateral_ratio: 150% (u256)
    "1000000000", "0",    // max_lock_amount: 10 ZEC in zatoshi (u256)
    "30", "0",            // fee_rate: 30 bps = 0.3% (u256)
  ], "3/6");

  // ── 4. Zcash Relay ──────────────────────────────────────────────────────
  // constructor(owner: ContractAddress, finality_depth: u32)
  const relay = await declareAndDeploy(account, "ZcashRelay", [
    deployer.address, // owner
    6,                // finality_depth
  ], "4/6");

  // ── 5. Vault Pool ───────────────────────────────────────────────────────
  // constructor(owner, vault_registry, collateral_token)
  const pool = await declareAndDeploy(account, "VaultPool", [
    deployer.address,   // owner
    registry.address,   // vault_registry
    wzec.address,       // collateral_token
  ], "5/6");

  // ── 6. Bridge Protocol ───────────────────────────────────────────────────
  // constructor(owner, vault_registry, vault_pool, zcash_relay, wzec_token,
  //             mint_deadline, confirm_issue_deadline, confirm_redeem_deadline,
  //             fee_rate, warranty_amount)
  const bridge = await declareAndDeploy(account, "BridgeProtocol", [
    deployer.address,      // owner
    registry.address,      // vault_registry
    pool.address,          // vault_pool
    relay.address,         // zcash_relay
    wzec.address,          // wzec_token
    86400,                 // mint_deadline: 24h in seconds
    43200,                 // confirm_issue_deadline: 12h
    43200,                 // confirm_redeem_deadline: 12h
    "30", "0",             // fee_rate: 30 bps (u256)
    "10000000", "0",       // warranty_amount: 0.1 ZEC (u256)
  ], "6/6");

  // ── Post-deploy configuration ──────────────────────────────────────────
  if (!skipConfig) {
    header("Post-Deploy Configuration");

    // 1. Set bridge on wZEC Token (so bridge can mint/burn)
    await invokeContract(account, wzec.address, "set_bridge", [bridge.address]);

    // 2. Set bridge on vault registry
    await invokeContract(account, registry.address, "set_bridge_protocol", [bridge.address]);

    // 3. Set bridge on vault pool
    await invokeContract(account, pool.address, "set_bridge_protocol", [bridge.address]);

    // 4. Authorize deployer as relayer
    await invokeContract(account, relay.address, "authorize_relayer", [deployer.address]);

    ok("Post-deploy configuration complete");
  }

  // ── Save deployments ──────────────────────────────────────────────────
  header("Saving Deployment Addresses");

  const deployments = {
    network: "devnet",
    deployer: deployer.address,
    rpc_url: RPC_URL,
    timestamp: new Date().toISOString(),
    contracts: {
      wzec_token: { address: wzec.address, class_hash: wzec.classHash, name: "WzecToken" },
      oracle: { address: oracle.address, class_hash: oracle.classHash, name: "Oracle" },
      vault_registry: { address: registry.address, class_hash: registry.classHash, name: "VaultRegistry" },
      zcash_relay: { address: relay.address, class_hash: relay.classHash, name: "ZcashRelay" },
      bridge_protocol: { address: bridge.address, class_hash: bridge.classHash, name: "BridgeProtocol" },
      vault_pool: { address: pool.address, class_hash: pool.classHash, name: "VaultPool" },
    },
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
  ok(`Deployments saved to ${DEPLOYMENTS_FILE}`);

  // ── Update .env.devnet ─────────────────────────────────────────────────
  header("Updating .env.devnet");

  if (fs.existsSync(ENV_FILE)) {
    let env = fs.readFileSync(ENV_FILE, "utf-8");
    // Remove old contract address lines (all known naming conventions)
    const stripKeys = [
      "WZEC_TOKEN_ADDRESS", "ORACLE_ADDRESS", "VAULT_REGISTRY_ADDRESS",
      "ZCASH_RELAY_ADDRESS", "BRIDGE_PROTOCOL_ADDRESS", "VAULT_POOL_ADDRESS",
      "WZEC_TOKEN_CONTRACT", "ORACLE_CONTRACT", "VAULT_REGISTRY_CONTRACT",
      "ZCASH_RELAY_CONTRACT", "BRIDGE_PROTOCOL_CONTRACT", "VAULT_POOL_CONTRACT",
      "NEXT_PUBLIC_BRIDGE_ADDRESS", "NEXT_PUBLIC_REGISTRY_ADDRESS",
      "NEXT_PUBLIC_POOL_ADDRESS", "NEXT_PUBLIC_RELAY_ADDRESS",
      "NEXT_PUBLIC_WZEC_ADDRESS", "NEXT_PUBLIC_ORACLE_ADDRESS",
    ];
    for (const key of stripKeys) {
      env = env.replace(new RegExp(`^${key}=.*$\\n?`, "gm"), "");
    }
    // Remove old headers if present
    env = env.replace(/\n# ── Deployed Contract Addresses.*\n/g, "\n");

    env += `
# ── Deployed Contract Addresses (auto-generated by deploy.ts) ──
NEXT_PUBLIC_BRIDGE_ADDRESS=${bridge.address}
NEXT_PUBLIC_REGISTRY_ADDRESS=${registry.address}
NEXT_PUBLIC_POOL_ADDRESS=${pool.address}
NEXT_PUBLIC_RELAY_ADDRESS=${relay.address}
NEXT_PUBLIC_WZEC_ADDRESS=${wzec.address}
NEXT_PUBLIC_ORACLE_ADDRESS=${oracle.address}

# ── Service-compatible aliases (used by relayer & vault-daemon) ──
WZEC_TOKEN_CONTRACT=${wzec.address}
ORACLE_CONTRACT=${oracle.address}
VAULT_REGISTRY_CONTRACT=${registry.address}
ZCASH_RELAY_CONTRACT=${relay.address}
BRIDGE_PROTOCOL_CONTRACT=${bridge.address}
VAULT_POOL_CONTRACT=${pool.address}
`;
    fs.writeFileSync(ENV_FILE, env);
    ok(`.env.devnet updated with contract addresses`);
  } else {
    warn(`.env.devnet not found — skipping`);
  }

  // ── Summary ────────────────────────────────────────────────────────────
  header("Deployment Summary");
  console.log(`  ${C.bold}wZEC Token:${C.reset}       ${wzec.address}`);
  console.log(`  ${C.bold}Oracle:${C.reset}           ${oracle.address}`);
  console.log(`  ${C.bold}Vault Registry:${C.reset}   ${registry.address}`);
  console.log(`  ${C.bold}Zcash Relay:${C.reset}      ${relay.address}`);
  console.log(`  ${C.bold}Bridge Protocol:${C.reset}  ${bridge.address}`);
  console.log(`  ${C.bold}Vault Pool:${C.reset}       ${pool.address}`);
  console.log("");
  ok("All contracts deployed and configured!");
}

main().catch((e) => {
  err(`Deployment failed: ${e.message || e}`);
  process.exit(1);
});
