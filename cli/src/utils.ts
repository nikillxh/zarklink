// ============================================================================
// Zarklink — CLI Utilities
// ============================================================================

import { config as dotenvConfig } from "dotenv";
import { resolve } from "path";
import { Account, RpcProvider } from "starknet";

dotenvConfig({ path: resolve(import.meta.dirname, "../../.env.devnet") });

export interface CliConfig {
  zcashRpcUrl: string;
  zcashRpcUser: string;
  zcashRpcPass: string;
  starknetRpcUrl: string;
  bridgeAddress: string;
  vaultRegistryAddress: string;
  vaultPoolAddress: string;
  zcashRelayAddress: string;
  wzecAddress: string;
}

export function loadCliConfig(): CliConfig {
  return {
    zcashRpcUrl: process.env.ZCASH_RPC_URL ?? "http://127.0.0.1:18232",
    zcashRpcUser: process.env.ZCASH_RPC_USER ?? "zarklink",
    zcashRpcPass: process.env.ZCASH_RPC_PASS ?? "",
    starknetRpcUrl: process.env.STARKNET_RPC_URL ?? "http://127.0.0.1:5050",
    bridgeAddress: process.env.BRIDGE_PROTOCOL_ADDRESS ?? "",
    vaultRegistryAddress: process.env.VAULT_REGISTRY_ADDRESS ?? "",
    vaultPoolAddress: process.env.VAULT_POOL_ADDRESS ?? "",
    zcashRelayAddress: process.env.ZCASH_RELAY_ADDRESS ?? "",
    wzecAddress: process.env.WZEC_TOKEN_ADDRESS ?? "",
  };
}

export function getProvider(config?: CliConfig): RpcProvider {
  const cfg = config ?? loadCliConfig();
  return new RpcProvider({ nodeUrl: cfg.starknetRpcUrl });
}

export function getAccount(
  address: string,
  privateKey: string,
  config?: CliConfig,
): Account {
  const provider = getProvider(config);
  return new Account({ provider: provider, address: address, signer: privateKey });
}

export function getDefaultAccount(config?: CliConfig): Account {
  const addr = process.env.DEPLOYER_ADDRESS ?? "";
  const key = process.env.DEPLOYER_PRIVATE_KEY ?? "";
  if (!addr || !key) {
    throw new Error("DEPLOYER_ADDRESS and DEPLOYER_PRIVATE_KEY must be set");
  }
  return getAccount(addr, key, config);
}

/** Format a felt252 as a short hex string */
export function shortHex(felt: string, length = 10): string {
  if (felt.length <= length + 2) return felt;
  return `${felt.slice(0, length + 2)}...${felt.slice(-4)}`;
}

/** Format amount in zatoshi to ZEC */
export function formatZec(zatoshi: bigint): string {
  const zec = Number(zatoshi) / 1e8;
  return `${zec.toFixed(8)} ZEC`;
}

/** Zcash JSON-RPC call */
export async function zcashRpc<T = any>(
  configOrMethod: CliConfig | string,
  methodOrParams?: string | unknown[],
  maybeParams?: unknown[],
): Promise<T> {
  let config: CliConfig;
  let method: string;
  let params: unknown[];

  if (typeof configOrMethod === "string") {
    // Called as zcashRpc(method, params?)
    config = loadCliConfig();
    method = configOrMethod;
    params = (methodOrParams as unknown[] | undefined) ?? [];
  } else {
    // Called as zcashRpc(config, method, params?)
    config = configOrMethod;
    method = methodOrParams as string;
    params = maybeParams ?? [];
  }

  const auth = Buffer.from(
    `${config.zcashRpcUser}:${config.zcashRpcPass}`,
  ).toString("base64");

  const response = await fetch(config.zcashRpcUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    }),
  });

  const json = (await response.json()) as {
    result?: T;
    error?: { message: string };
  };
  if (json.error) throw new Error(`Zcash: ${json.error.message}`);
  return json.result as T;
}
