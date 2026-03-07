// ============================================================================
// Zarklink — Starknet Client (Relayer)
// ============================================================================
// Interacts with the ZcashRelay contract on Starknet to submit headers.

import { Account, Contract, RpcProvider, CallData, num } from "starknet";
import type { ZcashBlockHeader } from "./zcash-client.js";

// BlockHeader struct matching the Cairo contract
export interface CairoBlockHeader {
  version: string;
  prev_block_hash: string;
  merkle_root: string;
  commitment_root: string;
  timestamp: string;
  bits: string;
  nonce: string;
  block_height: string;
}

/** Convert Zcash block header to Cairo-compatible format */
export function toCairoHeader(header: ZcashBlockHeader): CairoBlockHeader {
  return {
    version: `0x${header.version.toString(16)}`,
    prev_block_hash: header.previousblockhash
      ? `0x${header.previousblockhash.slice(0, 62)}`
      : "0x0",
    merkle_root: `0x${header.merkleroot.slice(0, 62)}`,
    commitment_root: `0x${header.finalsaplingroot.slice(0, 62)}`,
    timestamp: header.time.toString(),
    bits: `0x${header.bits}`,
    nonce: `0x${header.nonce.slice(0, 62)}`,
    block_height: header.height.toString(),
  };
}

export class StarknetRelayClient {
  private provider: RpcProvider;
  private account: Account;
  private relayContract: Contract | null = null;
  private contractAddress: string;

  constructor(
    rpcUrl: string,
    accountAddress: string,
    privateKey: string,
    relayContractAddress: string,
  ) {
    this.provider = new RpcProvider({ nodeUrl: rpcUrl });
    this.account = new Account({ provider: this.provider, address: accountAddress, signer: privateKey });
    this.contractAddress = relayContractAddress;
  }

  /** Initialize the relay contract instance (needs ABI) */
  async initialize(): Promise<void> {
    // For devnet, we can fetch ABI from the class
    // For now, use a manual ABI matching the contract interface
    const abi = [
      {
        type: "function",
        name: "submit_header",
        inputs: [
          {
            name: "header",
            type: "(core::integer::u32, core::felt252, core::felt252, core::felt252, core::integer::u32, core::integer::u32, core::felt252, core::integer::u32)",
          },
        ],
        outputs: [],
        state_mutability: "external",
      },
      {
        type: "function",
        name: "submit_headers_batch",
        inputs: [
          {
            name: "headers",
            type: "core::array::Span::<(core::integer::u32, core::felt252, core::felt252, core::felt252, core::integer::u32, core::integer::u32, core::felt252, core::integer::u32)>",
          },
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
        name: "get_finalized_height",
        inputs: [],
        outputs: [{ type: "core::integer::u32" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "get_header_count",
        inputs: [],
        outputs: [{ type: "core::integer::u32" }],
        state_mutability: "view",
      },
      {
        type: "function",
        name: "is_finalized",
        inputs: [{ name: "block_height", type: "core::integer::u32" }],
        outputs: [{ type: "core::bool" }],
        state_mutability: "view",
      },
    ];

    this.relayContract = new Contract({ abi: abi, address: this.contractAddress, providerOrAccount: this.account });
  }

  /** Submit a single header to the relay */
  async submitHeader(header: ZcashBlockHeader): Promise<string> {
    const cairoHeader = toCairoHeader(header);
    const calldata = CallData.compile({
      header: cairoHeader,
    });

    const tx = await this.account.execute({
      contractAddress: this.contractAddress,
      entrypoint: "submit_header",
      calldata,
    });

    await this.provider.waitForTransaction(tx.transaction_hash);
    return tx.transaction_hash;
  }

  /** Submit a batch of headers */
  async submitHeadersBatch(headers: ZcashBlockHeader[]): Promise<string> {
    const cairoHeaders = headers.map(toCairoHeader);
    const calldata = CallData.compile({
      headers: cairoHeaders,
    });

    const tx = await this.account.execute({
      contractAddress: this.contractAddress,
      entrypoint: "submit_headers_batch",
      calldata,
    });

    await this.provider.waitForTransaction(tx.transaction_hash);
    return tx.transaction_hash;
  }

  /** Get current chain tip from the relay contract */
  async getChainTip(): Promise<number> {
    if (!this.relayContract) throw new Error("Not initialized");
    const result = await this.relayContract.call("get_chain_tip");
    return Number(result);
  }

  /** Get finalized height from the relay contract */
  async getFinalizedHeight(): Promise<number> {
    if (!this.relayContract) throw new Error("Not initialized");
    const result = await this.relayContract.call("get_finalized_height");
    return Number(result);
  }

  /** Get total submitted header count */
  async getHeaderCount(): Promise<number> {
    if (!this.relayContract) throw new Error("Not initialized");
    const result = await this.relayContract.call("get_header_count");
    return Number(result);
  }

  /** Check if Starknet devnet is reachable */
  async ping(): Promise<boolean> {
    try {
      await this.provider.getChainId();
      return true;
    } catch {
      return false;
    }
  }
}
