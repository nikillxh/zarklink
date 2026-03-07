// ============================================================================
// Zarklink — Starknet Client Configuration
// ============================================================================

import { RpcProvider, Account } from "starknet";

// Contract addresses — loaded from env or defaults
export const config = {
  starknetRpcUrl: process.env.NEXT_PUBLIC_STARKNET_RPC_URL ?? "http://127.0.0.1:5050",
  zcashRpcUrl: process.env.NEXT_PUBLIC_ZCASH_RPC_URL ?? "http://127.0.0.1:18232",
  bridgeAddress: process.env.NEXT_PUBLIC_BRIDGE_ADDRESS ?? "",
  registryAddress: process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "",
  poolAddress: process.env.NEXT_PUBLIC_POOL_ADDRESS ?? "",
  relayAddress: process.env.NEXT_PUBLIC_RELAY_ADDRESS ?? "",
  wzecAddress: process.env.NEXT_PUBLIC_WZEC_ADDRESS ?? "",
  oracleAddress: process.env.NEXT_PUBLIC_ORACLE_ADDRESS ?? "",
};

export function getProvider(): RpcProvider {
  return new RpcProvider({ nodeUrl: config.starknetRpcUrl });
}

export function getDevnetAccount(): Account {
  const addr = process.env.NEXT_PUBLIC_DEPLOYER_ADDRESS ?? "";
  const key = process.env.NEXT_PUBLIC_DEPLOYER_KEY ?? "";
  if (!addr || !key) throw new Error("Devnet account not configured");
  return new Account({ provider: getProvider(), address: addr, signer: key });
}

// ── Minimal ABIs ─────────────────────────────────────────────────────────────

export const BRIDGE_ABI = [
  {
    type: "function", name: "get_fee_rate", inputs: [],
    outputs: [{ type: "core::integer::u32" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_warranty_amount", inputs: [],
    outputs: [{ type: "core::integer::u256" }], state_mutability: "view",
  },
  {
    type: "function", name: "request_lock",
    inputs: [
      { name: "vault_id", type: "core::integer::u32" },
      { name: "mint_amount", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::felt252" }], state_mutability: "external",
  },
  {
    type: "function", name: "submit_burn",
    inputs: [
      { name: "amount", type: "core::integer::u256" },
      { name: "zcash_address", type: "core::felt252" },
    ],
    outputs: [{ type: "core::felt252" }], state_mutability: "external",
  },
];

export const REGISTRY_ABI = [
  {
    type: "function", name: "get_vault_count", inputs: [],
    outputs: [{ type: "core::integer::u32" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_vault_info",
    inputs: [{ name: "vault_id", type: "core::integer::u32" }],
    outputs: [
      { type: "core::starknet::contract_address::ContractAddress" },
      { type: "core::integer::u256" },
      { type: "core::integer::u8" },
      { type: "core::felt252" },
      { type: "core::integer::u32" },
      { type: "core::integer::u256" },
      { type: "core::integer::u256" },
    ],
    state_mutability: "view",
  },
  {
    type: "function", name: "register_vault",
    inputs: [
      { name: "collateral", type: "core::integer::u256" },
      { name: "zcash_address", type: "core::felt252" },
      { name: "collateral_ratio", type: "core::integer::u32" },
    ],
    outputs: [], state_mutability: "external",
  },
  {
    type: "function", name: "deposit_collateral",
    inputs: [{ name: "amount", type: "core::integer::u256" }],
    outputs: [], state_mutability: "external",
  },
];

export const RELAY_ABI = [
  {
    type: "function", name: "get_chain_tip", inputs: [],
    outputs: [{ type: "core::integer::u32" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_finalized_height", inputs: [],
    outputs: [{ type: "core::integer::u32" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_header_count", inputs: [],
    outputs: [{ type: "core::integer::u32" }], state_mutability: "view",
  },
];

export const POOL_ABI = [
  {
    type: "function", name: "get_pool_size", inputs: [],
    outputs: [{ type: "core::integer::u32" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_pool_capacity", inputs: [],
    outputs: [{ type: "core::integer::u256" }], state_mutability: "view",
  },
];

export const WZEC_ABI = [
  {
    type: "function", name: "total_supply", inputs: [],
    outputs: [{ type: "core::integer::u256" }], state_mutability: "view",
  },
  {
    type: "function", name: "balance_of",
    inputs: [{ name: "account", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ type: "core::integer::u256" }], state_mutability: "view",
  },
  {
    type: "function", name: "approve",
    inputs: [
      { name: "spender", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [{ type: "core::bool" }], state_mutability: "external",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function formatZec(zatoshi: bigint): string {
  return `${(Number(zatoshi) / 1e8).toFixed(8)} ZEC`;
}

export function shortAddr(addr: string, len = 6): string {
  if (addr.length <= len * 2 + 2) return addr;
  return `${addr.slice(0, len + 2)}...${addr.slice(-len)}`;
}

export function vaultStatusLabel(status: number): { label: string; color: string } {
  switch (status) {
    case 0: return { label: "Active", color: "badge-success" };
    case 1: return { label: "Suspended", color: "badge-warning" };
    case 2: return { label: "Liquidated", color: "badge-error" };
    default: return { label: "Unknown", color: "badge-info" };
  }
}
