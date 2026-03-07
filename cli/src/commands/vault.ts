// ============================================================================
// Zarklink CLI — Vault Commands
// ============================================================================
// Register, manage, and inspect vaults.

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { Contract, uint256 } from "starknet";
import {
  getProvider,
  getDefaultAccount,
  loadCliConfig,
  shortHex,
  formatZec,
} from "../utils.js";

export function vaultCommand(): Command {
  const cmd = new Command("vault").description("Manage vaults");

  cmd
    .command("register")
    .description("Register a new vault")
    .requiredOption(
      "-c, --collateral <zatoshi>",
      "Initial collateral in zatoshi",
    )
    .requiredOption(
      "-z, --zcash-address <addr>",
      "Zcash address for receiving ZEC",
    )
    .option("-r, --ratio <bps>", "Collateral ratio in basis points", "15000")
    .action(async (opts) => {
      const spinner = ora("Registering vault...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const registry = new Contract({ abi: registryAbi(), address: config.vaultRegistryAddress, providerOrAccount: account });

        const collateral = uint256.bnToUint256(BigInt(opts.collateral));
        const tx = await registry.invoke("register_vault", [
          collateral,
          opts.zcashAddress,
          parseInt(opts.ratio),
        ]);
        await provider.waitForTransaction(tx.transaction_hash);

        spinner.succeed(
          `Vault registered: ${chalk.green(shortHex(tx.transaction_hash))}`,
        );
        console.log(
          chalk.dim(
            "Join the vault pool with `zarklink vault join-pool`",
          ),
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("deposit")
    .description("Deposit additional collateral")
    .requiredOption("-a, --amount <zatoshi>", "Amount in zatoshi")
    .action(async (opts) => {
      const spinner = ora("Depositing collateral...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const registry = new Contract({ abi: registryAbi(), address: config.vaultRegistryAddress, providerOrAccount: account });

        const amount = uint256.bnToUint256(BigInt(opts.amount));
        const tx = await registry.invoke("deposit_collateral", [amount]);
        await provider.waitForTransaction(tx.transaction_hash);

        spinner.succeed(
          `Deposit successful: ${chalk.green(shortHex(tx.transaction_hash))}`,
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("withdraw")
    .description("Withdraw excess collateral")
    .requiredOption("-a, --amount <zatoshi>", "Amount in zatoshi")
    .action(async (opts) => {
      const spinner = ora("Withdrawing collateral...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const registry = new Contract({ abi: registryAbi(), address: config.vaultRegistryAddress, providerOrAccount: account });

        const amount = uint256.bnToUint256(BigInt(opts.amount));
        const tx = await registry.invoke("withdraw_collateral", [amount]);
        await provider.waitForTransaction(tx.transaction_hash);

        spinner.succeed(
          `Withdrawal successful: ${chalk.green(shortHex(tx.transaction_hash))}`,
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("join-pool")
    .description("Add vault to the liquidity pool")
    .requiredOption("-a, --amount <zatoshi>", "Pool deposit amount")
    .action(async (opts) => {
      const spinner = ora("Joining vault pool...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const pool = new Contract({ abi: poolAbi(), address: config.vaultPoolAddress, providerOrAccount: account });

        const amount = uint256.bnToUint256(BigInt(opts.amount));
        const tx = await pool.invoke("deposit_collateral", [amount]);
        await provider.waitForTransaction(tx.transaction_hash);

        spinner.succeed(
          `Joined pool: ${chalk.green(shortHex(tx.transaction_hash))}`,
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("info")
    .description("Show vault info")
    .option("-i, --id <vault_id>", "Vault ID (omit for own vault)")
    .action(async (opts) => {
      const spinner = ora("Fetching vault info...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const registry = new Contract({ abi: registryAbi(), address: config.vaultRegistryAddress, providerOrAccount: account });

        let vaultId = opts.id;
        if (!vaultId) {
          const idResult = await registry.call("get_vault_id_by_owner", [
            account.address,
          ]);
          vaultId = Number(idResult).toString();
        }

        const info: any = await registry.call("get_vault_info", [
          parseInt(vaultId),
        ]);
        spinner.stop();

        console.log(chalk.bold(`Vault #${vaultId}`));
        console.log(`  Owner:        ${chalk.cyan(shortHex(String(info[0])))}`);
        console.log(`  Collateral:   ${formatZec(BigInt(info[1] ?? 0))}`);
        console.log(`  Status:       ${formatVaultStatus(Number(info[2]))}`);
        console.log(`  Zcash Addr:   ${info[3] ?? "N/A"}`);
        console.log(
          `  Coll. Ratio:  ${Number(info[4] ?? 0) / 100}%`,
        );
        console.log(`  Total Issued: ${formatZec(BigInt(info[5] ?? 0))}`);
        console.log(`  Total Redeemed: ${formatZec(BigInt(info[6] ?? 0))}`);
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("list")
    .description("List all registered vaults")
    .action(async () => {
      const spinner = ora("Fetching vaults...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const registry = new Contract({ abi: registryAbi(), address: config.vaultRegistryAddress, providerOrAccount: account });

        const count = await registry.call("get_vault_count", []);
        const total = Number(count);
        spinner.stop();

        if (total === 0) {
          console.log(chalk.dim("No vaults registered."));
          return;
        }

        console.log(chalk.bold(`Registered Vaults (${total}):`));
        console.log();

        for (let i = 1; i <= total; i++) {
          try {
            const info: any = await registry.call("get_vault_info", [i]);
            const status = formatVaultStatus(Number(info[2]));
            const collateral = formatZec(BigInt(info[1] ?? 0));
            console.log(
              `  ${chalk.bold(`#${i}`)} ${status} — ${collateral} collateral — owner: ${chalk.dim(shortHex(String(info[0])))}`,
            );
          } catch {
            console.log(`  ${chalk.bold(`#${i}`)} ${chalk.dim("(error fetching)")}`);
          }
        }
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  return cmd;
}

function formatVaultStatus(status: number): string {
  switch (status) {
    case 0:
      return chalk.green("Active");
    case 1:
      return chalk.yellow("Suspended");
    case 2:
      return chalk.red("Liquidated");
    default:
      return chalk.dim(`Unknown (${status})`);
  }
}

function registryAbi(): any[] {
  return [
    {
      type: "function",
      name: "register_vault",
      inputs: [
        { name: "collateral", type: "core::integer::u256" },
        { name: "zcash_address", type: "core::felt252" },
        { name: "collateral_ratio", type: "core::integer::u32" },
      ],
      outputs: [],
      state_mutability: "external",
    },
    {
      type: "function",
      name: "deposit_collateral",
      inputs: [{ name: "amount", type: "core::integer::u256" }],
      outputs: [],
      state_mutability: "external",
    },
    {
      type: "function",
      name: "withdraw_collateral",
      inputs: [{ name: "amount", type: "core::integer::u256" }],
      outputs: [],
      state_mutability: "external",
    },
    {
      type: "function",
      name: "get_vault_info",
      inputs: [{ name: "vault_id", type: "core::integer::u32" }],
      outputs: [
        { type: "core::starknet::contract_address::ContractAddress" },
        { type: "core::integer::u256" },
        { type: "core::integer::u8" },
        { type: "core::felt252" },
        { type: "core::integer::u32" },
        { type: "core::integer::u256" },
        { type: "core::integer::u256" },
      ],
      state_mutability: "view",
    },
    {
      type: "function",
      name: "get_vault_id_by_owner",
      inputs: [
        { name: "owner", type: "core::starknet::contract_address::ContractAddress" },
      ],
      outputs: [{ type: "core::integer::u32" }],
      state_mutability: "view",
    },
    {
      type: "function",
      name: "get_vault_count",
      inputs: [],
      outputs: [{ type: "core::integer::u32" }],
      state_mutability: "view",
    },
  ];
}

function poolAbi(): any[] {
  return [
    {
      type: "function",
      name: "deposit_collateral",
      inputs: [{ name: "amount", type: "core::integer::u256" }],
      outputs: [],
      state_mutability: "external",
    },
  ];
}
