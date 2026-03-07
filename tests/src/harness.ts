// ============================================================================
// Zarklink Integration Tests — Shared Test Harness
// ============================================================================
// Provides contract deployment helpers, assertion utilities, and a simple
// test runner framework for starknet.js integration tests.

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  Account, RpcProvider, Contract, json,
  CallData, shortString, hash, stark
} from "starknet";
import { readFileSync, existsSync } from "fs";
import chalk from "chalk";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env.devnet") });

// ── Provider & Accounts ─────────────────────────────────────────────────────

const RPC_URL = process.env.STARKNET_RPC_URL ?? "http://127.0.0.1:5050";

export function getProvider(): RpcProvider {
  return new RpcProvider({ nodeUrl: RPC_URL });
}

export function getDeployerAccount(): Account {
  const provider = getProvider();
  return new Account({
    provider,
    address: process.env.DEPLOYER_ADDRESS!,
    signer: process.env.DEPLOYER_PRIVATE_KEY!,
  });
}

export function getVaultAccount(): Account {
  const provider = getProvider();
  return new Account({
    provider,
    address: process.env.VAULT_ADDRESS!,
    signer: process.env.VAULT_PRIVATE_KEY!,
  });
}

export function getIssuerAccount(): Account {
  const provider = getProvider();
  return new Account({
    provider,
    address: process.env.ISSUER_ADDRESS!,
    signer: process.env.ISSUER_PRIVATE_KEY!,
  });
}

export function getRedeemerAccount(): Account {
  const provider = getProvider();
  return new Account({
    provider,
    address: process.env.REDEEMER_ADDRESS!,
    signer: process.env.REDEEMER_PRIVATE_KEY!,
  });
}

// ── Contract Loading ────────────────────────────────────────────────────────

const ARTIFACTS_DIR = resolve(__dirname, "../../contracts/target/dev");

interface ArtifactPaths {
  sierra: string;
  casm: string;
}

function getArtifactPaths(contractName: string): ArtifactPaths {
  return {
    sierra: resolve(ARTIFACTS_DIR, `zarklink_${contractName}.contract_class.json`),
    casm: resolve(ARTIFACTS_DIR, `zarklink_${contractName}.compiled_contract_class.json`),
  };
}

export function loadSierra(contractName: string): object {
  const { sierra } = getArtifactPaths(contractName);
  if (!existsSync(sierra)) {
    throw new Error(`Sierra artifact not found: ${sierra}\nRun 'scarb build' first.`);
  }
  return json.parse(readFileSync(sierra, "utf-8"));
}

export function loadCasm(contractName: string): object {
  const { casm } = getArtifactPaths(contractName);
  if (!existsSync(casm)) {
    throw new Error(`CASM artifact not found: ${casm}\nRun 'scarb build' first.`);
  }
  return json.parse(readFileSync(casm, "utf-8"));
}

// ── Contract Deployment ─────────────────────────────────────────────────────

export async function declareAndDeploy(
  account: Account,
  contractName: string,
  constructorArgs: Record<string, unknown> | unknown[],
): Promise<{ address: string; classHash: string }> {
  const sierra = loadSierra(contractName) as any;
  const casm = loadCasm(contractName) as any;

  // Declare
  const declareResult = await account.declare({ contract: sierra, casm });
  await account.waitForTransaction(declareResult.transaction_hash);
  const classHash = declareResult.class_hash;

  // Deploy
  const deployResult = await account.deployContract({
    classHash,
    constructorCalldata: CallData.compile(constructorArgs as any),
  });
  await account.waitForTransaction(deployResult.transaction_hash);
  const address = deployResult.contract_address!;

  return { address, classHash };
}

export function getContract(
  contractName: string,
  address: string,
  account: Account,
): Contract {
  const sierra = loadSierra(contractName) as any;
  return new Contract({ abi: sierra.abi, address: address, providerOrAccount: account });
}

// ── Simple Test Runner ──────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];
let currentSuite = "";

export function suite(name: string): void {
  currentSuite = name;
  console.log(chalk.bold.blue(`\n═══ ${name} ═══\n`));
}

export async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ name: `${currentSuite}::${name}`, passed: true, duration: ms });
    console.log(chalk.green(`  ✓ ${name}`) + chalk.gray(` (${ms}ms)`));
  } catch (err: unknown) {
    const ms = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name: `${currentSuite}::${name}`, passed: false, error: msg, duration: ms });
    console.log(chalk.red(`  ✗ ${name}`) + chalk.gray(` (${ms}ms)`));
    console.log(chalk.yellow(`    ${msg.split("\n")[0]}`));
  }
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

export function assertNotEqual<T>(actual: T, notExpected: T, message: string): void {
  if (actual === notExpected) {
    throw new Error(`${message}: expected value different from ${notExpected}`);
  }
}

export async function assertReverts(fn: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await fn();
    throw new Error(`${message}: expected revert but succeeded`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("expected revert but succeeded")) throw err;
    // Good — we expected a revert
  }
}

export function printSummary(): { passed: number; failed: number } {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const total = results.length;
  const totalTime = results.reduce((s, r) => s + r.duration, 0);

  console.log(chalk.bold(`\n${"─".repeat(60)}`));
  console.log(
    chalk.bold(
      `Tests: ${chalk.green(`${passed} passed`)}, ${
        failed > 0 ? chalk.red(`${failed} failed`) : "0 failed"
      }, ${total} total (${totalTime}ms)`,
    ),
  );

  if (failed > 0) {
    console.log(chalk.red.bold("\nFailed tests:"));
    for (const r of results.filter((r) => !r.passed)) {
      console.log(chalk.red(`  ✗ ${r.name}`));
      if (r.error) console.log(chalk.yellow(`    ${r.error.split("\n")[0]}`));
    }
  }

  console.log();
  return { passed, failed };
}

export function resetResults(): void {
  results.length = 0;
  currentSuite = "";
}
