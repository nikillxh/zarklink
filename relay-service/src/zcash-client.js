/**
 * Zcash RPC Client
 * Communicates with Zcash full node
 */

import axios from 'axios';

export class ZcashClient {
  constructor(config) {
    this.rpcUrl = config.zcashRpcUrl;
    this.rpcUser = config.zcashRpcUser;
    this.rpcPassword = config.zcashRpcPassword;
    this.client = null;
  }
  
  async connect() {
    this.client = axios.create({
      baseURL: this.rpcUrl,
      auth: this.rpcUser && this.rpcPassword ? {
        username: this.rpcUser,
        password: this.rpcPassword,
      } : undefined,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    // Test connection
    await this.getBlockchainInfo();
  }
  
  async rpc(method, params = []) {
    const response = await this.client.post('/', {
      jsonrpc: '1.0',
      id: Date.now(),
      method,
      params,
    });
    
    if (response.data.error) {
      throw new Error(`RPC error: ${response.data.error.message}`);
    }
    
    return response.data.result;
  }
  
  async getBlockchainInfo() {
    return await this.rpc('getblockchaininfo');
  }
  
  async getBlockHash(height) {
    return await this.rpc('getblockhash', [height]);
  }
  
  async getBlock(hash, verbosity = 1) {
    return await this.rpc('getblock', [hash, verbosity]);
  }
  
  async getRawBlock(hash) {
    return await this.rpc('getblock', [hash, 0]);
  }
  
  async getRawBlockHeader(hash) {
    // Get raw block and extract header (first 1487 bytes = 2974 hex chars for Zcash with Equihash)
    // But we only need the first 140 bytes (280 hex chars) for the fixed header part
    const rawBlock = await this.getRawBlock(hash);
    
    // Zcash block header structure:
    // - nVersion: 4 bytes
    // - hashPrevBlock: 32 bytes  
    // - hashMerkleRoot: 32 bytes
    // - hashFinalSaplingRoot: 32 bytes
    // - nTime: 4 bytes
    // - nBits: 4 bytes
    // - nNonce: 32 bytes
    // Total fixed part: 140 bytes (280 hex chars)
    // + nSolution: variable (1344 bytes for Equihash 200,9)
    
    return rawBlock.substring(0, 280);
  }
  
  async getSaplingRoot(hash) {
    const block = await this.getBlock(hash, 1);
    return block.finalsaplingroot;
  }
  
  async getBlockByHeight(height) {
    const hash = await this.getBlockHash(height);
    return await this.getBlock(hash, 2);
  }
}
