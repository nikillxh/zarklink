// ============================================================================
// Zarklink Integration Tests — Run All Test Suites
// ============================================================================

import chalk from "chalk";
import { runWzecTests } from "./test-wzec.js";
import { runOracleTests } from "./test-oracle.js";
import { runRelayTests } from "./test-relay.js";
import { runRegistryTests } from "./test-registry.js";
import { runPoolTests } from "./test-pool.js";
import { runE2ETests } from "./test-e2e-flow.js";

interface SuiteResult {
  name: string;
  passed: number;
  failed: number;
}

async function main() {
  console.log(chalk.bold.magenta("\n╔══════════════════════════════════════════════════╗"));
  console.log(chalk.bold.magenta("║       Zarklink Integration Test Suite            ║"));
  console.log(chalk.bold.magenta("╚══════════════════════════════════════════════════╝\n"));

  const allResults: SuiteResult[] = [];
  const suites: [string, () => Promise<{ passed: number; failed: number }>][] = [
    ["wZEC Token",      runWzecTests],
    ["Oracle",          runOracleTests],
    ["Zcash Relay",     runRelayTests],
    ["Vault Registry",  runRegistryTests],
    ["Vault Pool",      runPoolTests],
    ["E2E Flow",        runE2ETests],
  ];

  for (const [name, runner] of suites) {
    try {
      const result = await runner();
      allResults.push({ name, ...result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(chalk.red.bold(`\n✗ Suite "${name}" crashed: ${msg}\n`));
      allResults.push({ name, passed: 0, failed: 1 });
    }
  }

  // ── Grand Summary ───────────────────────────────────────────────────────
  const totalPassed = allResults.reduce((s, r) => s + r.passed, 0);
  const totalFailed = allResults.reduce((s, r) => s + r.failed, 0);
  const totalTests = totalPassed + totalFailed;

  console.log(chalk.bold.magenta("\n╔══════════════════════════════════════════════════╗"));
  console.log(chalk.bold.magenta("║           Grand Summary                          ║"));
  console.log(chalk.bold.magenta("╚══════════════════════════════════════════════════╝\n"));

  for (const r of allResults) {
    const status = r.failed > 0 ? chalk.red("FAIL") : chalk.green("PASS");
    const counts = `${chalk.green(r.passed + " passed")}, ${
      r.failed > 0 ? chalk.red(r.failed + " failed") : "0 failed"
    }`;
    console.log(`  ${status}  ${chalk.bold(r.name.padEnd(20))} ${counts}`);
  }

  console.log(chalk.bold(`\n${"═".repeat(52)}`));
  console.log(
    chalk.bold(
      `  Total: ${chalk.green(`${totalPassed} passed`)}, ${
        totalFailed > 0 ? chalk.red(`${totalFailed} failed`) : "0 failed"
      }, ${totalTests} tests`,
    ),
  );
  console.log(chalk.bold(`${"═".repeat(52)}\n`));

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(chalk.red.bold("Fatal error:"), err);
  process.exit(1);
});
