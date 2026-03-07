// ============================================================================
// Zarklink CLI — Redeem Commands
// ============================================================================
// Redeem (burn) wZEC on Starknet and receive ZEC on Zcash.

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
  zcashRpc,
} from "../utils.js";
import { splitAmount, formatSplit, validateSplit } from "../splitter.js";

export function redeemCommand(): Command {
  const cmd = new Command("redeem").description(
    "Redeem wZEC — burn on Starknet, receive ZEC on Zcash",
  );

  cmd
    .command("request")
    .description("Submit a burn request to redeem ZEC")
    .requiredOption("-a, --amount <zatoshi>", "Amount in zatoshi to redeem")
    .requiredOption(
      "-z, --zcash-address <addr>",
      "Zcash shielded address to receive ZEC",
    )
    .option("-k, --splits <n>", "Number of vault splits for privacy", "16")
    .option("--no-split", "Disable splitting")
    .action(async (opts) => {
      const spinner = ora("Loading config...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const amount = BigInt(opts.amount);
        const k = opts.split === false ? 1 : parseInt(opts.splits);

        spinner.text = "Computing split strategy...";
        const pieces = splitAmount(amount, k);
        if (!validateSplit(pieces, amount)) {
          throw new Error("Split validation failed");
        }

        const nonZero = pieces.filter((p) => p > 0n);
        spinner.succeed("Split strategy computed");
        console.log(chalk.dim(formatSplit(pieces)));
        console.log();

        // Approve wZEC spending
        spinner.start("Approving wZEC spending...");
        const wzec = new Contract({ abi: wzecAbi(), address: config.wzecAddress, providerOrAccount: account });
        const totalUint = uint256.bnToUint256(amount);
        const approveTx = await wzec.invoke("approve", [
          config.bridgeAddress,
          totalUint,
        ]);
        await provider.waitForTransaction(approveTx.transaction_hash);
        spinner.succeed("wZEC spending approved");

        // Submit burn requests for each piece
        const bridge = new Contract({ abi: bridgeAbi(), address: config.bridgeAddress, providerOrAccount: account });

        const requestIds: string[] = [];
        for (let i = 0; i < nonZero.length; i++) {
          const piece = nonZero[i];
          spinner.start(
            `Submitting burn ${i + 1}/${nonZero.length} (${formatZec(piece)})...`,
          );

          const burnAmount = uint256.bnToUint256(piece);
          const tx = await bridge.invoke("submit_burn", [
            burnAmount,
            opts.zcashAddress,
          ]);
          await provider.waitForTransaction(tx.transaction_hash);

          const receipt = await provider.getTransactionReceipt(
            tx.transaction_hash,
          ) as any;
          const events = receipt.events ?? [];
          const requestEvent = events.find((e: any) => e.keys?.length > 0);
          const requestId = requestEvent?.data?.[0] ?? tx.transaction_hash;
          requestIds.push(requestId);

          spinner.succeed(
            `Burn ${i + 1}: ${chalk.green(shortHex(requestId))} — ${formatZec(piece)}`,
          );
        }

        console.log();
        console.log(chalk.bold("Redeem requests submitted:"));
        for (const id of requestIds) {
          console.log(`  ${chalk.cyan(shortHex(id))}`);
        }
        console.log();
        console.log(
          chalk.dim(
            "The vault operator will send ZEC to your address. Track with `zarklink redeem status`",
          ),
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("confirm")
    .description("Confirm a redeem (vault operator — after sending ZEC)")
    .requiredOption("-r, --request-id <id>", "Redeem request ID")
    .requiredOption("-t, --tx-hash <hash>", "Zcash transaction hash")
    .action(async (opts) => {
      const spinner = ora("Loading config...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        // Wait for Zcash confirmations
        spinner.text = "Waiting for 6 Zcash confirmations...";
        let confirmed = false;
        while (!confirmed) {
          try {
            const txInfo: any = await zcashRpc(config, "gettransaction", [
              opts.txHash,
            ]);
            if (txInfo.confirmations >= 6) {
              confirmed = true;
            } else {
              spinner.text = `Confirmations: ${txInfo.confirmations}/6...`;
              await sleep(10000);
            }
          } catch {
            await sleep(5000);
          }
        }
        spinner.succeed("Zcash transaction confirmed");

        // Get block info
        spinner.start("Fetching proof data...");
        const txInfo: any = await zcashRpc(config, "gettransaction", [
          opts.txHash,
        ]);
        const blockHash = txInfo.blockhash;
        const blockInfo: any = await zcashRpc(config, "getblock", [blockHash]);

        // Submit confirmation on chain
        spinner.text = "Confirming redeem on Starknet...";
        const bridge = new Contract({ abi: bridgeAbi(), address: config.bridgeAddress, providerOrAccount: account });

        const tx = await bridge.invoke("confirm_redeem", [
          opts.requestId,
          opts.txHash,
          blockInfo.height,
          blockHash,
          0, // merkle_root
          0, // proof
        ]);
        await provider.waitForTransaction(tx.transaction_hash);

        spinner.succeed(
          `Redeem confirmed: ${chalk.green(shortHex(tx.transaction_hash))}`,
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("status")
    .description("Check status of a redeem request")
    .requiredOption("-r, --request-id <id>", "Redeem request ID")
    .action(async (opts) => {
      const spinner = ora("Fetching redeem status...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const bridge = new Contract({ abi: bridgeAbi(), address: config.bridgeAddress, providerOrAccount: account });

        const result: any = await bridge.call("get_redeem", [opts.requestId]);
        spinner.stop();

        console.log(chalk.bold("Redeem Request"));
        console.log(`  ID:      ${chalk.cyan(opts.requestId)}`);
        console.log(`  Status:  ${formatStatus(Number(result[0]))}`);
        console.log(`  Amount:  ${formatZec(BigInt(result[1] ?? 0))}`);
        console.log(`  Vault:   ${result[2] ?? "N/A"}`);
        console.log(`  Address: ${result[3] ?? "N/A"}`);
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  return cmd;
}

function formatStatus(status: number): string {
  switch (status) {
    case 0:
      return chalk.yellow("Pending");
    case 1:
      return chalk.blue("Processing");
    case 2:
      return chalk.green("Completed");
    case 3:
      return chalk.red("Expired");
    case 4:
      return chalk.red("Challenged");
    default:
      return chalk.dim(`Unknown (${status})`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bridgeAbi(): any[] {
  return [
    {
      type: "function",
      name: "submit_burn",
      inputs: [
        { name: "amount", type: "core::integer::u256" },
        { name: "zcash_address", type: "core::felt252" },
      ],
      outputs: [{ type: "core::felt252" }],
      state_mutability: "external",
    },
    {
      type: "function",
      name: "confirm_redeem",
      inputs: [
        { name: "request_id", type: "core::felt252" },
        { name: "zcash_tx_hash", type: "core::felt252" },
        { name: "block_height", type: "core::integer::u32" },
        { name: "block_hash", type: "core::felt252" },
        { name: "merkle_root", type: "core::felt252" },
        { name: "proof", type: "core::felt252" },
      ],
      outputs: [],
      state_mutability: "external",
    },
    {
      type: "function",
      name: "get_redeem",
      inputs: [{ name: "request_id", type: "core::felt252" }],
      outputs: [
        { type: "core::integer::u8" },
        { type: "core::integer::u256" },
        { type: "core::integer::u32" },
        { type: "core::felt252" },
      ],
      state_mutability: "view",
    },
  ];
}

function wzecAbi(): any[] {
  return [
    {
      type: "function",
      name: "approve",
      inputs: [
        { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
        { name: "amount", type: "core::integer::u256" },
      ],
      outputs: [{ type: "core::bool" }],
      state_mutability: "external",
    },
  ];
}
