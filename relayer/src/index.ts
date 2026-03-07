// ============================================================================
// Zarklink — Relayer Service Entry Point
// ============================================================================
// Orchestrates the Zcash → Starknet block header relay pipeline.
// Handles initialization, signal handling, and periodic status reports.

import { loadConfig } from "./config.js";
import { ZcashClient } from "./zcash-client.js";
import { StarknetRelayClient } from "./starknet-client.js";
import { HeaderPipeline } from "./header-pipeline.js";

const BANNER = `
╔═══════════════════════════════════════════════════════╗
║         Zarklink — Zcash Header Relayer               ║
║   Privacy-Preserving Zcash Bridge to Starknet          ║
╚═══════════════════════════════════════════════════════╝
`;

async function main(): Promise<void> {
  console.log(BANNER);

  // Load configuration
  const config = loadConfig();
  console.log("[Relayer] Configuration loaded");
  console.log(`  Zcash RPC:    ${config.zcashRpcUrl}`);
  console.log(`  Starknet RPC: ${config.starknetRpcUrl}`);
  console.log(`  Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`  Batch size:    ${config.batchSize}`);
  console.log(`  Finality:      ${config.finalityDepth} blocks\n`);

  // Validate contract address
  if (!config.zcashRelayContract) {
    console.error("[Relayer] ERROR: ZCASH_RELAY_CONTRACT not set in environment.");
    console.error("  Deploy contracts first: ./scripts/deploy.sh");
    process.exit(1);
  }

  // Initialize clients
  const zcash = new ZcashClient(
    config.zcashRpcUrl,
    config.zcashRpcUser,
    config.zcashRpcPass,
  );

  const starknet = new StarknetRelayClient(
    config.starknetRpcUrl,
    config.relayerAddress,
    config.relayerPrivateKey,
    config.zcashRelayContract,
  );

  // Health checks
  console.log("[Relayer] Running health checks...");

  const zcashOk = await zcash.ping();
  if (!zcashOk) {
    console.error("[Relayer] ERROR: Cannot connect to zcashd");
    console.error(`  URL: ${config.zcashRpcUrl}`);
    console.error("  Run: ./scripts/start-devnet.sh");
    process.exit(1);
  }
  const zcashInfo = await zcash.getBlockchainInfo();
  console.log(`  ✓ Zcash: ${zcashInfo.chain} @ block ${zcashInfo.blocks}`);

  const starknetOk = await starknet.ping();
  if (!starknetOk) {
    console.error("[Relayer] ERROR: Cannot connect to Starknet devnet");
    console.error(`  URL: ${config.starknetRpcUrl}`);
    process.exit(1);
  }
  console.log(`  ✓ Starknet: connected`);

  // Initialize relay contract
  await starknet.initialize();
  console.log(`  ✓ Relay contract: ${config.zcashRelayContract}\n`);

  // Create pipeline
  const pipeline = new HeaderPipeline(zcash, starknet, config);

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[Relayer] Shutting down...");
    pipeline.stop();
    pipeline.printStats();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Periodic stats reporting
  const statsInterval = setInterval(() => {
    if (pipeline.getStats().headersRelayed > 0) {
      pipeline.printStats();
    }
  }, 60000); // Every minute

  // Start relay
  try {
    await pipeline.start();
  } finally {
    clearInterval(statsInterval);
  }
}

main().catch((err) => {
  console.error("[Relayer] Fatal error:", err);
  process.exit(1);
});
