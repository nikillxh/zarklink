// ============================================================================
// Zarklink CLI — Status Commands
// ============================================================================
// Query bridge status, issue/redeem requests, and chain state.

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { Contract } from "starknet";
import {
  getProvider,
  getDefaultAccount,
  loadCliConfig,
  shortHex,
  formatZec,
  zcashRpc,
} from "../utils.js";

export function statusCommand(): Command {
  const cmd = new Command("status").description("Query bridge and chain status");

  cmd
    .command("bridge")
    .description("Show bridge protocol status")
    .action(async () => {
      const spinner = ora("Fetching bridge status...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const bridge = new Contract({ abi: bridgeAbi(), address: config.bridgeAddress, providerOrAccount: account });

        const [feeRate, warrantyAmount]: any[] = await Promise.all([
          bridge.call("get_fee_rate", []),
          bridge.call("get_warranty_amount", []),
        ]);

        spinner.stop();

        console.log(chalk.bold("Bridge Protocol"));
        console.log(`  Address:   ${chalk.cyan(shortHex(config.bridgeAddress))}`);
        console.log(`  Fee Rate:  ${Number(feeRate) / 100}%`);
        console.log(
          `  Warranty:  ${formatZec(BigInt(warrantyAmount ?? 0))}`,
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("issue")
    .description("Check status of an issue request")
    .requiredOption("-r, --request-id <id>", "Issue request ID")
    .action(async (opts) => {
      const spinner = ora("Fetching issue status...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const bridge = new Contract({ abi: bridgeAbi(), address: config.bridgeAddress, providerOrAccount: account });

        const result: any = await bridge.call("get_issue", [opts.requestId]);
        spinner.stop();

        console.log(chalk.bold("Issue Request"));
        console.log(`  ID:       ${chalk.cyan(opts.requestId)}`);
        console.log(`  Status:   ${formatRequestStatus(Number(result[0]))}`);
        console.log(`  Amount:   ${formatZec(BigInt(result[1] ?? 0))}`);
        console.log(`  Vault:    ${result[2] ?? "N/A"}`);
        console.log(`  Requester: ${shortHex(String(result[3] ?? ""))}`);
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("relay")
    .description("Show Zcash relay chain status")
    .action(async () => {
      const spinner = ora("Fetching relay status...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const relay = new Contract({ abi: relayAbi(), address: config.zcashRelayAddress, providerOrAccount: account });

        const [chainTip, finalizedHeight, headerCount]: any[] = await Promise.all([
          relay.call("get_chain_tip", []),
          relay.call("get_finalized_height", []),
          relay.call("get_header_count", []),
        ]);

        // Also fetch from Zcash node
        let zcashHeight = "N/A";
        try {
          const blockchainInfo: any = await zcashRpc(config, "getblockchaininfo", []);
          zcashHeight = String(blockchainInfo.blocks);
        } catch {
          // Zcash node not available
        }

        spinner.stop();

        console.log(chalk.bold("Zcash Relay"));
        console.log(`  Address:           ${chalk.cyan(shortHex(config.zcashRelayAddress))}`);
        console.log(`  Chain Tip:         ${Number(chainTip)}`);
        console.log(`  Finalized Height:  ${Number(finalizedHeight)}`);
        console.log(`  Total Headers:     ${Number(headerCount)}`);
        console.log(`  Zcash Node Height: ${zcashHeight}`);

        const lag = zcashHeight !== "N/A"
          ? parseInt(zcashHeight) - Number(chainTip)
          : null;
        if (lag !== null) {
          const lagColor = lag <= 3 ? chalk.green : lag <= 10 ? chalk.yellow : chalk.red;
          console.log(`  Lag:               ${lagColor(`${lag} blocks`)}`);
        }
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("pool")
    .description("Show vault pool status")
    .action(async () => {
      const spinner = ora("Fetching pool status...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const pool = new Contract({ abi: poolAbi(), address: config.vaultPoolAddress, providerOrAccount: account });

        const [poolSize, capacity]: any[] = await Promise.all([
          pool.call("get_pool_size", []),
          pool.call("get_pool_capacity", []),
        ]);

        spinner.stop();

        console.log(chalk.bold("Vault Pool"));
        console.log(`  Address:   ${chalk.cyan(shortHex(config.vaultPoolAddress))}`);
        console.log(`  Pool Size: ${Number(poolSize)} vaults`);
        console.log(`  Capacity:  ${formatZec(BigInt(capacity ?? 0))}`);
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("zcash")
    .description("Show Zcash node status")
    .action(async () => {
      const spinner = ora("Fetching Zcash node status...").start();
      try {
        const config = loadCliConfig();

        const info: any = await zcashRpc(config, "getblockchaininfo", []);
        spinner.stop();

        console.log(chalk.bold("Zcash Node"));
        console.log(`  Chain:   ${info.chain}`);
        console.log(`  Blocks:  ${info.blocks}`);
        console.log(`  Headers: ${info.headers}`);
        console.log(`  Difficulty: ${info.difficulty}`);
        console.log(
          `  Verification: ${(info.verificationprogress * 100).toFixed(2)}%`,
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  return cmd;
}

function formatRequestStatus(status: number): string {
  switch (status) {
    case 0:
      return chalk.yellow("Pending");
    case 1:
      return chalk.blue("Locked");
    case 2:
      return chalk.cyan("Minted");
    case 3:
      return chalk.green("Completed");
    case 4:
      return chalk.red("Expired");
    case 5:
      return chalk.red("Challenged");
    default:
      return chalk.dim(`Unknown (${status})`);
  }
}

function bridgeAbi(): any[] {
  return [
    {
      type: "function",
      name: "get_fee_rate",
      inputs: [],
      outputs: [{ type: "core::integer::u32" }],
      state_mutability: "view",
    },
    {
      type: "function",
      name: "get_warranty_amount",
      inputs: [],
      outputs: [{ type: "core::integer::u256" }],
      state_mutability: "view",
    },
    {
      type: "function",
      name: "get_issue",
      inputs: [{ name: "request_id", type: "core::felt252" }],
      outputs: [
        { type: "core::integer::u8" },
        { type: "core::integer::u256" },
        { type: "core::integer::u32" },
        { type: "core::starknet::contract_address::ContractAddress" },
      ],
      state_mutability: "view",
    },
  ];
}

function relayAbi(): any[] {
  return [
    {
      type: "function",
      name: "get_chain_tip",
      inputs: [],
      outputs: [{ type: "core::integer::u32" }],
      state_mutability: "view",
    },
    {
      type: "function",
      name: "get_finalized_height",
      inputs: [],
      outputs: [{ type: "core::integer::u32" }],
      state_mutability: "view",
    },
    {
      type: "function",
      name: "get_header_count",
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
      name: "get_pool_size",
      inputs: [],
      outputs: [{ type: "core::integer::u32" }],
      state_mutability: "view",
    },
    {
      type: "function",
      name: "get_pool_capacity",
      inputs: [],
      outputs: [{ type: "core::integer::u256" }],
      state_mutability: "view",
    },
  ];
}
