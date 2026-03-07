// ============================================================================
// Zarklink Integration Test — Vault Pool
// ============================================================================

import {
  suite, test, assert, assertEqual, assertReverts,
  getDeployerAccount, getVaultAccount, getIssuerAccount,
  declareAndDeploy, getContract, printSummary, resetResults,
} from "./harness.js";

async function deployRegistryAndPool(deployer: ReturnType<typeof getDeployerAccount>) {
  // Deploy VaultRegistry
  const { address: regAddr } = await declareAndDeploy(deployer, "VaultRegistry", {
    owner: deployer.address,
    collateral_token: "0x0",
    standard_collateral_ratio: { low: 15000, high: 0 },
    max_lock_amount: { low: 1000000, high: 0 },
    fee_rate: { low: 50, high: 0 },
  });

  // Deploy VaultPool pointing to registry
  const { address: poolAddr } = await declareAndDeploy(deployer, "VaultPool", {
    owner: deployer.address,
    vault_registry: regAddr,
    collateral_token: "0x0",
  });

  return { regAddr, poolAddr };
}

async function registerVaultInRegistry(
  regAddr: string,
  account: ReturnType<typeof getDeployerAccount>,
) {
  const registryAs = getContract("VaultRegistry", regAddr, account);
  const tx = await registryAs.invoke("register_vault", ["0xaa", "0xbb"]);
  await account.waitForTransaction(tx.transaction_hash);
}

