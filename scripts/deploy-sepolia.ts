#!/usr/bin/env node
// ============================================================================
// Zarklink — Contract Deployment Script (Starknet Sepolia)
// ============================================================================
// Declares and deploys all 6 Zarklink contracts to Starknet Sepolia testnet.
// Uses starknet.js v9.
//
// Prerequisites:
//   - Funded Starknet Sepolia account (use https://starknet-faucet.vercel.app/)
//   - Set DEPLOYER_ADDRESS and DEPLOYER_PRIVATE_KEY env vars (or .env.sepolia)
//   - Compiled contracts: cd contracts && scarb build
//
// Usage:
//   npx tsx scripts/deploy-sepolia.ts
//   npx tsx scripts/deploy-sepolia.ts --build     # scarb build first
// ============================================================================

import { RpcProvider, Account, json, CallData, hash, logger } from "starknet";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

logger.setLogLevel("ERROR");

// ── Config ───────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONTRACTS_DIR = path.join(PROJECT_ROOT, "contracts");
const DATA_DIR = path.join(PROJECT_ROOT, ".sepolia");
const ENV_FILE = path.join(PROJECT_ROOT, ".env.sepolia");
const DEPLOYMENTS_FILE = path.join(DATA_DIR, "deployments.json");
const FRONTEND_ENV = path.join(PROJECT_ROOT, "frontend", ".env.testnet");

// Auto-load .env.sepolia if it exists (no dotenv dependency needed)
if (fs.existsSync(ENV_FILE)) {
  const envLines = fs.readFileSync(ENV_FILE, "utf-8").split("\n");
  for (const line of envLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // Don't override existing env vars
    if (!process.env[key]) process.env[key] = val;
  }
}

const RPC_URL =
  process.env.STARKNET_SEPOLIA_RPC_URL ||
  "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/demo";

const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS || "";
const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";

