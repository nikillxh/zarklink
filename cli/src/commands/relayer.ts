// ============================================================================
// Zarklink CLI — Relayer Commands
// ============================================================================
// Start and manage the Zcash header relayer.

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { Contract } from "starknet";
import {
  getProvider,
  getDefaultAccount,
  loadCliConfig,
  shortHex,
  zcashRpc,
} from "../utils.js";

export function relayerCommand(): Command {
  const cmd = new Command("relayer").description("Manage Zcash header relayer");

  cmd
    .command("authorize")
    .description("Authorize a relayer address (admin only)")
    .requiredOption("-a, --address <addr>", "Relayer Starknet address")
    .action(async (opts) => {
      const spinner = ora("Authorizing relayer...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const relay = new Contract({ abi: relayAbi(), address: config.zcashRelayAddress, providerOrAccount: account });

        const tx = await relay.invoke("authorize_relayer", [opts.address]);
        await provider.waitForTransaction(tx.transaction_hash);

        spinner.succeed(
          `Relayer authorized: ${chalk.green(shortHex(opts.address))}`,
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("revoke")
    .description("Revoke a relayer address (admin only)")
    .requiredOption("-a, --address <addr>", "Relayer Starknet address")
    .action(async (opts) => {
      const spinner = ora("Revoking relayer...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const relay = new Contract({ abi: relayAbi(), address: config.zcashRelayAddress, providerOrAccount: account });

        const tx = await relay.invoke("revoke_relayer", [opts.address]);
        await provider.waitForTransaction(tx.transaction_hash);

        spinner.succeed(
          `Relayer revoked: ${chalk.green(shortHex(opts.address))}`,
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("submit-header")
    .description("Manually submit a Zcash block header")
    .requiredOption("-h, --height <n>", "Block height")
    .action(async (opts) => {
      const spinner = ora("Fetching block header...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const height = parseInt(opts.height);

        // Fetch header from Zcash node
        const blockHash: any = await zcashRpc(config, "getblockhash", [height]);
        const header: any = await zcashRpc(config, "getblockheader", [
          blockHash,
          true,
        ]);

        spinner.text = "Submitting header to Starknet...";

        const relay = new Contract({ abi: relayAbi(), address: config.zcashRelayAddress, providerOrAccount: account });

        const tx = await relay.invoke("submit_header", [
          height,
          header.version,
          header.previousblockhash ?? "0x0",
          header.merkleroot,
          header.time,
          header.bits ?? "0x0",
          header.nonce ?? "0x0",
        ]);
        await provider.waitForTransaction(tx.transaction_hash);

        spinner.succeed(
          `Header #${height} submitted: ${chalk.green(shortHex(tx.transaction_hash))}`,
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("sync")
    .description("Sync missing headers from Zcash node to relay")
    .option("-b, --batch-size <n>", "Headers per batch", "10")
    .option("-m, --max <n>", "Maximum headers to sync", "100")
    .action(async (opts) => {
      const spinner = ora("Checking sync status...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const relay = new Contract({ abi: relayAbi(), address: config.zcashRelayAddress, providerOrAccount: account });

        const chainTip = Number(await relay.call("get_chain_tip", []));
        const zcashInfo: any = await zcashRpc(config, "getblockchaininfo", []);
        const zcashHeight = zcashInfo.blocks;
        const lag = zcashHeight - chainTip;

        if (lag <= 0) {
          spinner.succeed("Relay is fully synced");
          return;
        }

        const batchSize = parseInt(opts.batchSize);
        const maxHeaders = Math.min(parseInt(opts.max), lag);
        spinner.succeed(`${lag} headers behind — syncing up to ${maxHeaders}`);

        let synced = 0;
        for (
          let h = chainTip + 1;
          h <= chainTip + maxHeaders;
          h += batchSize
        ) {
          const end = Math.min(h + batchSize - 1, chainTip + maxHeaders);
          const batch = [];

          spinner.start(`Fetching headers ${h}–${end}...`);
          for (let height = h; height <= end; height++) {
            const blockHash: any = await zcashRpc(config, "getblockhash", [height]);
            const header: any = await zcashRpc(config, "getblockheader", [
              blockHash,
              true,
            ]);
            batch.push({ height, header });
          }

          for (const { height, header } of batch) {
            spinner.text = `Submitting header #${height}...`;
            const tx = await relay.invoke("submit_header", [
              height,
              header.version,
              header.previousblockhash ?? "0x0",
              header.merkleroot,
              header.time,
              header.bits ?? "0x0",
              header.nonce ?? "0x0",
            ]);
            await provider.waitForTransaction(tx.transaction_hash);
            synced++;
          }

          spinner.succeed(`Synced headers ${h}–${end}`);
        }

        console.log(chalk.green(`\nSynced ${synced} headers successfully`));
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  cmd
    .command("check")
    .description("Check if an address is an authorized relayer")
    .requiredOption("-a, --address <addr>", "Address to check")
    .action(async (opts) => {
      const spinner = ora("Checking...").start();
      try {
        const config = loadCliConfig();
        const provider = getProvider(config);
        const account = getDefaultAccount(config);

        const relay = new Contract({ abi: relayAbi(), address: config.zcashRelayAddress, providerOrAccount: account });

        const isAuthorized = await relay.call("is_relayer_authorized", [
          opts.address,
        ]);
        spinner.stop();

        const authorized = Boolean(Number(isAuthorized));
        console.log(
          `${shortHex(opts.address)}: ${
            authorized
              ? chalk.green("Authorized")
              : chalk.red("Not authorized")
          }`,
        );
      } catch (err: any) {
        spinner.fail(chalk.red(err.message));
        process.exit(1);
      }
    });

  return cmd;
}

function relayAbi(): any[] {
  return [
    {
      type: "function",
      name: "authorize_relayer",
      inputs: [
        { name: "relayer", type: "core::starknet::contract_address::ContractAddress" },
      ],
      outputs: [],
      state_mutability: "external",
    },
    {
      type: "function",
      name: "revoke_relayer",
      inputs: [
        { name: "relayer", type: "core::starknet::contract_address::ContractAddress" },
      ],
      outputs: [],
      state_mutability: "external",
    },
    {
      type: "function",
      name: "submit_header",
      inputs: [
        { name: "height", type: "core::integer::u32" },
        { name: "version", type: "core::felt252" },
        { name: "prev_block_hash", type: "core::felt252" },
        { name: "merkle_root", type: "core::felt252" },
        { name: "timestamp", type: "core::integer::u64" },
        { name: "bits", type: "core::felt252" },
        { name: "nonce", type: "core::felt252" },
      ],
      outputs: [],
      state_mutability: "external",
    },
    {
      type: "function",
      name: "get_chain_tip",
      inputs: [],
      outputs: [{ type: "core::integer::u32" }],
      state_mutability: "view",
    },
    {
      type: "function",
      name: "is_relayer_authorized",
      inputs: [
        { name: "relayer", type: "core::starknet::contract_address::ContractAddress" },
      ],
      outputs: [{ type: "core::bool" }],
      state_mutability: "view",
    },
  ];
}