export async function runPoolTests(): Promise<{ passed: number; failed: number }> {
  resetResults();
  const deployer = getDeployerAccount();
  const vault = getVaultAccount();
  const user = getIssuerAccount();

  suite("Vault Pool");

  const { regAddr, poolAddr } = await deployRegistryAndPool(deployer);
  const pool = getContract("VaultPool", poolAddr, deployer);

  await test("initial pool capacity is 0", async () => {
    const cap = BigInt(await pool.call("get_pool_capacity") as any);
    assertEqual(cap, 0n, "initial capacity");
  });

  await test("active vault count is 0", async () => {
    const count = Number(await pool.call("get_active_vault_count"));
    assertEqual(count, 0, "active count");
  });

  // Register vault in registry, then deposit to pool
  await registerVaultInRegistry(regAddr, vault);

  const poolVault = getContract("VaultPool", poolAddr, vault);

  await test("deposit collateral to pool", async () => {
    const tx = await poolVault.invoke("deposit_collateral", [{ low: 80000, high: 0 }]);
    await vault.waitForTransaction(tx.transaction_hash);

    const total = BigInt(await pool.call("get_total_deposited") as any);
    assertEqual(total, 80000n, "total deposited");
  });

  await test("active vault count is 1", async () => {
    const count = Number(await pool.call("get_active_vault_count"));
    assertEqual(count, 1, "active count");
  });

  await test("vault pool share matches deposit", async () => {
    const share = BigInt(await pool.call("get_vault_pool_share", [0]) as any);
    assertEqual(share, 80000n, "share");
  });

  await test("vault free collateral = deposit (no encumbrance)", async () => {
    const free = BigInt(await pool.call("get_vault_free_collateral", [0]) as any);
    assertEqual(free, 80000n, "free collateral");
  });

  await test("pool capacity equals deposit", async () => {
    const cap = BigInt(await pool.call("get_pool_capacity") as any);
    assertEqual(cap, 80000n, "capacity");
  });

  await test("deposit more", async () => {
    const tx = await poolVault.invoke("deposit_collateral", [{ low: 20000, high: 0 }]);
    await vault.waitForTransaction(tx.transaction_hash);

    const total = BigInt(await pool.call("get_total_deposited") as any);
    assertEqual(total, 100000n, "total");
  });

  await test("withdraw partial", async () => {
    const tx = await poolVault.invoke("withdraw_collateral", [{ low: 30000, high: 0 }]);
    await vault.waitForTransaction(tx.transaction_hash);

    const share = BigInt(await pool.call("get_vault_pool_share", [0]) as any);
    assertEqual(share, 70000n, "share after withdraw");
  });

  await test("withdraw more than free fails", async () => {
    await assertReverts(
      () => poolVault.invoke("withdraw_collateral", [{ low: 999999, high: 0 }]),
      "over-withdraw",
    );
  });

  await test("deposit zero fails", async () => {
    await assertReverts(
      () => poolVault.invoke("deposit_collateral", [{ low: 0, high: 0 }]),
      "zero deposit",
    );
  });

  // assign_request — needs at least one vault in pool
  await test("assign_request returns a vault id", async () => {
    const id = Number(await pool.call("assign_request", ["0xdeadbeef"]));
    assertEqual(id, 0, "only vault 0 in pool");
  });

  // Set bridge protocol to deployer so we can test encumber/release
  await test("set_bridge_protocol", async () => {
    const tx = await pool.invoke("set_bridge_protocol", [deployer.address]);
    await deployer.waitForTransaction(tx.transaction_hash);
    assert(true, "bridge set");
  });

  await test("encumber collateral", async () => {
    const tx = await pool.invoke("encumber", [0, { low: 25000, high: 0 }]);
    await deployer.waitForTransaction(tx.transaction_hash);

    const free = BigInt(await pool.call("get_vault_free_collateral", [0]) as any);
    assertEqual(free, 45000n, "free after encumber (70000 - 25000)");
  });

  await test("capacity reflects encumbrance", async () => {
    const cap = BigInt(await pool.call("get_pool_capacity") as any);
    assertEqual(cap, 45000n, "capacity = total - encumbered");
  });

  await test("withdraw encumbered fails", async () => {
    // Try to withdraw all 70000 but only 45000 is free
    await assertReverts(
      () => poolVault.invoke("withdraw_collateral", [{ low: 70000, high: 0 }]),
      "withdraw encumbered",
    );
  });

  await test("release encumbrance", async () => {
    const tx = await pool.invoke("release_encumbrance", [0, { low: 10000, high: 0 }]);
    await deployer.waitForTransaction(tx.transaction_hash);

    const free = BigInt(await pool.call("get_vault_free_collateral", [0]) as any);
    assertEqual(free, 55000n, "free after release (70000 - 15000)");
  });

  await test("encumber by non-bridge fails", async () => {
    const poolUser = getContract("VaultPool", poolAddr, user);
    await assertReverts(
      () => poolUser.invoke("encumber", [0, { low: 100, high: 0 }]),
      "non-bridge encumber",
    );
  });

  await test("set_bridge by non-owner fails", async () => {
    const poolUser = getContract("VaultPool", poolAddr, user);
    await assertReverts(
      () => poolUser.invoke("set_bridge_protocol", [user.address]),
      "non-owner set bridge",
    );
  });

  // Register second vault, deposit, then test assignment with multiple vaults
  await registerVaultInRegistry(regAddr, user);
  const poolUser = getContract("VaultPool", poolAddr, user);

  await test("second vault deposits to pool", async () => {
    const tx = await poolUser.invoke("deposit_collateral", [{ low: 40000, high: 0 }]);
    await user.waitForTransaction(tx.transaction_hash);

    const count = Number(await pool.call("get_active_vault_count"));
    assertEqual(count, 2, "two active vaults");
  });

  await test("withdraw all removes vault from pool", async () => {
    const tx = await poolUser.invoke("withdraw_collateral", [{ low: 40000, high: 0 }]);
    await user.waitForTransaction(tx.transaction_hash);

    const count = Number(await pool.call("get_active_vault_count"));
    assertEqual(count, 1, "back to one active vault");
  });

  // Empty pool assignment test
  await test("withdraw remaining and assign with no vaults fails", async () => {
    // Release remaining encumbrance first
    const tx1 = await pool.invoke("release_encumbrance", [0, { low: 15000, high: 0 }]);
    await deployer.waitForTransaction(tx1.transaction_hash);

    // Withdraw all of vault 0
    const tx2 = await poolVault.invoke("withdraw_collateral", [{ low: 70000, high: 0 }]);
    await vault.waitForTransaction(tx2.transaction_hash);

    const count = Number(await pool.call("get_active_vault_count"));
    assertEqual(count, 0, "no active vaults");

    await assertReverts(
      () => pool.invoke("assign_request", ["0xcafe"]),
      "no vaults assign",
    );
  });

  return printSummary();
}

const isMain = process.argv[1]?.includes("test-pool");
if (isMain) {
  runPoolTests().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
