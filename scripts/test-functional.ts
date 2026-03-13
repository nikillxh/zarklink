#!/usr/bin/env node
// ============================================================================
// Zarklink — Full Functional Test (Issue + Redeem + Vault Tracking)
// ============================================================================
// Tests the complete flow on devnet:
//   1. Register vault + deposit collateral
//   2. Seed relay with Zcash headers
//   3. Issue flow: request_lock → submit_mint → confirm_issue
//   4. Verify vault.total_issued is updated
//   5. Redeem flow: submit_burn → confirm_redeem
//   6. Verify vault.total_redeemed is updated
//   7. Test all frontend read hooks (stats, vault list, balance)
//
// Usage:  node_modules/.bin/tsx scripts/test-functional.ts
// ============================================================================

import { RpcProvider, Account, Contract, CallData, logger, shortString, hash as starkHash } from "starknet";
import * as fs from "fs";
import * as path from "path";

logger.setLogLevel("ERROR");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const DEPLOYMENTS = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, ".devnet/deployments.json"), "utf-8")
);
const ACCOUNTS_RAW = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, ".devnet/starknet-accounts-labeled.json"), "utf-8")
);

// Convert to array: { accounts: { key: {address, private_key, label} } }
const ACCOUNTS = Object.entries(ACCOUNTS_RAW.accounts).map(([key, val]: [string, any]) => ({
  key,
  address: val.address,
  private_key: val.private_key,
  label: val.label ?? key,
}));

const RPC = new RpcProvider({ nodeUrl: "http://127.0.0.1:5050" });

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", red: "\x1b[31m",
  green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m", cyan: "\x1b[36m",
};

function pass(msg: string) { console.log(`  ${C.green}✓${C.reset} ${msg}`); }
function fail(msg: string) { console.log(`  ${C.red}✗${C.reset} ${msg}`); }
function info(msg: string) { console.log(`  ${C.cyan}→${C.reset} ${msg}`); }
function header(msg: string) { console.log(`\n${C.bold}${C.blue}── ${msg} ──${C.reset}`); }

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    pass(msg);
    passed++;
  } else {
    fail(msg);
    failed++;
  }
}

function getAccount(labelOrKey: string): Account {
  const acc = ACCOUNTS.find((a: any) => a.label === labelOrKey || a.key === labelOrKey);
  if (!acc) throw new Error(`Account not found: ${labelOrKey}. Available: ${ACCOUNTS.map((a: any) => a.label || a.key).join(", ")}`);
  return new Account({ provider: RPC, address: acc.address, signer: acc.private_key });
}

// ── Minimal ABIs ─────────────────────────────────────────────────────────────

const BRIDGE_ABI = [
  { type: "function", name: "get_fee_rate", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "get_warranty_amount", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "get_issue_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_redeem_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "request_lock", inputs: [
    { name: "lock_amount", type: "core::integer::u256" },
    { name: "note_commitment", type: "core::felt252" },
    { name: "ephemeral_pk", type: "core::felt252" },
    { name: "ciphertext", type: "core::felt252" },
  ], outputs: [{ type: "core::felt252" }], state_mutability: "external" },
  { type: "function", name: "submit_mint", inputs: [
    { name: "request_id", type: "core::felt252" },
    { name: "inclusion_proof", type: "core::array::Span::<core::felt252>" },
    { name: "block_height", type: "core::integer::u32" },
  ], outputs: [], state_mutability: "external" },
  { type: "function", name: "confirm_issue", inputs: [
    { name: "request_id", type: "core::felt252" },
  ], outputs: [], state_mutability: "external" },
  { type: "function", name: "submit_burn", inputs: [
    { name: "burn_amount", type: "core::integer::u256" },
    { name: "note_commitment", type: "core::felt252" },
    { name: "ephemeral_pk", type: "core::felt252" },
    { name: "ciphertext", type: "core::felt252" },
    { name: "zk_proof", type: "core::array::Span::<core::felt252>" },
  ], outputs: [{ type: "core::felt252" }], state_mutability: "external" },
  { type: "function", name: "confirm_redeem", inputs: [
    { name: "request_id", type: "core::felt252" },
    { name: "inclusion_proof", type: "core::array::Span::<core::felt252>" },
    { name: "block_height", type: "core::integer::u32" },
  ], outputs: [], state_mutability: "external" },
];

