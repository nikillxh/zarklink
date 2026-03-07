// ============================================================================
// Zarklink — Header Relay Pipeline
// ============================================================================
// Monitors Zcash for new blocks and relays headers to Starknet.
// Handles batching, retries, reorg detection, and graceful shutdown.

import { ZcashClient, type ZcashBlockHeader } from "./zcash-client.js";
import { StarknetRelayClient } from "./starknet-client.js";
import type { RelayerConfig } from "./config.js";

export interface PipelineStats {
  headersRelayed: number;
  batchesSubmitted: number;
  lastRelayedHeight: number;
  zcashTip: number;
  starknetTip: number;
  errors: number;
  startedAt: Date;
}

export class HeaderPipeline {
  private zcash: ZcashClient;
  private starknet: StarknetRelayClient;
  private config: RelayerConfig;
  private running = false;
  private stats: PipelineStats;
  private logger: (msg: string) => void;

  constructor(
    zcash: ZcashClient,
    starknet: StarknetRelayClient,
    config: RelayerConfig,
    logger: (msg: string) => void = console.log,
  ) {
    this.zcash = zcash;
    this.starknet = starknet;
    this.config = config;
    this.logger = logger;
    this.stats = {
      headersRelayed: 0,
      batchesSubmitted: 0,
      lastRelayedHeight: config.startHeight,
      zcashTip: 0,
      starknetTip: 0,
      errors: 0,
      startedAt: new Date(),
    };
  }

  /** Start the relay loop */
  async start(): Promise<void> {
    this.running = true;
    this.stats.startedAt = new Date();
    this.logger("[Pipeline] Starting header relay pipeline...");

    // Sync initial state from Starknet relay contract
    try {
      const starknetTip = await this.starknet.getChainTip();
      if (starknetTip > this.stats.lastRelayedHeight) {
        this.stats.lastRelayedHeight = starknetTip;
        this.logger(`[Pipeline] Resuming from Starknet relay tip: ${starknetTip}`);
      }
    } catch (err) {
      this.logger(`[Pipeline] Could not fetch Starknet tip, starting from ${this.stats.lastRelayedHeight}`);
    }

    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        this.stats.errors++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger(`[Pipeline] Error: ${msg}`);
      }

      // Wait before next poll
      await this.sleep(this.config.pollIntervalMs);
    }

    this.logger("[Pipeline] Pipeline stopped.");
  }

  /** Stop the relay loop */
  stop(): void {
    this.running = false;
    this.logger("[Pipeline] Stopping pipeline...");
  }

  /** Single tick: check for new blocks and relay */
  async tick(): Promise<void> {
    // Get current Zcash height
    const zcashHeight = await this.zcash.getBlockCount();
    this.stats.zcashTip = zcashHeight;

    const nextHeight = this.stats.lastRelayedHeight + 1;

    // No new blocks
    if (nextHeight > zcashHeight) {
      return;
    }

    // Calculate batch
    const batchEnd = Math.min(
      nextHeight + this.config.batchSize - 1,
      zcashHeight,
    );
    const count = batchEnd - nextHeight + 1;

    this.logger(
      `[Pipeline] Relaying blocks ${nextHeight}–${batchEnd} (${count} headers)`,
    );

    // Fetch headers from Zcash
    const headers: ZcashBlockHeader[] = [];
    for (let h = nextHeight; h <= batchEnd; h++) {
      const header = await this.zcash.getBlockHeaderByHeight(h);
      headers.push(header);
    }

    // Detect potential reorg: verify last known header still matches
    if (this.stats.lastRelayedHeight > 0 && headers.length > 0) {
      const firstHeader = headers[0];
      if (firstHeader.previousblockhash) {
        const prevHeader = await this.zcash.getBlockHeaderByHeight(
          this.stats.lastRelayedHeight,
        );
        if (prevHeader.hash !== firstHeader.previousblockhash) {
          this.logger(
            `[Pipeline] REORG DETECTED at height ${this.stats.lastRelayedHeight}!`,
          );
          // Rollback: find common ancestor
          await this.handleReorg();
          return;
        }
      }
    }

    // Submit batch to Starknet
    if (headers.length === 1) {
      const txHash = await this.starknet.submitHeader(headers[0]);
      this.logger(`[Pipeline] Submitted 1 header, tx: ${txHash}`);
    } else {
      const txHash = await this.starknet.submitHeadersBatch(headers);
      this.logger(`[Pipeline] Submitted ${headers.length} headers, tx: ${txHash}`);
    }

    // Update stats
    this.stats.headersRelayed += headers.length;
    this.stats.batchesSubmitted++;
    this.stats.lastRelayedHeight = batchEnd;
    this.stats.starknetTip = batchEnd;
  }

  /** Handle chain reorganization */
  private async handleReorg(): Promise<void> {
    this.logger("[Pipeline] Handling chain reorg...");
    // Walk back to find common ancestor
    let checkHeight = this.stats.lastRelayedHeight;
    const maxRollback = Math.min(24, checkHeight);

    for (let i = 0; i < maxRollback; i++) {
      checkHeight--;
      if (checkHeight <= 0) break;

      // In production, compare stored header hash with Zcash
      // For now, just rollback to a safe depth
    }

    this.stats.lastRelayedHeight = Math.max(0, checkHeight);
    this.logger(`[Pipeline] Rolled back to height ${this.stats.lastRelayedHeight}`);
  }

  /** Get current pipeline statistics */
  getStats(): PipelineStats {
    return { ...this.stats };
  }

  /** Print formatted stats */
  printStats(): void {
    const s = this.stats;
    const uptime = Math.floor((Date.now() - s.startedAt.getTime()) / 1000);
    this.logger(
      [
        "\n--- Relay Pipeline Stats ---",
        `  Uptime:           ${uptime}s`,
        `  Headers relayed:  ${s.headersRelayed}`,
        `  Batches sent:     ${s.batchesSubmitted}`,
        `  Last height:      ${s.lastRelayedHeight}`,
        `  Zcash tip:        ${s.zcashTip}`,
        `  Starknet tip:     ${s.starknetTip}`,
        `  Errors:           ${s.errors}`,
        "----------------------------\n",
      ].join("\n"),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
