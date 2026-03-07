// ============================================================================
// Zarklink — Zcash RPC Client
// ============================================================================
// Connects to zcashd via JSON-RPC to fetch block headers and info.

export interface ZcashBlockHeader {
  hash: string;
  confirmations: number;
  height: number;
  version: number;
  merkleroot: string;
  finalsaplingroot: string;
  time: number;
  bits: string;
  nonce: string;
  previousblockhash?: string;
}

export interface ZcashBlockInfo {
  hash: string;
  height: number;
  tx: string[];
}

export class ZcashClient {
  private url: string;
  private auth: string;

  constructor(rpcUrl: string, rpcUser: string, rpcPass: string) {
    this.url = rpcUrl;
    this.auth = Buffer.from(`${rpcUser}:${rpcPass}`).toString("base64");
  }

  private async rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${this.auth}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`Zcash RPC error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as { result?: T; error?: { message: string } };
    if (json.error) {
      throw new Error(`Zcash RPC: ${json.error.message}`);
    }
    return json.result as T;
  }

  /** Get current block count (chain height) */
  async getBlockCount(): Promise<number> {
    return this.rpc<number>("getblockcount");
  }

  /** Get block hash at a given height */
  async getBlockHash(height: number): Promise<string> {
    return this.rpc<string>("getblockhash", [height]);
  }

  /** Get block header by hash */
  async getBlockHeader(hash: string): Promise<ZcashBlockHeader> {
    return this.rpc<ZcashBlockHeader>("getblockheader", [hash, true]);
  }

  /** Get block header at a given height */
  async getBlockHeaderByHeight(height: number): Promise<ZcashBlockHeader> {
    const hash = await this.getBlockHash(height);
    return this.getBlockHeader(hash);
  }

  /** Get headers for a range of heights */
  async getBlockHeaders(startHeight: number, count: number): Promise<ZcashBlockHeader[]> {
    const headers: ZcashBlockHeader[] = [];
    const endHeight = Math.min(startHeight + count, await this.getBlockCount());

    for (let h = startHeight; h <= endHeight; h++) {
      headers.push(await this.getBlockHeaderByHeight(h));
    }
    return headers;
  }

  /** Get blockchain info */
  async getBlockchainInfo(): Promise<{
    chain: string;
    blocks: number;
    headers: number;
    bestblockhash: string;
  }> {
    return this.rpc("getblockchaininfo");
  }

  /** Check node connectivity */
  async ping(): Promise<boolean> {
    try {
      await this.getBlockCount();
      return true;
    } catch {
      return false;
    }
  }
}
