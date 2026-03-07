// ============================================================================
// Zarklink Integration Test — Vault Registry
// ============================================================================

import {
  suite, test, assert, assertEqual, assertReverts,
  getDeployerAccount, getVaultAccount, getIssuerAccount,
  declareAndDeploy, getContract, printSummary, resetResults,
} from "./harness.js";

export async function runRegistryTests(): Promise<{ passed: number; failed: number }> {
  resetResults();
  const deployer = getDeployerAccount();
  const vault = getVaultAccount();
  const user = getIssuerAccount();

  suite("Vault Registry");

  // Deploy registry: collateral_ratio=15000 (150%), max_lock=1000000, fee_rate=50 (0.5%)
  const { address: regAddr } = await declareAndDeploy(deployer, "VaultRegistry", {
    owner: deployer.address,
    collateral_token: "0x0", // dummy token addr (simplified model)
    standard_collateral_ratio: { low: 15000, high: 0 },
    max_lock_amount: { low: 1000000, high: 0 },
    fee_rate: { low: 50, high: 0 },
  });
  const registry = getContract("VaultRegistry", regAddr, deployer);

  await test("initial vault count is 0", async () => {
    const count = Number(await registry.call("get_vault_count"));
    assertEqual(count, 0, "vault_count");
  });

  // Register vault using vault account
  const registryVault = getContract("VaultRegistry", regAddr, vault);

  await test("register vault", async () => {
    const tx = await registryVault.invoke("register_vault", [
      "0xaabb", // zcash_addr_d
      "0xccdd", // zcash_addr_pkd
    ]);
    await vault.waitForTransaction(tx.transaction_hash);

    const count = Number(await registry.call("get_vault_count"));
    assertEqual(count, 1, "vault_count after register");
  });

  await test("vault is active", async () => {
    const isActive = await registry.call("is_vault_active", [0]);
    assert(Boolean(isActive), "vault 0 is active");
  });

  await test("get vault info", async () => {
    const info = await registry.call("get_vault", [0]) as any;
    assertEqual(String(info.owner).toLowerCase(), vault.address.toLowerCase(), "owner");
    assertEqual(BigInt(info.collateral), 0n, "initial collateral");
  });

  await test("duplicate registration fails", async () => {
    await assertReverts(
      () => registryVault.invoke("register_vault", ["0x1111", "0x2222"]),
      "double register",
    );
  });

  await test("deposit collateral", async () => {
    const tx = await registryVault.invoke("deposit_collateral", [
      { low: 50000, high: 0 },
    ]);
    await vault.waitForTransaction(tx.transaction_hash);

    const info = await registry.call("get_vault", [0]) as any;
    assertEqual(BigInt(info.collateral), 50000n, "collateral after deposit");
  });

  await test("deposit more collateral", async () => {
    const tx = await registryVault.invoke("deposit_collateral", [
      { low: 25000, high: 0 },
    ]);
    await vault.waitForTransaction(tx.transaction_hash);

    const info = await registry.call("get_vault", [0]) as any;
    assertEqual(BigInt(info.collateral), 75000n, "collateral after second deposit");
  });

  await test("withdraw collateral", async () => {
    const tx = await registryVault.invoke("withdraw_collateral", [
      { low: 10000, high: 0 },
    ]);
    await vault.waitForTransaction(tx.transaction_hash);

    const info = await registry.call("get_vault", [0]) as any;
    assertEqual(BigInt(info.collateral), 65000n, "collateral after withdraw");
  });

  await test("withdraw more than balance fails", async () => {
    await assertReverts(
      () => registryVault.invoke("withdraw_collateral", [{ low: 999999, high: 0 }]),
      "overflow withdraw",
    );
  });

  await test("deposit zero fails", async () => {
    await assertReverts(
      () => registryVault.invoke("deposit_collateral", [{ low: 0, high: 0 }]),
      "zero deposit",
    );
  });

  await test("non-vault user deposit fails", async () => {
    const regUser = getContract("VaultRegistry", regAddr, user);
    await assertReverts(
      () => regUser.invoke("deposit_collateral", [{ low: 100, high: 0 }]),
      "non-vault deposit",
    );
  });

  await test("get required collateral (150%)", async () => {
    const required = await registry.call("get_required_collateral", [
      { low: 10000, high: 0 },
    ]);
    assertEqual(BigInt(required as any), 15000n, "150% of 10000");
  });

  await test("submit proof of capacity", async () => {
    const tx = await registryVault.invoke("submit_proof_of_capacity", [
      ["0x1", "0x2", "0x3"],
    ]);
    await vault.waitForTransaction(tx.transaction_hash);
    // If we reach here without revert, proof accepted
    assert(true, "proof accepted");
  });

  await test("submit proof of balance", async () => {
    const tx = await registryVault.invoke("submit_proof_of_balance", [
      ["0x4", "0x5", "0x6"],
    ]);
    await vault.waitForTransaction(tx.transaction_hash);
    assert(true, "proof accepted");
  });

  await test("set_bridge_protocol by owner", async () => {
    const tx = await registry.invoke("set_bridge_protocol", [user.address]);
    await deployer.waitForTransaction(tx.transaction_hash);
    assert(true, "bridge set");
  });

  await test("set_bridge_protocol by non-owner fails", async () => {
    const regUser = getContract("VaultRegistry", regAddr, user);
    await assertReverts(
      () => regUser.invoke("set_bridge_protocol", [user.address]),
      "non-owner set bridge",
    );
  });

  await test("update vault zcash address", async () => {
    const tx = await registryVault.invoke("update_vault_zcash_addr", [
      "0xeeff",
      "0x1122",
    ]);
    await vault.waitForTransaction(tx.transaction_hash);

    const info = await registry.call("get_vault", [0]) as any;
    assertEqual(BigInt(info.zcash_addr_d), BigInt("0xeeff"), "updated d");
    assertEqual(BigInt(info.zcash_addr_pkd), BigInt("0x1122"), "updated pkd");
  });

  // Register a second vault (user account)
  const regUser = getContract("VaultRegistry", regAddr, user);

  await test("register second vault", async () => {
    const tx = await regUser.invoke("register_vault", ["0x3333", "0x4444"]);
    await user.waitForTransaction(tx.transaction_hash);

    const count = Number(await registry.call("get_vault_count"));
    assertEqual(count, 2, "vault_count is 2");
  });

  await test("get_vault_id_by_owner", async () => {
    const id = Number(await registry.call("get_vault_id_by_owner", [vault.address]));
    assertEqual(id, 0, "vault account → id 0");

    const id2 = Number(await registry.call("get_vault_id_by_owner", [user.address]));
    assertEqual(id2, 1, "user account → id 1");
  });

  // Slash test: set bridge to deployer, then slash via deployer
  await test("slash vault by bridge", async () => {
    // Set bridge back to deployer for slash rights
    const tx1 = await registry.invoke("set_bridge_protocol", [deployer.address]);
    await deployer.waitForTransaction(tx1.transaction_hash);

    const tx2 = await registry.invoke("slash_vault", [0, { low: 5000, high: 0 }]);
    await deployer.waitForTransaction(tx2.transaction_hash);

    const info = await registry.call("get_vault", [0]) as any;
    assertEqual(BigInt(info.collateral), 60000n, "collateral after slash");
  });

  await test("slash by non-bridge fails", async () => {
    await assertReverts(
      () => regUser.invoke("slash_vault", [0, { low: 100, high: 0 }]),
      "non-bridge slash",
    );
  });

  return printSummary();
}

const isMain = process.argv[1]?.includes("test-registry");
if (isMain) {
  runRegistryTests().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
