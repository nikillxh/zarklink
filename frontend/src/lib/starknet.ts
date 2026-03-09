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
// These match the actual Cairo contract interfaces in contracts/src/

export const BRIDGE_ABI = [
  {
    type: "function", name: "get_fee_rate", inputs: [],
    outputs: [{ type: "core::integer::u256" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_warranty_amount", inputs: [],
    outputs: [{ type: "core::integer::u256" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_issue_count", inputs: [],
    outputs: [{ type: "core::integer::u32" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_redeem_count", inputs: [],
    outputs: [{ type: "core::integer::u32" }], state_mutability: "view",
  },
  {
    type: "function", name: "request_lock",
    inputs: [
      { name: "mint_amount", type: "core::integer::u256" },
      { name: "warranty_collateral", type: "core::integer::u256" },
    ],
    outputs: [{ type: "(core::felt252, core::felt252)" }], state_mutability: "external",
  },
  {
    type: "function", name: "submit_mint",
    inputs: [
      { name: "request_id", type: "core::felt252" },
      { name: "note_commitment", type: "core::felt252" },
      { name: "inclusion_proof", type: "core::array::Span::<core::felt252>" },
      { name: "block_height", type: "core::integer::u32" },
      { name: "note_ciphertext_hash", type: "core::felt252" },
      { name: "zk_proof", type: "core::array::Span::<core::felt252>" },
    ],
    outputs: [], state_mutability: "external",
  },
  {
    type: "function", name: "submit_burn",
    inputs: [
      { name: "note_commitment", type: "core::felt252" },
      { name: "note_ciphertext_hash", type: "core::felt252" },
      { name: "burn_amount", type: "core::integer::u256" },
      { name: "warranty_collateral", type: "core::integer::u256" },
      { name: "zk_proof", type: "core::array::Span::<core::felt252>" },
    ],
    outputs: [{ type: "core::felt252" }], state_mutability: "external",
  },
  {
    type: "function", name: "get_issue_request",
    inputs: [{ name: "request_id", type: "core::felt252" }],
    outputs: [
      { type: "core::felt252" },
      { type: "core::starknet::contract_address::ContractAddress" },
      { type: "core::integer::u32" },
      { type: "core::integer::u8" },
      { type: "core::felt252" },
      { type: "core::felt252" },
      { type: "core::felt252" },
      { type: "core::integer::u256" },
      { type: "core::integer::u256" },
      { type: "core::integer::u64" },
      { type: "core::integer::u64" },
    ],
    state_mutability: "view",
  },
  {
    type: "function", name: "get_redeem_request",
    inputs: [{ name: "request_id", type: "core::felt252" }],
    outputs: [
      { type: "core::felt252" },
      { type: "core::starknet::contract_address::ContractAddress" },
      { type: "core::integer::u32" },
      { type: "core::integer::u8" },
      { type: "core::felt252" },
      { type: "core::felt252" },
      { type: "core::integer::u256" },
      { type: "core::integer::u256" },
      { type: "core::integer::u64" },
      { type: "core::integer::u64" },
    ],
    state_mutability: "view",
  },
  {
    type: "function", name: "confirm_issue",
    inputs: [{ name: "request_id", type: "core::felt252" }],
    outputs: [], state_mutability: "external",
  },
  {
    type: "function", name: "confirm_redeem",
    inputs: [
      { name: "request_id", type: "core::felt252" },
      { name: "inclusion_proof", type: "core::array::Span::<core::felt252>" },
      { name: "block_height", type: "core::integer::u32" },
    ],
    outputs: [], state_mutability: "external",
  },
];

export const REGISTRY_ABI = [
  {
    type: "function", name: "get_vault_count", inputs: [],
    outputs: [{ type: "core::integer::u32" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_vault",
    inputs: [{ name: "vault_id", type: "core::integer::u32" }],
    outputs: [
      // VaultInfo struct fields
      { type: "core::starknet::contract_address::ContractAddress" }, // owner
      { type: "core::felt252" }, // zcash_addr_d
      { type: "core::felt252" }, // zcash_addr_pkd
      { type: "core::integer::u256" }, // collateral
      { type: "core::integer::u8" }, // status
      { type: "core::integer::u64" }, // last_proof_of_balance
      { type: "core::integer::u64" }, // last_proof_of_capacity
      { type: "core::integer::u64" }, // registered_at
      { type: "core::integer::u256" }, // total_issued
      { type: "core::integer::u256" }, // total_redeemed
    ],
    state_mutability: "view",
  },
  {
    type: "function", name: "is_vault_active",
    inputs: [{ name: "vault_id", type: "core::integer::u32" }],
    outputs: [{ type: "core::bool" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_vault_id_by_owner",
    inputs: [{ name: "owner", type: "core::starknet::contract_address::ContractAddress" }],
    outputs: [{ type: "core::integer::u32" }], state_mutability: "view",
  },
  {
    type: "function", name: "register_vault",
    inputs: [
      { name: "zcash_addr_d", type: "core::felt252" },
      { name: "zcash_addr_pkd", type: "core::felt252" },
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
  {
    type: "function", name: "get_commitment_root",
    inputs: [{ name: "block_height", type: "core::integer::u32" }],
    outputs: [{ type: "core::felt252" }], state_mutability: "view",
  },
  {
    type: "function", name: "is_finalized",
    inputs: [{ name: "block_height", type: "core::integer::u32" }],
    outputs: [{ type: "core::bool" }], state_mutability: "view",
  },
];

export const POOL_ABI = [
  {
    type: "function", name: "get_active_vault_count", inputs: [],
    outputs: [{ type: "core::integer::u32" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_pool_capacity", inputs: [],
    outputs: [{ type: "core::integer::u256" }], state_mutability: "view",
  },
  {
    type: "function", name: "get_total_deposited", inputs: [],
    outputs: [{ type: "core::integer::u256" }], state_mutability: "view",
  },
  {
    type: "function", name: "deposit_collateral",
    inputs: [{ name: "amount", type: "core::integer::u256" }],
    outputs: [], state_mutability: "external",
  },
  {
    type: "function", name: "withdraw_collateral",
    inputs: [{ name: "amount", type: "core::integer::u256" }],
    outputs: [], state_mutability: "external",
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
  {
    type: "function", name: "mint",
    inputs: [
      { name: "to", type: "core::starknet::contract_address::ContractAddress" },
      { name: "amount", type: "core::integer::u256" },
    ],
    outputs: [], state_mutability: "external",
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

/**
 * Map on-chain VaultStatus enum to display label + color.
 * Cairo enum: 0=Inactive, 1=Active, 2=Locked, 3=Suspended, 4=Liquidated
 */
export function vaultStatusLabel(status: number): { label: string; color: string } {
  switch (status) {
    case 0: return { label: "Inactive", color: "badge-info" };
    case 1: return { label: "Active", color: "badge-success" };
    case 2: return { label: "Locked", color: "badge-warning" };
    case 3: return { label: "Suspended", color: "badge-warning" };
    case 4: return { label: "Liquidated", color: "badge-error" };
    default: return { label: "Unknown", color: "badge-info" };
  }
}

/**
 * Decode a hex-encoded Cairo error string (e.g.
 * "0x496e73756666696369656e742062616c616e6365" → "Insufficient balance").
 * Also handles felt252-encoded short strings.
 */
export function decodeContractError(raw: string): string {
  // Try to extract hex error from common RPC error message patterns
  const hexMatch = raw.match(/0x([0-9a-fA-F]{8,})/);
  if (hexMatch) {
    try {
      const hex = hexMatch[1];
      const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      // Only return if it looks like readable text
      if (/^[\x20-\x7e]+$/.test(text)) return text;
    } catch { /* not valid UTF-8, fall through */ }
  }
  return raw;
}

/**
 * Parse a Starknet transaction error into a user-friendly message.
 */
export function friendlyTxError(err: unknown): { message: string; hints: string[] } {
  const raw = err instanceof Error ? err.message : String(err);
  const decoded = decodeContractError(raw);
  const hints: string[] = [];

  // Common contract errors
  if (decoded.includes("Insufficient balance") || raw.includes("Insufficient balance")) {
    return {
      message: "Insufficient wZEC balance for this operation.",
      hints: [
        "Your current account doesn't have enough wZEC.",
        "Make sure you're using the same account that received the wZEC from an Issue.",
        "Check the account selector in the navbar.",
      ],
    };
  }
  if (decoded.includes("Warranty too low") || raw.includes("Warranty too low")) {
    return {
      message: "Warranty collateral too low.",
      hints: ["The warranty amount doesn't meet the protocol minimum."],
    };
  }
  if (decoded.includes("No active vaults") || raw.includes("No active vaults")) {
    return {
      message: "No active vaults available.",
      hints: ["No vault is registered. Run: ./scripts/start-devnet.sh --services"],
    };
  }
  if (decoded.includes("Zero") || raw.includes("Zero")) {
    return {
      message: "Amount must be greater than zero.",
      hints: [],
    };
  }
  if (raw.includes("CONTRACT_NOT_FOUND") || raw.includes("not deployed")) {
    return {
      message: "Contracts not deployed.",
      hints: ["Run: ./scripts/start-devnet.sh --deploy"],
    };
  }
  if (decoded.includes("Not vault operator") || raw.includes("Not vault operator")) {
    return {
      message: "Not authorized as vault operator.",
      hints: ["Only the vault operator account can confirm/challenge."],
    };
  }

  return { message: decoded, hints };
}
