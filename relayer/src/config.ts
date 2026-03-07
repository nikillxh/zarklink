// ============================================================================
// Zarklink — Relayer Configuration
// ============================================================================

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

// Load .env.devnet from project root
dotenvConfig({ path: resolve(import.meta.dirname, "../../.env.devnet") });

export interface RelayerConfig {
  // Zcash node
  zcashRpcUrl: string;
  zcashRpcUser: string;
  zcashRpcPass: string;

  // Starknet
  starknetRpcUrl: string;
  relayerPrivateKey: string;
  relayerAddress: string;

  // Contract addresses (populated after deployment)
  zcashRelayContract: string;

  // Relay settings
  pollIntervalMs: number;
  batchSize: number;
  finalityDepth: number;
  startHeight: number;
}

export function loadConfig(): RelayerConfig {
  return {
    zcashRpcUrl: process.env.ZCASH_RPC_URL ?? "http://127.0.0.1:18232",
    zcashRpcUser: process.env.ZCASH_RPC_USER ?? "zarklink",
    zcashRpcPass: process.env.ZCASH_RPC_PASS ?? "",

    starknetRpcUrl: process.env.STARKNET_RPC_URL ?? "http://127.0.0.1:5050",
    relayerPrivateKey: process.env.RELAYER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY ?? "",
    relayerAddress: process.env.RELAYER_ADDRESS ?? process.env.DEPLOYER_ADDRESS ?? "",

    zcashRelayContract: process.env.ZCASH_RELAY_CONTRACT ?? "",

    pollIntervalMs: parseInt(process.env.RELAY_POLL_INTERVAL_MS ?? "5000", 10),
    batchSize: parseInt(process.env.RELAY_BATCH_SIZE ?? "10", 10),
    finalityDepth: parseInt(process.env.FINALITY_DEPTH ?? "24", 10),
    startHeight: parseInt(process.env.RELAY_START_HEIGHT ?? "0", 10),
  };
}
