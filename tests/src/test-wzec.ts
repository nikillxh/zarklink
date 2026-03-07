// ============================================================================
// Zarklink Integration Test — wZEC Token
// ============================================================================

import {
  suite, test, assert, assertEqual, assertReverts,
  getDeployerAccount, getIssuerAccount, declareAndDeploy, getContract,
  printSummary, resetResults,
} from "./harness.js";

export async function runWzecTests(): Promise<{ passed: number; failed: number }> {
  resetResults();
  const deployer = getDeployerAccount();
  const issuer = getIssuerAccount();

  suite("wZEC Token");

  // Deploy wZEC
  const { address: wzecAddr } = await declareAndDeploy(deployer, "WzecToken", {
    owner: deployer.address,
    bridge: deployer.address, // deployer acts as bridge for testing
  });
  const wzec = getContract("WzecToken", wzecAddr, deployer);
  const wzecIssuer = getContract("WzecToken", wzecAddr, issuer);

  await test("name returns Wrapped Zcash", async () => {
    const name = await wzec.call("name");
    assertEqual(String(name), "Wrapped Zcash", "name mismatch");
  });

  await test("symbol returns wZEC", async () => {
    const symbol = await wzec.call("symbol");
    assertEqual(String(symbol), "wZEC", "symbol mismatch");
  });

  await test("decimals returns 8", async () => {
    const decimals = await wzec.call("decimals");
    assertEqual(Number(decimals), 8, "decimals mismatch");
  });

  await test("initial supply is 0", async () => {
    const supply = await wzec.call("total_supply");
    assertEqual(BigInt(supply as any), 0n, "supply should be 0");
  });

  await test("mint by bridge", async () => {
    const tx = await wzec.invoke("mint", [issuer.address, { low: 100_000_000n, high: 0n }]);
    await deployer.waitForTransaction(tx.transaction_hash);

    const balance = await wzec.call("balance_of", [issuer.address]);
    assertEqual(BigInt(balance as any), 100_000_000n, "balance");
  });

  await test("transfer", async () => {
    const tx = await wzecIssuer.invoke("transfer", [
      deployer.address,
      { low: 10_000_000n, high: 0n },
    ]);
    await issuer.waitForTransaction(tx.transaction_hash);

    const bal = await wzec.call("balance_of", [issuer.address]);
    assertEqual(BigInt(bal as any), 90_000_000n, "issuer balance after transfer");
  });

  await test("approve and transfer_from", async () => {
    // Issuer approves deployer for 50_000_000
    const tx1 = await wzecIssuer.invoke("approve", [
      deployer.address,
      { low: 50_000_000n, high: 0n },
    ]);
    await issuer.waitForTransaction(tx1.transaction_hash);

    const allowance = await wzec.call("allowance", [issuer.address, deployer.address]);
    assertEqual(BigInt(allowance as any), 50_000_000n, "allowance");

    // Deployer transfers from issuer
    const tx2 = await wzec.invoke("transfer_from", [
      issuer.address,
      deployer.address,
      { low: 20_000_000n, high: 0n },
    ]);
    await deployer.waitForTransaction(tx2.transaction_hash);

    const bal = await wzec.call("balance_of", [issuer.address]);
    assertEqual(BigInt(bal as any), 70_000_000n, "issuer balance");
  });

  await test("burn by bridge", async () => {
    const supply0 = BigInt(await wzec.call("total_supply") as any);
    const tx = await wzec.invoke("burn", [issuer.address, { low: 10_000_000n, high: 0n }]);
    await deployer.waitForTransaction(tx.transaction_hash);

    const supply1 = BigInt(await wzec.call("total_supply") as any);
    assertEqual(supply0 - supply1, 10_000_000n, "supply decreased");
  });

  await test("set_bridge", async () => {
    const tx = await wzec.invoke("set_bridge", [issuer.address]);
    await deployer.waitForTransaction(tx.transaction_hash);
    // Now issuer is bridge — can mint
    const tx2 = await wzecIssuer.invoke("mint", [
      issuer.address,
      { low: 1n, high: 0n },
    ]);
    await issuer.waitForTransaction(tx2.transaction_hash);
    assert(true, "mint from new bridge succeeded");
  });

  return printSummary();
}

// Run standalone
const isMain = process.argv[1]?.includes("test-wzec");
if (isMain) {
  runWzecTests().then(({ failed }) => process.exit(failed > 0 ? 1 : 0));
}
