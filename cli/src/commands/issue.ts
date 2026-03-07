// ============================================================================
// Zarklink CLI — Issue Commands
// ============================================================================
// Issue wZEC by locking ZEC on Zcash and minting on Starknet.

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { Contract, CallData, uint256 } from "starknet";
import {
  getProvider,
  getDefaultAccount,
  loadCliConfig,
  shortHex,
  formatZec,
  zcashRpc,
} from "../utils.js";
import { splitAmount, formatSplit, validateSplit } from "../splitter.js";

export function issueCommand(): Command {
  const cmd = new Command("issue").description("Issue (mint) wZEC on Starknet");

  cmd
    .command("request")
    .description("Request a new issue — lock ZEC on Zcash mainchain")
    .requiredOption("-a, --amount <zatoshi>", "Amount in zatoshi to issue")
    .option("-v, --vault <id>", "Specific vault ID (omit for pool assignment)")
    .option("-k, --splits <n>", "Number of vault splits for privacy", "16")
    .option("--no-split", "Disable splitting (single vault)")
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

        // Submit issue requests for each piece
        const bridge = new Contract({ abi: bridgeAbi(), address: config.bridgeAddress, providerOrAccount: account });

        const requestIds: string[] = [];
        for (let i = 0; i < nonZero.length; i++) {
          const piece = nonZero[i];
          spinner.start(
            `Submitting request ${i + 1}/${nonZero.length} (${formatZec(piece)})...`,
          );

          const mintAmount = uint256.bnToUint256(piece);
          const tx = await bridge.invoke("request_lock", [
            opts.vault ?? 0,
            mintAmount,
          ]);
          await provider.waitForTransaction(tx.transaction_hash);

          const receipt = await provider.getTransactionReceipt(
            tx.transaction_hash,
          ) as any;
          const events = receipt.events ?? [];
          const requestEvent = events.find(
            (e: any) => e.keys?.length > 0,
          );
          const requestId = requestEvent?.data?.[0] ?? tx.transaction_hash;
          requestIds.push(requestId);

          spinner.succeed(
            `Request ${i + 1}: ${chalk.green(shortHex(requestId))} — ${formatZec(piece)}`,
          );
        }

        console.log();
        console.log(chalk.bold("Issue requests submitted:"));
        for (const id of requestIds) {
          console.log(`  ${chalk.cyan(shortHex(id))}`);
        }
        console.log();
        console.log(
          chalk.dim(
            "Next: Send ZEC to the assigned vault address, then run `zarklink issue submit`",
          ),
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("submit")
    .description("Submit mint proof after ZEC transaction is confirmed")
    .requiredOption("-r, --request-id <id>", "Issue request ID")
    .requiredOption("-t, --tx-hash <hash>", "Zcash transaction hash")
    .option(
      "-c, --confirmations <n>",
      "Wait for n Zcash confirmations",
      "6",
    )
    .action(async (opts) => {
      const spinner = ora("Loading config...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const confirmations = parseInt(opts.confirmations);

        // Wait for Zcash confirmations
        spinner.text = `Waiting for ${confirmations} Zcash confirmations...`;
        let confirmed = false;
        while (!confirmed) {
          try {
            const txInfo: any = await zcashRpc(config, "gettransaction", [
              opts.txHash,
            ]);
            if (txInfo.confirmations >= confirmations) {
              confirmed = true;
            } else {
              spinner.text = `Waiting for confirmations: ${txInfo.confirmations}/${confirmations}...`;
              await sleep(10000);
            }
          } catch {
            spinner.text = "Waiting for transaction to appear...";
            await sleep(5000);
          }
        }
        spinner.succeed(
          `Zcash transaction confirmed (${confirmations} confirmations)`,
        );

        // Get block info for inclusion proof
        spinner.start("Fetching inclusion proof data...");
        const txInfo: any = await zcashRpc(config, "gettransaction", [
          opts.txHash,
        ]);
        const blockHash = txInfo.blockhash;
        const blockInfo: any = await zcashRpc(config, "getblock", [blockHash]);

        // Submit mint on Starknet
        spinner.text = "Submitting mint on Starknet...";
        const bridge = new Contract({ abi: bridgeAbi(), address: config.bridgeAddress, providerOrAccount: account });

        const tx = await bridge.invoke("submit_mint", [
          opts.requestId,
          opts.txHash,
          blockInfo.height,
          blockHash,
          // Simplified proof (devnet)
          0, // merkle_root
          0, // proof element
        ]);
        await provider.waitForTransaction(tx.transaction_hash);

        spinner.succeed(
          `Mint submitted: ${chalk.green(shortHex(tx.transaction_hash))}`,
        );
        console.log(
          chalk.dim(
            "The vault operator will confirm the issue after verification.",
          ),
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("confirm")
    .description("Confirm an issue request (vault operator only)")
    .requiredOption("-r, --request-id <id>", "Issue request ID")
    .action(async (opts) => {
      const spinner = ora("Confirming issue...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const bridge = new Contract({ abi: bridgeAbi(), address: config.bridgeAddress, providerOrAccount: account });

        const tx = await bridge.invoke("confirm_issue", [opts.requestId]);
        await provider.waitForTransaction(tx.transaction_hash);

        spinner.succeed(
          `Issue confirmed: ${chalk.green(shortHex(tx.transaction_hash))}`,
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  return cmd;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bridgeAbi(): any[] {
  return [
    {
      type: "function",
      name: "request_lock",
      inputs: [
        { name: "vault_id", type: "core::integer::u32" },
        { name: "mint_amount", type: "core::integer::u256" },
      ],
      outputs: [{ type: "core::felt252" }],
      state_mutability: "external",
    },
    {
      type: "function",
      name: "submit_mint",
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
      name: "confirm_issue",
      inputs: [{ name: "request_id", type: "core::felt252" }],
      outputs: [],
      state_mutability: "external",
    },
  ];
}
