#!/usr/bin/env node
// ============================================================================
// Zarklink — Generate Starknet Sepolia Deployer Account
// ============================================================================
// Creates a new Starknet account on Sepolia using OpenZeppelin Account contract.
//
// Steps:
//   1. Generates a random private key
//   2. Computes the account address
//   3. Prompts you to fund it via faucet
//   4. Deploys the account contract
//
// Usage:
//   npx tsx scripts/create-sepolia-account.ts
//   npx tsx scripts/create-sepolia-account.ts --deploy  # after funding
// ============================================================================

import { RpcProvider, Account, ec, hash, CallData, stark } from "starknet";
import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(PROJECT_ROOT, ".sepolia");
const ACCOUNT_FILE = path.join(DATA_DIR, "account.json");

const RPC_URL =
  process.env.STARKNET_SEPOLIA_RPC_URL ||
  "https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_8/demo";

// OpenZeppelin Account class hash (pre-declared on Sepolia)
// OZ Account v0.11 — constructor(public_key: felt252)
const OZ_ACCOUNT_CLASS_HASH =
  "0x00e2eb8f5672af4e6a4e8a8f1b44989685e668489b0a25437733756c5a34a1d6";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", red: "\x1b[31m",
  green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", cyan: "\x1b[36m",
};

function info(msg: string) { console.log(`${C.cyan}[INFO]${C.reset}  ${msg}`); }
function ok(msg: string) { console.log(`${C.green}[OK]${C.reset}    ${msg}`); }
function err(msg: string) { console.log(`${C.red}[ERR]${C.reset}   ${msg}`); }
function header(msg: string) { console.log(`\n${C.bold}${C.blue}═══ ${msg} ═══${C.reset}\n`); }

async function main() {
  const args = process.argv.slice(2);
  const shouldDeploy = args.includes("--deploy");
  const provider = new RpcProvider({ nodeUrl: RPC_URL });

  // Check if we already have an account
  if (fs.existsSync(ACCOUNT_FILE) && !shouldDeploy) {
    const existing = JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf-8"));
    header("Existing Account Found");
    console.log(`  ${C.bold}Address:${C.reset}     ${existing.address}`);
    console.log(`  ${C.bold}Private Key:${C.reset} ${existing.private_key}`);
    console.log("");
    console.log(`  Fund this address at: ${C.cyan}https://starknet-faucet.vercel.app/${C.reset}`);
    console.log("");
    console.log(`  Then deploy: ${C.cyan}npx tsx scripts/create-sepolia-account.ts --deploy${C.reset}`);
    return;
  }

  if (shouldDeploy) {
    // ── Deploy existing account ────────────────────────────────────
    if (!fs.existsSync(ACCOUNT_FILE)) {
      err("No account file found. Run without --deploy first.");
      process.exit(1);
    }

    const accountData = JSON.parse(fs.readFileSync(ACCOUNT_FILE, "utf-8"));
    header("Deploying Account Contract");

    info(`Address: ${accountData.address}`);

    // Check balance by calling STRK token's balanceOf (v3 txs use STRK for gas)
    const STRK_TOKEN = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
    try {
      const result = await provider.callContract({
        contractAddress: STRK_TOKEN,
        entrypoint: "balanceOf",
        calldata: [accountData.address],
      });
      const balLow = BigInt(result[0] || "0");
      const balHigh = BigInt(result[1] || "0");
      const balance = balLow + (balHigh << 128n);
      const strkBal = Number(balance) / 1e18;
      info(`STRK balance: ${strkBal.toFixed(6)} STRK`);
      if (strkBal < 0.5) {
        err("Insufficient STRK. Fund the account first:");
        console.log(`  ${C.cyan}https://starknet-faucet.vercel.app/${C.reset}`);
        console.log(`  Address: ${accountData.address}`);
        process.exit(1);
      }
    } catch (e: any) {
      err(`Could not check balance: ${e.message?.slice(0, 100)}`);
      console.log("The account may not have been funded yet.");
      console.log(`Fund at: ${C.cyan}https://starknet-faucet.vercel.app/${C.reset}`);
      process.exit(1);
    }

    // Deploy the account
    const account = new Account(
      { provider, address: accountData.address, signer: accountData.private_key }
    );

    info("Deploying account contract (this may take 30-60 seconds)...");
    try {
      const deployResult = await account.deployAccount({
        classHash: OZ_ACCOUNT_CLASS_HASH,
        constructorCalldata: CallData.compile({
          public_key: accountData.public_key,
        }),
        addressSalt: accountData.public_key,
      });
      info(`Deploy tx: ${deployResult.transaction_hash}`);
      await provider.waitForTransaction(deployResult.transaction_hash, {
        retryInterval: 5000,
        successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"],
      });
      ok("Account deployed successfully!");

      // Update file
      accountData.deployed = true;
      accountData.deploy_tx = deployResult.transaction_hash;
      fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(accountData, null, 2));
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("already deployed") || msg.includes("ALREADY_DEPLOYED") || msg.includes("contract_already_deployed")) {
        ok("Account already deployed!");
        accountData.deployed = true;
        fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(accountData, null, 2));
      } else {
        err(`Deploy failed: ${msg.slice(0, 300)}`);
        process.exit(1);
      }
    }

    header("Account Ready");
    console.log(`  ${C.bold}Address:${C.reset}     ${accountData.address}`);
    console.log(`  ${C.bold}Private Key:${C.reset} ${accountData.private_key}`);
    console.log("");
    console.log(`  To deploy contracts:`);
    console.log(`    export DEPLOYER_ADDRESS=${accountData.address}`);
    console.log(`    export DEPLOYER_PRIVATE_KEY=${accountData.private_key}`);
    console.log(`    npx tsx scripts/deploy-sepolia.ts --build`);
    return;
  }

  // ── Generate new account ──────────────────────────────────────────
  header("Generating New Starknet Sepolia Account");

  // Generate random private key
  const privateKey = stark.randomAddress();
  const publicKey = ec.starkCurve.getStarkKey(privateKey);

  // Compute account address
  const address = hash.calculateContractAddressFromHash(
    publicKey, // salt
    OZ_ACCOUNT_CLASS_HASH,
    CallData.compile({ public_key: publicKey }),
    0, // deployer address (0 = universal deployer)
  );

  info(`Private key: ${privateKey}`);
  info(`Public key:  ${publicKey}`);
  ok(`Address:     ${address}`);

  // Save
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const accountData = {
    address,
    private_key: privateKey,
    public_key: publicKey,
    class_hash: OZ_ACCOUNT_CLASS_HASH,
    deployed: false,
    created_at: new Date().toISOString(),
  };
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(accountData, null, 2));
  ok(`Saved to ${ACCOUNT_FILE}`);

  // ── Instructions ───────────────────────────────────────────────────
  header("Next Steps");
  console.log(`  ${C.bold}1.${C.reset} Fund this address with Sepolia ETH:`);
  console.log(`     ${C.cyan}https://starknet-faucet.vercel.app/${C.reset}`);
  console.log(`     Address: ${C.bold}${address}${C.reset}`);
  console.log("");
  console.log(`  ${C.bold}2.${C.reset} Deploy the account contract:`);
  console.log(`     ${C.cyan}npx tsx scripts/create-sepolia-account.ts --deploy${C.reset}`);
  console.log("");
  console.log(`  ${C.bold}3.${C.reset} Deploy Zarklink contracts:`);
  console.log(`     ${C.cyan}export DEPLOYER_ADDRESS=${address}${C.reset}`);
  console.log(`     ${C.cyan}export DEPLOYER_PRIVATE_KEY=${privateKey}${C.reset}`);
  console.log(`     ${C.cyan}npx tsx scripts/deploy-sepolia.ts --build${C.reset}`);
}

main().catch((e) => {
  err(`Failed: ${e.message || e}`);
  process.exit(1);
});