const REGISTRY_ABI = [
  { type: "function", name: "get_vault_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_vault", inputs: [{ name: "vault_id", type: "core::integer::u32" }], outputs: [
    { type: "core::starknet::contract_address::ContractAddress" },
    { type: "core::felt252" }, { type: "core::felt252" },
    { type: "core::integer::u256" }, { type: "core::integer::u8" },
    { type: "core::integer::u64" }, { type: "core::integer::u64" }, { type: "core::integer::u64" },
    { type: "core::integer::u256" }, { type: "core::integer::u256" },
  ], state_mutability: "view" },
  { type: "function", name: "register_vault", inputs: [
    { name: "zcash_addr_d", type: "core::felt252" },
    { name: "zcash_addr_pkd", type: "core::felt252" },
  ], outputs: [], state_mutability: "external" },
  { type: "function", name: "deposit_collateral", inputs: [
    { name: "amount", type: "core::integer::u256" },
  ], outputs: [], state_mutability: "external" },
  { type: "function", name: "is_vault_active", inputs: [{ name: "vault_id", type: "core::integer::u32" }], outputs: [{ type: "core::bool" }], state_mutability: "view" },
];

const RELAY_ABI = [
  { type: "function", name: "get_chain_tip", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_finalized_height", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_header_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_commitment_root", inputs: [{ name: "height", type: "core::integer::u32" }], outputs: [{ type: "core::felt252" }], state_mutability: "view" },
  { type: "function", name: "submit_header", inputs: [
    { name: "version", type: "core::integer::u32" },
    { name: "prev_block_hash", type: "core::felt252" },
    { name: "merkle_root", type: "core::felt252" },
    { name: "commitment_root", type: "core::felt252" },
    { name: "timestamp", type: "core::integer::u32" },
    { name: "bits", type: "core::integer::u32" },
    { name: "nonce", type: "core::felt252" },
  ], outputs: [], state_mutability: "external" },
];

const POOL_ABI = [
  { type: "function", name: "get_active_vault_count", inputs: [], outputs: [{ type: "core::integer::u32" }], state_mutability: "view" },
  { type: "function", name: "get_pool_capacity", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "deposit_collateral", inputs: [{ name: "amount", type: "core::integer::u256" }], outputs: [], state_mutability: "external" },
  { type: "function", name: "register_vault", inputs: [], outputs: [], state_mutability: "external" },
];