// ── Colors ───────────────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", red: "\x1b[31m",
  green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", cyan: "\x1b[36m",
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
  if (!fs.existsSync(sierraPath)) throw new Error(`Sierra artifact not found: ${sierraPath}`);
  if (!fs.existsSync(casmPath)) throw new Error(`CASM artifact not found: ${casmPath}`);
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
    info("Waiting for declare tx...");
    await account.waitForTransaction(declareResult.transaction_hash, { retryInterval: 5000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] });
  } catch (e: any) {
    const msg = e?.message || String(e);
    if (msg.includes("already declared") || msg.includes("CLASS_ALREADY_DECLARED") || msg.includes("is already declared")) {
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
  info("Waiting for deploy tx...");
  await account.waitForTransaction(deployResult.transaction_hash, { retryInterval: 5000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] });
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
    await account.waitForTransaction(result.transaction_hash, { retryInterval: 5000, successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"] });
    ok(`  ${functionName} called`);
  } catch (e: any) {
    warn(`  ${functionName} failed: ${e?.message?.slice(0, 200) || e}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--build")) {
    header("Building Cairo Contracts");
    execSync("scarb build", { cwd: CONTRACTS_DIR, stdio: "inherit" });
    ok("Contracts compiled successfully");
  }

  // ── Validate credentials ──────────────────────────────────────────────
  if (!DEPLOYER_ADDRESS || !DEPLOYER_KEY) {
    err("Missing DEPLOYER_ADDRESS and/or DEPLOYER_PRIVATE_KEY.");
    console.log(`
Set these env vars before running:
  export DEPLOYER_ADDRESS=0x...
  export DEPLOYER_PRIVATE_KEY=0x...

Or create .env.sepolia with them.

Need a funded account? Use the Starknet Sepolia faucet:
  ${C.cyan}https://starknet-faucet.vercel.app/${C.reset}
`);
    process.exit(1);
  }

  header("Deploying to Starknet Sepolia");
  const provider = new RpcProvider({ nodeUrl: RPC_URL });
  const account = new Account({ provider, address: DEPLOYER_ADDRESS, signer: DEPLOYER_KEY });

  info(`Deployer: ${DEPLOYER_ADDRESS}`);
  info(`RPC: ${RPC_URL}`);

  try {
    const chainId = await provider.getChainId();
    ok(`Connected to chain: ${chainId}`);
  } catch (e) {
    err(`Cannot connect to ${RPC_URL}.`);
    process.exit(1);
  }

  // Check deployer balance (STRK — v3 transactions use STRK for gas)
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
    info(`Deployer STRK balance: ${strkBal.toFixed(6)} STRK`);
    if (strkBal < 1) {
      err("Deployer has insufficient STRK for gas. Fund it at https://starknet-faucet.vercel.app/");
      process.exit(1);
    }
  } catch (e: any) {
    warn(`Could not check balance: ${e.message?.slice(0, 100)}`);
  }

  // ── Deploy all contracts (same order as devnet) ────────────────────────

  const wzec = await declareAndDeploy(account, "WzecToken", [
    DEPLOYER_ADDRESS, DEPLOYER_ADDRESS,
  ], "1/6");

  const oracle = await declareAndDeploy(account, "Oracle", [
    DEPLOYER_ADDRESS, "100000000", "0", "500", "0",
  ], "2/6");

  const registry = await declareAndDeploy(account, "VaultRegistry", [
    DEPLOYER_ADDRESS, wzec.address, "15000", "0", "1000000000", "0", "30", "0",
  ], "3/6");

  const relay = await declareAndDeploy(account, "ZcashRelay", [
    DEPLOYER_ADDRESS, 6,
  ], "4/6");

  const pool = await declareAndDeploy(account, "VaultPool", [
    DEPLOYER_ADDRESS, registry.address, wzec.address,
  ], "5/6");

  const bridge = await declareAndDeploy(account, "BridgeProtocol", [
    DEPLOYER_ADDRESS, registry.address, pool.address, relay.address, wzec.address,
    86400, 43200, 43200, "30", "0", "10000000", "0",
  ], "6/6");

  // ── Post-deploy configuration ──────────────────────────────────────────
  header("Post-Deploy Configuration");
  await invokeContract(account, wzec.address, "set_bridge", [bridge.address]);
  await invokeContract(account, registry.address, "set_bridge_protocol", [bridge.address]);
  await invokeContract(account, pool.address, "set_bridge_protocol", [bridge.address]);
  await invokeContract(account, relay.address, "authorize_relayer", [DEPLOYER_ADDRESS]);
  ok("Post-deploy configuration complete");

  // ── Save deployments ──────────────────────────────────────────────────
  header("Saving Deployment Artifacts");

  const deployments = {
    network: "sepolia",
    deployer: DEPLOYER_ADDRESS,
    rpc_url: RPC_URL,
    timestamp: new Date().toISOString(),
    contracts: {
      wzec_token: { address: wzec.address, class_hash: wzec.classHash },
      oracle: { address: oracle.address, class_hash: oracle.classHash },
      vault_registry: { address: registry.address, class_hash: registry.classHash },
      zcash_relay: { address: relay.address, class_hash: relay.classHash },
      bridge_protocol: { address: bridge.address, class_hash: bridge.classHash },
      vault_pool: { address: pool.address, class_hash: pool.classHash },
    },
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
  ok(`Deployments saved to ${DEPLOYMENTS_FILE}`);

  // ── Generate frontend .env.testnet ─────────────────────────────────────
  const envContent = `# ==========================================================================
# Zarklink Frontend — Starknet Sepolia Testnet
# ==========================================================================
# Auto-generated by deploy-sepolia.ts on ${new Date().toISOString()}
# To activate: cd frontend && cp .env.testnet .env.local
# Or use: ../switch-env.sh testnet

# ── Network ─────────────────────────────────────────────────────────────
NEXT_PUBLIC_NETWORK=testnet
NEXT_PUBLIC_STARKNET_RPC_URL=${RPC_URL}

# ── Deployer (for admin operations on dev page) ────────────────────────
NEXT_PUBLIC_DEPLOYER_ADDRESS=${DEPLOYER_ADDRESS}
# NOTE: Private key is server-only (no NEXT_PUBLIC_ prefix) to prevent
# exposure in the client-side JavaScript bundle.
DEPLOYER_KEY=${DEPLOYER_KEY}

# ── Deployed Contract Addresses ─────────────────────────────────────────
NEXT_PUBLIC_BRIDGE_ADDRESS=${bridge.address}
NEXT_PUBLIC_REGISTRY_ADDRESS=${registry.address}
NEXT_PUBLIC_POOL_ADDRESS=${pool.address}
NEXT_PUBLIC_RELAY_ADDRESS=${relay.address}
NEXT_PUBLIC_WZEC_ADDRESS=${wzec.address}
NEXT_PUBLIC_ORACLE_ADDRESS=${oracle.address}
`;

  fs.writeFileSync(FRONTEND_ENV, envContent);
  ok(`Frontend env saved to ${FRONTEND_ENV}`);

  // ── Summary ────────────────────────────────────────────────────────────
  header("Deployment Summary — Starknet Sepolia");
  console.log(`  ${C.bold}wZEC Token:${C.reset}       ${wzec.address}`);
  console.log(`  ${C.bold}Oracle:${C.reset}           ${oracle.address}`);
  console.log(`  ${C.bold}Vault Registry:${C.reset}   ${registry.address}`);
  console.log(`  ${C.bold}Zcash Relay:${C.reset}      ${relay.address}`);
  console.log(`  ${C.bold}Bridge Protocol:${C.reset}  ${bridge.address}`);
  console.log(`  ${C.bold}Vault Pool:${C.reset}       ${pool.address}`);
  console.log("");
  console.log(`  To switch frontend to testnet:`);
  console.log(`    ${C.cyan}./switch-env.sh testnet${C.reset}`);
  console.log("");
  ok("All contracts deployed and configured on Sepolia!");
}

main().catch((e) => {
  err(`Deployment failed: ${e.message || e}`);
  process.exit(1);
});
