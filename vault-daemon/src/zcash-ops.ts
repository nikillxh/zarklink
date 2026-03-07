// ============================================================================
// Zarklink — Zcash Shielded Operations
// ============================================================================
// Manages Zcash shielded transactions for the vault operator.
// Handles note decryption, shielded sends, and balance queries.

export interface ShieldedNote {
  txid: string;
  jsindex: number;
  jsoutindex?: number;
  outindex?: number;
  confirmations: number;
  pool: string;
  amount: number;
  amountZat: number;
  memo: string;
  change: boolean;
  address?: string;
  blockheight: number;
  blockindex: number;
  blocktime: number;
}

export interface OperationResult {
  id: string;
  status: "success" | "failed" | "executing" | "queued";
  creation_time: number;
  result?: { txid: string };
  error?: { code: number; message: string };
}

export class ZcashOps {
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

    const json = (await response.json()) as { result?: T; error?: { message: string } };
    if (json.error) {
      throw new Error(`Zcash RPC: ${json.error.message}`);
    }
    return json.result as T;
  }

  /** Get all received shielded notes */
  async listReceivedNotes(
    minconf = 1,
    address?: string,
  ): Promise<ShieldedNote[]> {
    if (address) {
      return this.rpc<ShieldedNote[]>("z_listreceivedbyaddress", [
        address,
        minconf,
      ]);
    }
    // List all shielded addresses and their notes
    const addresses = await this.listShieldedAddresses();
    const allNotes: ShieldedNote[] = [];
    for (const addr of addresses) {
      const notes = await this.rpc<ShieldedNote[]>(
        "z_listreceivedbyaddress",
        [addr, minconf],
      );
      allNotes.push(...notes);
    }
    return allNotes;
  }

  /** Get total shielded balance */
  async getShieldedBalance(address?: string): Promise<number> {
    if (address) {
      return this.rpc<number>("z_getbalance", [address]);
    }
    return this.rpc<number>("z_gettotalbalance").then((b: any) =>
      parseFloat(b.private),
    );
  }

  /** Send a shielded transaction */
  async shieldedSend(
    fromAddress: string,
    toAddress: string,
    amount: number,
    memo?: string,
  ): Promise<string> {
    const recipients = [
      {
        address: toAddress,
        amount,
        ...(memo ? { memo: Buffer.from(memo).toString("hex") } : {}),
      },
    ];

    const opid = await this.rpc<string>("z_sendmany", [
      fromAddress,
      recipients,
      1, // minconf
      0.0001, // fee
    ]);

    // Wait for operation to complete
    return this.waitForOperation(opid);
  }

  /** Wait for an async operation to complete */
  async waitForOperation(opid: string, timeoutMs = 120000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const results = await this.rpc<OperationResult[]>(
        "z_getoperationresult",
        [[opid]],
      );

      if (results.length > 0) {
        const result = results[0];
        if (result.status === "success" && result.result) {
          return result.result.txid;
        }
        if (result.status === "failed") {
          throw new Error(
            `Operation failed: ${result.error?.message ?? "unknown"}`,
          );
        }
      }

      // Still pending, check status
      const statuses = await this.rpc<OperationResult[]>(
        "z_getoperationstatus",
        [[opid]],
      );
      if (statuses.length > 0 && statuses[0].status === "failed") {
        throw new Error(
          `Operation failed: ${statuses[0].error?.message ?? "unknown"}`,
        );
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Operation ${opid} timed out after ${timeoutMs}ms`);
  }

  /** List all shielded (Sapling) addresses */
  async listShieldedAddresses(): Promise<string[]> {
    return this.rpc<string[]>("z_listaddresses");
  }

  /** Generate a new Sapling address */
  async newShieldedAddress(): Promise<string> {
    return this.rpc<string>("z_getnewaddress", ["sapling"]);
  }

  /** Get operation status by ID */
  async getOperationStatus(opid: string): Promise<OperationResult | null> {
    const results = await this.rpc<OperationResult[]>(
      "z_getoperationstatus",
      [[opid]],
    );
    return results.length > 0 ? results[0] : null;
  }

  /** Mine blocks (regtest only) */
  async generateBlocks(count: number): Promise<string[]> {
    // Get a transparent address for mining rewards
    const addr = await this.rpc<string>("getnewaddress", [""]);
    return this.rpc<string[]>("generatetoaddress", [count, addr]);
  }

  /** Verify connectivity */
  async ping(): Promise<boolean> {
    try {
      await this.rpc("getblockcount");
      return true;
    } catch {
      return false;
    }
  }
}
