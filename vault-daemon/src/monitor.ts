// ============================================================================
// Zarklink — Event Monitor
// ============================================================================
// Monitors Starknet contract events for issue/redeem requests assigned
// to this vault. Dispatches handlers for each event type.

import { RpcProvider, Account, Contract, events, num } from "starknet";
import type { VaultDaemonConfig } from "./config.js";

export interface BridgeEvent {
  type:
    | "LockRequested"
    | "MintSubmitted"
    | "BurnSubmitted"
    | "IssueConfirmed"
    | "IssueChallenged"
    | "RedeemConfirmed"
    | "RedeemChallenged"
    | "IssueExpired"
    | "RedeemExpired";
  requestId: string;
  data: Record<string, string>;
  blockNumber: number;
  transactionHash: string;
}

export type EventHandler = (event: BridgeEvent) => Promise<void>;

export class EventMonitor {
  private provider: RpcProvider;
  private account: Account;
  private config: VaultDaemonConfig;
  private running = false;
  private lastBlock = 0;
  private handlers: Map<string, EventHandler[]> = new Map();
  private logger: (msg: string) => void;

  constructor(
    config: VaultDaemonConfig,
    logger: (msg: string) => void = console.log,
  ) {
    this.config = config;
    this.provider = new RpcProvider({ nodeUrl: config.starknetRpcUrl });
    this.account = new Account({
      provider: this.provider,
      address: config.vaultAddress,
      signer: config.vaultPrivateKey,
    });
    this.logger = logger;
  }

  /** Register an event handler */
  on(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  /** Start monitoring events */
  async start(): Promise<void> {
    this.running = true;
    this.logger("[Monitor] Starting event monitor...");

    while (this.running) {
      try {
        await this.pollEvents();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger(`[Monitor] Poll error: ${msg}`);
      }
      await this.sleep(this.config.pollIntervalMs);
    }
  }

  /** Stop monitoring */
  stop(): void {
    this.running = false;
  }

  /** Poll for new events from the bridge protocol contract */
  private async pollEvents(): Promise<void> {
    if (!this.config.bridgeProtocolContract) return;

    try {
      // Get latest block
      const block = await this.provider.getBlockNumber();
      if (block <= this.lastBlock) return;

      // Fetch events from bridge contract
      const eventsResponse = await this.provider.getEvents({
        address: this.config.bridgeProtocolContract,
        from_block: { block_number: this.lastBlock + 1 },
        to_block: { block_number: block },
        chunk_size: 100,
        keys: [],
      });

      for (const event of eventsResponse.events) {
        const parsed = this.parseEvent(event);
        if (parsed) {
          await this.dispatchEvent(parsed);
        }
      }

      this.lastBlock = block;
    } catch (err) {
      // Devnet may not support getEvents, log and continue
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("not found") && !msg.includes("method")) {
        throw err;
      }
    }
  }

  /** Parse a raw Starknet event into our typed format */
  private parseEvent(rawEvent: any): BridgeEvent | null {
    // Event keys[0] is the event selector hash
    if (!rawEvent.keys || rawEvent.keys.length === 0) return null;

    const selector = rawEvent.keys[0];
    const data = rawEvent.data ?? [];

    // Map common event patterns
    // In production, compute keccak of event names and match selectors
    const event: BridgeEvent = {
      type: "LockRequested", // Will be refined by selector matching
      requestId: rawEvent.keys.length > 1 ? rawEvent.keys[1] : data[0] ?? "0x0",
      data: {},
      blockNumber: rawEvent.block_number ?? 0,
      transactionHash: rawEvent.transaction_hash ?? "",
    };

    // Store all data fields for handlers
    data.forEach((d: string, i: number) => {
      event.data[`field_${i}`] = d;
    });

    return event;
  }

  /** Dispatch event to registered handlers */
  private async dispatchEvent(event: BridgeEvent): Promise<void> {
    this.logger(
      `[Monitor] Event: ${event.type} request=${event.requestId.slice(0, 18)}...`,
    );

    const handlers = this.handlers.get(event.type) ?? [];
    const globalHandlers = this.handlers.get("*") ?? [];

    for (const handler of [...globalHandlers, ...handlers]) {
      try {
        await handler(event);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger(`[Monitor] Handler error: ${msg}`);
      }
    }
  }

  /** Execute a contract call */
  async execute(
    contractAddress: string,
    entrypoint: string,
    calldata: string[],
  ): Promise<string> {
    const tx = await this.account.execute({
      contractAddress,
      entrypoint,
      calldata,
    });
    await this.provider.waitForTransaction(tx.transaction_hash);
    return tx.transaction_hash;
  }

  /** Get account instance */
  getAccount(): Account {
    return this.account;
  }

  /** Get provider */
  getProvider(): RpcProvider {
    return this.provider;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
