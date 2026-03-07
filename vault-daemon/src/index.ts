// ============================================================================
// Zarklink — Vault Daemon Entry Point
// ============================================================================
// Orchestrates vault operations: monitors bridge events, handles
// issue confirmations/challenges, redeem ZEC releases, and periodic
// proof submissions.

import { loadConfig } from "./config.js";
import { ZcashOps } from "./zcash-ops.js";
import { EventMonitor, type BridgeEvent } from "./monitor.js";
import { ProverClient } from "./prover-client.js";
import { CallData } from "starknet";

const BANNER = `
╔═══════════════════════════════════════════════════════╗
║         Zarklink — Vault Operator Daemon               ║
║   Automated vault management for the Zcash bridge       ║
╚═══════════════════════════════════════════════════════╝
`;

interface DaemonStats {
  issuesConfirmed: number;
  issuesChallenged: number;
  redeemsConfirmed: number;
  redeemsChallenged: number;
  proofsSubmitted: number;
  errors: number;
  startedAt: Date;
}

async function main(): Promise<void> {
  console.log(BANNER);

  const config = loadConfig();
  console.log("[Vault] Configuration loaded");
  console.log(`  Zcash RPC:    ${config.zcashRpcUrl}`);
  console.log(`  Starknet RPC: ${config.starknetRpcUrl}`);
  console.log(`  Vault addr:   ${config.vaultAddress}`);
  console.log(`  Auto-confirm: ${config.autoConfirm}\n`);

  // Initialize services
  const zcash = new ZcashOps(
    config.zcashRpcUrl,
    config.zcashRpcUser,
    config.zcashRpcPass,
  );

  const monitor = new EventMonitor(config);
  const prover = new ProverClient();

  const stats: DaemonStats = {
    issuesConfirmed: 0,
    issuesChallenged: 0,
    redeemsConfirmed: 0,
    redeemsChallenged: 0,
    proofsSubmitted: 0,
    errors: 0,
    startedAt: new Date(),
  };

  // Health checks
  console.log("[Vault] Running health checks...");
  const zcashOk = await zcash.ping();
  if (!zcashOk) {
    console.error("[Vault] ERROR: Cannot connect to zcashd");
    process.exit(1);
  }
  const balance = await zcash.getShieldedBalance();
  console.log(`  ✓ Zcash: connected (shielded balance: ${balance} ZEC)`);

  const starknetOk = await monitor.getProvider().getChainId().then(() => true).catch(() => false);
  if (!starknetOk) {
    console.error("[Vault] ERROR: Cannot connect to Starknet");
    process.exit(1);
  }
  console.log("  ✓ Starknet: connected\n");

  // ------ Event Handlers ------

  // Handle issue: MintSubmitted → confirm or challenge
  monitor.on("MintSubmitted", async (event: BridgeEvent) => {
    console.log(`[Vault] Received MintSubmitted for ${event.requestId}`);

    if (!config.autoConfirm) {
      console.log("[Vault] Auto-confirm disabled, skipping");
      return;
    }

    try {
      // In production: decrypt the note ciphertext with vault's key
      // Verify the note is valid and addressed to this vault
      // If valid → confirm_issue, if invalid → challenge_issue

      // For devnet: auto-confirm
      const txHash = await monitor.execute(
        config.bridgeProtocolContract,
        "confirm_issue",
        CallData.compile({ request_id: event.requestId }),
      );

      console.log(`[Vault] Confirmed issue ${event.requestId}, tx: ${txHash}`);
      stats.issuesConfirmed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Vault] Failed to confirm issue: ${msg}`);
      stats.errors++;
    }
  });

  // Handle redeem: BurnSubmitted → send shielded ZEC, then confirm
  monitor.on("BurnSubmitted", async (event: BridgeEvent) => {
    console.log(`[Vault] Received BurnSubmitted for ${event.requestId}`);

    if (!config.autoConfirm) {
      console.log("[Vault] Auto-confirm disabled, skipping");
      return;
    }

    try {
      // In production:
      // 1. Decrypt note ciphertext to get redeemer's Zcash address
      // 2. Send shielded ZEC to redeemer
      // 3. Wait for confirmation
      // 4. Generate inclusion proof
      // 5. Call confirm_redeem with the proof

      // For devnet: simulate the flow
      const addresses = await zcash.listShieldedAddresses();
      const vaultAddr = addresses[0]; // Vault's Sapling address

      // Send ZEC (would be to redeemer's address in production)
      // const txid = await zcash.shieldedSend(vaultAddr, redeemerAddr, amount);

      // Mine a block to finalize
      await zcash.generateBlocks(1);

      // Generate mock inclusion proof
      const inclusionProof = await prover.generateInclusionProof(
        event.data.field_0 ?? "0x1",
        "0x1",
        4, // Shallow tree for devnet
      );

      const txHash = await monitor.execute(
        config.bridgeProtocolContract,
        "confirm_redeem",
        CallData.compile({
          request_id: event.requestId,
          inclusion_proof: inclusionProof,
          block_height: 100,
        }),
      );

      console.log(`[Vault] Confirmed redeem ${event.requestId}, tx: ${txHash}`);
      stats.redeemsConfirmed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Vault] Failed to confirm redeem: ${msg}`);
      stats.errors++;
    }
  });

  // Catch-all event logger
  monitor.on("*", async (event: BridgeEvent) => {
    console.log(
      `[Vault] Event: ${event.type} block=${event.blockNumber} tx=${event.transactionHash.slice(0, 18)}...`,
    );
  });

  // ------ Periodic Proof Submission ------

  let proofInterval: ReturnType<typeof setInterval> | null = null;

  if (config.vaultRegistryContract) {
    proofInterval = setInterval(async () => {
      try {
        console.log("[Vault] Submitting periodic proof of balance...");
        const balance = await zcash.getShieldedBalance();
        const proofResult = await prover.generateBalanceProof(
          0, // vault_id
          balance,
          "0x0", // obligations (read from contract in production)
        );

        await monitor.execute(
          config.vaultRegistryContract,
          "submit_proof_of_balance",
          CallData.compile({ proof: proofResult.proof }),
        );

        stats.proofsSubmitted++;
        console.log("[Vault] Proof of balance submitted");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Vault] Proof submission failed: ${msg}`);
        stats.errors++;
      }
    }, config.proofSubmitIntervalMs);
  }

  // ------ Graceful Shutdown ------

  const shutdown = () => {
    console.log("\n[Vault] Shutting down...");
    monitor.stop();
    if (proofInterval) clearInterval(proofInterval);

    const uptime = Math.floor(
      (Date.now() - stats.startedAt.getTime()) / 1000,
    );
    console.log("\n--- Vault Daemon Stats ---");
    console.log(`  Uptime:              ${uptime}s`);
    console.log(`  Issues confirmed:    ${stats.issuesConfirmed}`);
    console.log(`  Issues challenged:   ${stats.issuesChallenged}`);
    console.log(`  Redeems confirmed:   ${stats.redeemsConfirmed}`);
    console.log(`  Redeems challenged:  ${stats.redeemsChallenged}`);
    console.log(`  Proofs submitted:    ${stats.proofsSubmitted}`);
    console.log(`  Errors:              ${stats.errors}`);
    console.log("--------------------------\n");
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Start event monitoring
  console.log("[Vault] Starting event monitor...\n");
  await monitor.start();
}

main().catch((err) => {
  console.error("[Vault] Fatal error:", err);
  process.exit(1);
});
