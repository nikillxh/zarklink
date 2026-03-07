#!/usr/bin/env node
// ============================================================================
// Zarklink CLI — Main Entry Point
// ============================================================================
// Privacy-preserving Zcash ↔ Starknet bridge CLI.

import { Command } from "commander";
import chalk from "chalk";
import { issueCommand } from "./commands/issue.js";
import { redeemCommand } from "./commands/redeem.js";
import { vaultCommand } from "./commands/vault.js";
import { statusCommand } from "./commands/status.js";
import { relayerCommand } from "./commands/relayer.js";
import { splitAmount, formatSplit } from "./splitter.js";

const BANNER = `
${chalk.hex("#00D4AA").bold("╔═══════════════════════════════════════╗")}
${chalk.hex("#00D4AA").bold("║")}  ${chalk.hex("#00D4AA").bold("⚡ ZARKLINK")} ${chalk.dim("— Zcash ↔ Starknet Bridge")}  ${chalk.hex("#00D4AA").bold("║")}
${chalk.hex("#00D4AA").bold("╚═══════════════════════════════════════╝")}
`;

const program = new Command();

program
  .name("zarklink")
  .description("Privacy-preserving Zcash ↔ Starknet bridge CLI")
  .version("0.1.0")
  .hook("preAction", () => {
    console.log(BANNER);
  });

// ── Subcommands ──────────────────────────────────────────────────────────────

program.addCommand(issueCommand());
program.addCommand(redeemCommand());
program.addCommand(vaultCommand());
program.addCommand(statusCommand());
program.addCommand(relayerCommand());

// ── Split utility command ────────────────────────────────────────────────────

program
  .command("split")
  .description("Preview the splitting strategy for an amount")
  .requiredOption("-a, --amount <zatoshi>", "Amount in zatoshi")
  .option("-k, --vaults <n>", "Number of vault slots", "16")
  .action((opts) => {
    const amount = BigInt(opts.amount);
    const k = parseInt(opts.vaults);
    const pieces = splitAmount(amount, k);
    console.log(formatSplit(pieces));
  });

// ── Config info command ──────────────────────────────────────────────────────

program
  .command("config")
  .description("Show current configuration")
  .action(() => {
    const envFile = process.env.ZARKLINK_ENV ?? ".env.devnet";
    console.log(chalk.bold("Configuration"));
    console.log(`  Env File:  ${chalk.cyan(envFile)}`);
    console.log(
      `  Network:   ${chalk.cyan(process.env.STARKNET_RPC_URL ?? "not set")}`,
    );
    console.log(
      `  Zcash RPC: ${chalk.cyan(process.env.ZCASH_RPC_URL ?? "not set")}`,
    );
    console.log();
    console.log(chalk.dim("Set ZARKLINK_ENV to switch environments."));
  });

// ── Parse & Run ──────────────────────────────────────────────────────────────

program.parse();
