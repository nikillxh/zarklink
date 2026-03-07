// ============================================================================
// Zarklink — Vault Daemon Configuration
// ============================================================================

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";

dotenvConfig({ path: resolve(import.meta.dirname, "../../.env.devnet") });

export interface VaultDaemonConfig {
  // Zcash
  zcashRpcUrl: string;
  zcashRpcUser: string;
  zcashRpcPass: string;

  // Starknet
  starknetRpcUrl: string;
  vaultPrivateKey: string;
  vaultAddress: string;

  // Contract addresses
  bridgeProtocolContract: string;
  vaultRegistryContract: string;
  vaultPoolContract: string;
  wzecTokenContract: string;

  // Vault settings
  pollIntervalMs: number;
  autoConfirm: boolean;
  proofSubmitIntervalMs: number;
}

export function loadConfig(): VaultDaemonConfig {
  return {
    zcashRpcUrl: process.env.ZCASH_RPC_URL ?? "http://127.0.0.1:18232",
    zcashRpcUser: process.env.ZCASH_RPC_USER ?? "zarklink",
    zcashRpcPass: process.env.ZCASH_RPC_PASS ?? "",

    starknetRpcUrl: process.env.STARKNET_RPC_URL ?? "http://127.0.0.1:5050",
    vaultPrivateKey: process.env.VAULT_PRIVATE_KEY ?? "",
    vaultAddress: process.env.VAULT_ADDRESS ?? "",

    bridgeProtocolContract: process.env.BRIDGE_PROTOCOL_CONTRACT ?? "",
    vaultRegistryContract: process.env.VAULT_REGISTRY_CONTRACT ?? "",
    vaultPoolContract: process.env.VAULT_POOL_CONTRACT ?? "",
    wzecTokenContract: process.env.WZEC_TOKEN_CONTRACT ?? "",

    pollIntervalMs: parseInt(process.env.VAULT_POLL_INTERVAL_MS ?? "3000", 10),
    autoConfirm: process.env.VAULT_AUTO_CONFIRM !== "false",
    proofSubmitIntervalMs: parseInt(
      process.env.VAULT_PROOF_INTERVAL_MS ?? "3600000",
      10,
    ),
  };
}