const WZEC_ABI = [
  { type: "function", name: "balance_of", inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
  { type: "function", name: "total_supply", inputs: [], outputs: [{ type: "core::integer::u256" }], state_mutability: "view" },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${C.bold}Zarklink Functional Test Suite${C.reset}`);
  console.log(`Network: devnet | RPC: http://127.0.0.1:5050`);

  const deployer = getAccount("deployer__admin");
  const vaultOp = getAccount("vault_operator_1");
  const issuer = getAccount("issuer_(alice)");

  const bridgeAddr = DEPLOYMENTS.contracts.bridge_protocol.address;
  const registryAddr = DEPLOYMENTS.contracts.vault_registry.address;
  const relayAddr = DEPLOYMENTS.contracts.zcash_relay.address;
  const poolAddr = DEPLOYMENTS.contracts.vault_pool.address;
  const wzecAddr = DEPLOYMENTS.contracts.wzec_token.address;

  // ── Test 1: Contract reads ───────────────────────────────────────────
  header("1. Contract Read Functions");

  const bridge = new Contract({ abi: BRIDGE_ABI as any, address: bridgeAddr, providerOrAccount: RPC });
  const feeRate = await bridge.call("get_fee_rate", []);
  assert(Number(feeRate) === 30, `Bridge fee_rate = ${feeRate} (expected 30 = 0.3%)`);

  const warranty = await bridge.call("get_warranty_amount", []);
  assert(Number(warranty) === 10000000, `Warranty = ${warranty} (expected 10000000)`);

  const registry = new Contract({ abi: REGISTRY_ABI as any, address: registryAddr, providerOrAccount: RPC });
  const vaultCount0 = Number(await registry.call("get_vault_count", []));
  assert(vaultCount0 === 0, `Initial vault count = ${vaultCount0} (expected 0)`);

  const relay = new Contract({ abi: RELAY_ABI as any, address: relayAddr, providerOrAccount: RPC });
  const headerCount0 = Number(await relay.call("get_header_count", []));
  info(`Relay header count: ${headerCount0}`);

  // ── Test 2: Register Vault ──────────────────────────────────────────
  header("2. Vault Registration");

  const regWithVault = new Contract({ abi: REGISTRY_ABI as any, address: registryAddr, providerOrAccount: vaultOp });
  const regRes = await vaultOp.execute({
    contractAddress: registryAddr,
    entrypoint: "register_vault",
    calldata: CallData.compile(["0xface", "0xbeef"]),
  });
  await RPC.waitForTransaction(regRes.transaction_hash);
  pass("Vault registered");

  // Deposit collateral
  const depRes = await vaultOp.execute({
    contractAddress: registryAddr,
    entrypoint: "deposit_collateral",
    calldata: CallData.compile(["500000000", "0"]),
  });
  await RPC.waitForTransaction(depRes.transaction_hash);
  pass("Collateral deposited (5 ZEC) to registry");

  // Deposit collateral to pool (auto-registers vault in pool)
  const poolDepRes = await vaultOp.execute({
    contractAddress: poolAddr,
    entrypoint: "deposit_collateral",
    calldata: CallData.compile(["500000000", "0"]),
  });
  await RPC.waitForTransaction(poolDepRes.transaction_hash);
  pass("Pool collateral deposited (auto-registered in pool)");

  const vaultCount1 = Number(await registry.call("get_vault_count", []));
  assert(vaultCount1 === 1, `Vault count = ${vaultCount1} (expected 1)`);

  const vaultActive = await registry.call("is_vault_active", [0]);
  assert(Boolean(vaultActive), `Vault #0 active: ${vaultActive}`);

  // Check vault total_issued before
  const vaultBefore: any = await registry.call("get_vault", [0]);
  const issuedBefore = BigInt(String(vaultBefore[8] ?? 0));
  const redeemedBefore = BigInt(String(vaultBefore[9] ?? 0));
  assert(issuedBefore === 0n, `total_issued before = ${issuedBefore} (expected 0)`);
  assert(redeemedBefore === 0n, `total_redeemed before = ${redeemedBefore} (expected 0)`);

  // ── Test 3: Seed Relay ──────────────────────────────────────────────
  header("3. Relay Header Seeding");

  // Submit 10 fake headers (BlockHeader: version, prev_block_hash, merkle_root, commitment_root, timestamp, bits, nonce, block_height)
  // Compute Poseidon hash of each header to chain prev_block_hash correctly
  let prevHash = "0x0";
  for (let i = 0; i < 10; i++) {
    const version = 4;
    const merkleRoot = `0x${(i + 1).toString(16)}`;
    const commitRoot = `0x${(100 + i).toString(16)}`;
    const timestamp = 1710000000 + i * 600;
    const bits = 0x2007ffff;
    const nonce = `0x${(i * 7 + 1).toString(16)}`;
    const blockHeight = i;

    const res = await deployer.execute({
      contractAddress: relayAddr,
      entrypoint: "submit_header",
      calldata: CallData.compile([version, prevHash, merkleRoot, commitRoot, timestamp, bits, nonce, blockHeight]),
    });
    await RPC.waitForTransaction(res.transaction_hash);

    // Compute Poseidon hash matching the contract's compute_block_hash
    prevHash = starkHash.computePoseidonHashOnElements([
      BigInt(version), BigInt(prevHash), BigInt(merkleRoot), BigInt(commitRoot),
      BigInt(timestamp), BigInt(bits), BigInt(nonce), BigInt(blockHeight),
    ]);
  }
  pass("Submitted 10 relay headers");

  const tip = Number(await relay.call("get_chain_tip", []));
  const finalized = Number(await relay.call("get_finalized_height", []));
  assert(tip === 9, `Chain tip = ${tip} (expected 9)`);
  assert(finalized >= 3, `Finalized height = ${finalized} (expected >= 3)`);

  // Get commitment root for finalized block
  const commitRoot = await relay.call("get_commitment_root", [finalized]);
  info(`Finalized block ${finalized}, commitment root: ${commitRoot}`);

  // ── Test 4: Issue Flow ──────────────────────────────────────────────
  header("4. Issue Flow (request_lock → submit_mint → confirm_issue)");

  const lockAmount = 100000000n; // 1 ZEC in zatoshi
  const warrantyAmount = 10000000n; // 0.1 ZEC warranty

  // Step 1: request_lock(mint_amount: u256, warranty_collateral: u256)
  // u256 serialized as [low, high] 
  info("Step 1: request_lock...");
  const lockRes = await issuer.execute({
    contractAddress: bridgeAddr,
    entrypoint: "request_lock",
    calldata: CallData.compile([
      lockAmount, "0",        // mint_amount u256
      warrantyAmount, "0",    // warranty_collateral u256
    ]),
  });
  const lockReceipt = await RPC.waitForTransaction(lockRes.transaction_hash);
  // Extract request_id from LockRequested event: keys[0]=selector, keys[1]=request_id (#[key])
  const lockEvents = (lockReceipt as any).events ?? [];
  const lockEvent = lockEvents.find((e: any) =>
    e.from_address?.toLowerCase() === bridgeAddr.toLowerCase() && e.keys?.length >= 2
  );
  const requestId = lockEvent?.keys?.[1] ?? "0x0";
  pass(`request_lock OK, request_id: ${requestId.toString().slice(0, 20)}...`);

  // Step 2: submit_mint(request_id, note_commitment, inclusion_proof: Span, block_height, note_ciphertext_hash, zk_proof: Span)
  // Use the finalized block's commitment root as note_commitment with empty Merkle path
  const noteCommitment = commitRoot; // so it equals stored_root → empty path works
  const noteCiphertextHash = "0xaabb";
  info("Step 2: submit_mint...");
  const mintRes = await issuer.execute({
    contractAddress: bridgeAddr,
    entrypoint: "submit_mint",
    calldata: CallData.compile([
      requestId,           // request_id: felt252
      noteCommitment,      // note_commitment: felt252
      0,                   // inclusion_proof: Span<felt252> length=0
      finalized,           // block_height: u32
      noteCiphertextHash,  // note_ciphertext_hash: felt252
      1, "0x1234",         // zk_proof: Span<felt252> length=1, ["0x1234"]
    ]),
  });
  await RPC.waitForTransaction(mintRes.transaction_hash);
  pass("submit_mint OK");

  // Step 3: confirm_issue(request_id) — by vault operator
  info("Step 3: confirm_issue...");
  const confirmRes = await vaultOp.execute({
    contractAddress: bridgeAddr,
    entrypoint: "confirm_issue",
    calldata: CallData.compile([requestId]),
  });
  await RPC.waitForTransaction(confirmRes.transaction_hash);
  pass("confirm_issue OK");

  // Check wZEC balance
  const wzec = new Contract({ abi: WZEC_ABI as any, address: wzecAddr, providerOrAccount: RPC });
  const issuerBal = BigInt(String(await wzec.call("balance_of", [issuer.address])));
  info(`Issuer wZEC balance: ${Number(issuerBal) / 1e8} wZEC`);
  assert(issuerBal > 0n, `Issuer has wZEC: ${issuerBal} zatoshi`);

  // ── Test 5: Verify vault.total_issued updated ────────────────────────
  header("5. Vault Tracking After Issue");

  const vaultAfterIssue: any = await registry.call("get_vault", [0]);
  const issuedAfter = BigInt(String(vaultAfterIssue[8] ?? 0));
  info(`total_issued after: ${issuedAfter} zatoshi (${Number(issuedAfter) / 1e8} ZEC)`);
  assert(issuedAfter === lockAmount, `total_issued = ${issuedAfter} (expected ${lockAmount})`);

  // ── Test 6: Redeem Flow ──────────────────────────────────────────────
  header("6. Redeem Flow (submit_burn → confirm_redeem)");

  const burnAmount = issuerBal / 2n; // Burn half
  const redeemCommitment = commitRoot; // Use commitment root so empty Merkle path works

  // Step 1: submit_burn(note_commitment, note_ciphertext_hash, burn_amount: u256, warranty_collateral: u256, zk_proof: Span)
  info("Step 1: submit_burn...");
  const burnRes = await issuer.execute({
    contractAddress: bridgeAddr,
    entrypoint: "submit_burn",
    calldata: CallData.compile([
      redeemCommitment,     // note_commitment: felt252
      "0xccdd",             // note_ciphertext_hash: felt252
      burnAmount, "0",      // burn_amount: u256
      warrantyAmount, "0",  // warranty_collateral: u256
      1, "0x5678",          // zk_proof: Span<felt252> length=1
    ]),
  });
  const burnReceipt = await RPC.waitForTransaction(burnRes.transaction_hash);
  // Extract redeem_id from BurnSubmitted event: keys[0]=selector, keys[1]=request_id (#[key])
  const burnEvents = (burnReceipt as any).events ?? [];
  const burnEvent = burnEvents.find((e: any) =>
    e.from_address?.toLowerCase() === bridgeAddr.toLowerCase() && e.keys?.length >= 2
  );
  const redeemId = burnEvent?.keys?.[1] ?? "0x0";
  pass(`submit_burn OK, redeem_id: ${redeemId.toString().slice(0, 20)}...`);

  // Step 2: confirm_redeem(request_id, inclusion_proof: Span, block_height)
  info("Step 2: confirm_redeem...");
  const redeemRes = await vaultOp.execute({
    contractAddress: bridgeAddr,
    entrypoint: "confirm_redeem",
    calldata: CallData.compile([
      redeemId,     // request_id: felt252
      0,            // inclusion_proof: Span<felt252> length=0
      finalized,    // block_height: u32
    ]),
  });
  await RPC.waitForTransaction(redeemRes.transaction_hash);
  pass("confirm_redeem OK");

  // ── Test 7: Verify vault.total_redeemed updated ──────────────────────
  header("7. Vault Tracking After Redeem");

  const vaultAfterRedeem: any = await registry.call("get_vault", [0]);
  const redeemedAfter = BigInt(String(vaultAfterRedeem[9] ?? 0));
  info(`total_redeemed after: ${redeemedAfter} zatoshi (${Number(redeemedAfter) / 1e8} ZEC)`);
  assert(redeemedAfter === burnAmount, `total_redeemed = ${redeemedAfter} (expected ${burnAmount})`);
  assert(redeemedAfter > 0n, `total_redeemed > 0`);

  // Verify net obligations
  const issuedFinal = BigInt(String(vaultAfterRedeem[8] ?? 0));
  const netObligations = issuedFinal - redeemedAfter;
  info(`Net obligations: ${Number(netObligations) / 1e8} ZEC`);
  assert(netObligations > 0n, `Net obligations > 0: ${netObligations} zatoshi`);

  // ── Test 8: Pool & Stats ─────────────────────────────────────────────
  header("8. Pool & Stats Reads");

  const pool = new Contract({ abi: POOL_ABI as any, address: poolAddr, providerOrAccount: RPC });
  const poolCount = Number(await pool.call("get_active_vault_count", []));
  assert(poolCount === 1, `Pool active vault count = ${poolCount} (expected 1)`);

  const issueCount = Number(await bridge.call("get_issue_count", []));
  const redeemCount = Number(await bridge.call("get_redeem_count", []));
  assert(issueCount >= 1, `Issue count = ${issueCount} (expected >= 1)`);
  assert(redeemCount >= 1, `Redeem count = ${redeemCount} (expected >= 1)`);

  const totalSupply = BigInt(String(await wzec.call("total_supply", [])));
  info(`wZEC total supply: ${Number(totalSupply) / 1e8} wZEC`);
  assert(totalSupply > 0n, `Total supply > 0`);

  // ── Summary ──────────────────────────────────────────────────────────
  console.log(`\n${C.bold}══════════════════════════════════════${C.reset}`);
  console.log(`  ${C.green}Passed:${C.reset} ${passed}`);
  console.log(`  ${C.red}Failed:${C.reset} ${failed}`);
  console.log(`${C.bold}══════════════════════════════════════${C.reset}`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`${C.red}Fatal:${C.reset} ${e.message || e}`);
  process.exit(1);
});
