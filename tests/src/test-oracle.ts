// ============================================================================
// Zarklink Integration Test — Oracle
// ============================================================================

import {
  suite, test, assert, assertEqual, assertReverts,
  getDeployerAccount, getIssuerAccount, declareAndDeploy, getContract,
  printSummary, resetResults,
} from "./harness.js";

const RATE_1E18 = { low: 1_000_000_000_000_000_000n, high: 0n };
const RATE_PLUS_2PCT = { low: 1_020_000_000_000_000_000n, high: 0n };
const RATE_PLUS_10PCT = { low: 1_100_000_000_000_000_000n, high: 0n };
const MAX_DEV_500 = { low: 500n, high: 0n };

export async function runOracleTests(): Promise<{ passed: number; failed: number }> {
  resetResults();
  const deployer = getDeployerAccount();
  const user = getIssuerAccount();

  suite("Oracle");

  // Deploy Oracle
  const { address: oracleAddr } = await declareAndDeploy(deployer, "Oracle", {
    owner: deployer.address,
    initial_rate: RATE_1E18,
    max_deviation_bps: MAX_DEV_500,
  });
  const oracle = getContract("Oracle", oracleAddr, deployer);
  const oracleUser = getContract("Oracle", oracleAddr, user);

  await test("initial rate is 1e18", async () => {
    const rate = await oracle.call("get_rate");
    assertEqual(BigInt(rate as any), 1_000_000_000_000_000_000n, "initial rate");
  });

  await test("rate is valid after deploy", async () => {
    const valid = await oracle.call("is_rate_valid");
    assert(Boolean(valid), "should be valid");
  });

  await test("owner can update rate within deviation", async () => {
    const tx = await oracle.invoke("update_rate", [RATE_PLUS_2PCT]);
    await deployer.waitForTransaction(tx.transaction_hash);

    const rate = await oracle.call("get_rate");
    assertEqual(BigInt(rate as any), 1_020_000_000_000_000_000n, "updated rate");
  });

  await test("unauthorized user cannot update", async () => {
    await assertReverts(
      () => oracleUser.invoke("update_rate", [RATE_PLUS_2PCT]),
      "non-provider should revert",
    );
  });

  await test("add and use feed provider", async () => {
    // Add user as provider
    const tx1 = await oracle.invoke("add_feed_provider", [user.address]);
    await deployer.waitForTransaction(tx1.transaction_hash);

    // User can now update
    const rate = { low: 1_030_000_000_000_000_000n, high: 0n };
    const tx2 = await oracleUser.invoke("update_rate", [rate]);
    await user.waitForTransaction(tx2.transaction_hash);

    const current = await oracle.call("get_rate");
    assertEqual(BigInt(current as any), 1_030_000_000_000_000_000n, "provider updated");
  });

  await test("circuit breaker on large deviation", async () => {
    // Current rate: ~1.03e18. +10% = ~1.133e18 (> 5% deviation)
    const bigRate = { low: 1_200_000_000_000_000_000n, high: 0n };
    const tx = await oracle.invoke("update_rate", [bigRate]);
    await deployer.waitForTransaction(tx.transaction_hash);

    // Rate should NOT have changed (circuit breaker silently returns)
    const rate = await oracle.call("get_rate");
    assertEqual(BigInt(rate as any), 1_030_000_000_000_000_000n, "rate unchanged");

    // is_rate_valid should be false
    const valid = await oracle.call("is_rate_valid");
    assert(!Boolean(valid), "circuit breaker active");
  });

  await test("set_max_deviation (owner only)", async () => {
    const tx = await oracle.invoke("set_max_deviation", [{ low: 2000n, high: 0n }]);
    await deployer.waitForTransaction(tx.transaction_hash);

    // Now +10% should be within 20% tolerance
    const bigRate = { low: 1_130_000_000_000_000_000n, high: 0n };
    const tx2 = await oracle.invoke("update_rate", [bigRate]);
    await deployer.waitForTransaction(tx2.transaction_hash);
    const rate = await oracle.call("get_rate");
    assertEqual(BigInt(rate as any), 1_130_000_000_000_000_000n, "rate after wider max");
  });

  await test("remove feed provider", async () => {
    const tx = await oracle.invoke("remove_feed_provider", [user.address]);
    await deployer.waitForTransaction(tx.transaction_hash);

    await assertReverts(
      () => oracleUser.invoke("update_rate", [RATE_1E18]),
      "removed provider should revert",
    );
  });

  await test("get_twap returns rate", async () => {
    const twap = await oracle.call("get_twap");
    assert(BigInt(twap as any) > 0n, "twap > 0");
  });

  return printSummary();
}

const isMain = process.argv[1]?.includes("test-oracle");
if (isMain) {
  runOracleTests().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
