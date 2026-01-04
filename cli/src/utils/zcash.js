/**
 * Zcash Utilities
 * Helper functions for interacting with Zcash mainnet and testnet
 * 
 * This module is designed to work with PUBLIC APIs without requiring
 * a local zcashd node. It uses:
 * - lightwalletd gRPC endpoints (zec.rocks)
 * - Blockchair REST API (mainnet)
 * - Custom relay backend for testnet
 */

import axios from 'axios';
import { config } from '../config.js';
import blake2 from 'blake2';

// ============ PUBLIC API ENDPOINTS ============

// Public lightwalletd gRPC endpoints (used by Zashi wallet)
const LIGHTWALLETD_ENDPOINTS = {
  mainnet: [
    { host: 'zec.rocks', port: 443 },
    { host: 'na.zec.rocks', port: 443 },
    { host: 'sa.zec.rocks', port: 443 },
    { host: 'eu.zec.rocks', port: 443 },
    { host: 'ap.zec.rocks', port: 443 },
  ],
  testnet: [
    { host: 'testnet.zec.rocks', port: 443 },
  ],
};

// Public REST API endpoints
const REST_APIS = {
  // Blockchair supports mainnet Zcash
  blockchair: {
    mainnet: 'https://api.blockchair.com/zcash',
    testnet: null, // Not supported by Blockchair
  },
};

// UI explorer URLs
const BLOCK_EXPLORERS = {
  testnet: 'https://explorer.testnet.z.cash',
  mainnet: 'https://blockchair.com/zcash',
};

/**
 * Determine if we're on testnet
 */
function isTestnet() {
  return config.get ? config.get('zcash.network') === 'testnet' : config.zcash?.network === 'testnet';
}

/**
 * Get the best available API endpoint for the current network
 */
function getApiEndpoint() {
  const network = isTestnet() ? 'testnet' : 'mainnet';
  
  // Use Blockchair for mainnet
  if (!isTestnet() && REST_APIS.blockchair.mainnet) {
    return { type: 'blockchair', url: REST_APIS.blockchair.mainnet };
  }
  
  // For testnet, there's no public API - operations will need RPC
  // But we can still provide basic info
  if (isTestnet()) {
    return { type: 'testnet_limited', url: null };
  }
  
  throw new Error(`No API endpoint available for ${network}`);
}

/**
 * Get configured RPC URL with fallbacks (for backward compatibility)
 * Note: This is optional - the CLI works without local zcashd for mainnet
 */
function getRpcConfig() {
  const zcashConfig = config.get ? {
    rpcUrl: config.get('zcash.rpcUrl'),
    rpcUser: config.get('zcash.rpcUser'),
    rpcPassword: config.get('zcash.rpcPassword'),
    network: config.get('zcash.network'),
  } : config.zcash;
  
  return zcashConfig;
}

/**
 * Make API call to public Zcash API
 * For mainnet: Uses Blockchair
 * For testnet: Requires local RPC or returns limited data
 */
async function publicApi(endpoint, options = {}) {
  const api = getApiEndpoint();
  
  if (api.type === 'testnet_limited') {
    // For testnet, throw helpful error if no RPC configured
    const { rpcUrl } = getRpcConfig();
    if (!rpcUrl) {
      throw new Error('Testnet requires local zcashd node or configured RPC. Set ZCASH_RPC_URL in .env');
    }
    // Fall through to RPC-based implementation
    throw new Error('TESTNET_USE_RPC');
  }
  
  const url = `${api.url}${endpoint}`;
  
  try {
    const response = await axios.get(url, {
      timeout: options.timeout || 15000,
      ...options,
    });
    return { data: response.data, source: api.type };
  } catch (error) {
    throw error;
  }
}

/**
 * Make RPC call to Zcash node (optional - only if local node configured)
 */
export async function zcashRpc(method, params = []) {
  const { rpcUrl, rpcUser, rpcPassword } = getRpcConfig();
  
  if (!rpcUrl) {
    throw new Error('No Zcash RPC configured. Use public API methods or configure a local node.');
  }
  
  try {
    const response = await axios.post(
      rpcUrl,
      {
        jsonrpc: '1.0',
        id: Date.now(),
        method,
        params,
      },
      {
        auth: rpcUser && rpcPassword ? {
          username: rpcUser,
          password: rpcPassword,
        } : undefined,
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );
    
    if (response.data.error) {
      throw new Error(`Zcash RPC error: ${response.data.error.message}`);
    }
    
    return response.data.result;
  } catch (error) {
    if (error.response) {
      throw new Error(`Zcash RPC failed: ${error.response.status} ${error.response.statusText}`);
    }
    throw error;
  }
}

/**
 * Get blockchain info - uses public API for mainnet, RPC for testnet
 */
export async function getBlockchainInfo() {
  // For testnet, always try RPC first
  if (isTestnet()) {
    try {
      return await zcashRpc('getblockchaininfo');
    } catch (rpcError) {
      throw new Error(`Testnet requires local zcashd. Error: ${rpcError.message}`);
    }
  }
  
  // For mainnet, use Blockchair API
  try {
    const { data, source } = await publicApi('/stats');
    
    if (source === 'blockchair') {
      return {
        chain: 'main',
        blocks: data.data?.blocks || 0,
        bestblockhash: data.data?.best_block_hash || '',
        verificationprogress: 1,
        chainwork: '',
        connections: data.data?.nodes || 0,
        difficulty: data.data?.difficulty || 0,
        _source: 'blockchair',
      };
    }
    throw new Error('Unknown API response format');
  } catch (apiError) {
    // Try local RPC as fallback
    try {
      return await zcashRpc('getblockchaininfo');
    } catch (rpcError) {
      throw new Error(`Cannot connect to Zcash network: ${apiError.message}`);
    }
  }
}

/**
 * Get block by height - uses public API for mainnet, RPC for testnet
 */
export async function getBlockByHeight(height, verbosity = 2) {
  // For testnet, use RPC
  if (isTestnet()) {
    const hash = await zcashRpc('getblockhash', [height]);
    return await zcashRpc('getblock', [hash, verbosity]);
  }
  
  // For mainnet, use Blockchair
  try {
    const { data, source } = await publicApi(`/block/${height}`);
    
    if (source === 'blockchair') {
      return normalizeBlockchairBlock(data);
    }
    throw new Error('Unknown API response');
  } catch (apiError) {
    // Try local RPC as fallback
    try {
      const hash = await zcashRpc('getblockhash', [height]);
      return await zcashRpc('getblock', [hash, verbosity]);
    } catch (rpcError) {
      throw new Error(`Cannot fetch block ${height}: ${apiError.message}`);
    }
  }
}

/**
 * Get block by hash - uses public API for mainnet, RPC for testnet
 */
export async function getBlockByHash(hash, verbosity = 2) {
  // For testnet, use RPC
  if (isTestnet()) {
    return await zcashRpc('getblock', [hash, verbosity]);
  }
  
  // For mainnet, use Blockchair
  try {
    const { data, source } = await publicApi(`/block/${hash}`);
    
    if (source === 'blockchair') {
      return normalizeBlockchairBlock(data);
    }
    throw new Error('Unknown API response');
  } catch (apiError) {
    // Try local RPC as fallback
    try {
      return await zcashRpc('getblock', [hash, verbosity]);
    } catch (rpcError) {
      throw new Error(`Cannot fetch block ${hash}: ${apiError.message}`);
    }
  }
}

/**
 * Normalize Blockchair block response to standard format
 */
function normalizeBlockchairBlock(blockchairData) {
  const block = blockchairData.data?.[Object.keys(blockchairData.data)[0]] || blockchairData;
  
  return {
    hash: block.hash,
    height: block.id || block.height,
    version: block.version,
    merkleroot: block.merkle_root,
    time: new Date(block.time).getTime() / 1000,
    nonce: block.nonce,
    bits: block.bits,
    difficulty: block.difficulty,
    previousblockhash: null, // Not directly available, need separate call
    confirmations: 1, // Blockchair doesn't provide this directly
    size: block.size,
    tx: [], // Transactions require separate call
    finalsaplingroot: block.final_sapling_root,
    _source: 'blockchair',
  };
}

/**
 * Get raw block header - requires RPC (full header not available via API)
 */
export async function getRawBlockHeader(hash) {
  try {
    const block = await zcashRpc('getblock', [hash, 0]);
    // First 140 bytes (280 hex chars) is the header
    return block.substring(0, 280);
  } catch (rpcError) {
    // Public APIs don't provide raw hex
    console.warn('Raw block header requires local zcashd node');
    return null;
  }
}

/**
 * Get Sapling commitment tree root from block
 */
export async function getSaplingRoot(blockHash) {
  const block = await getBlockByHash(blockHash, 1);
  return block.finalsaplingroot || block.finalSaplingRoot;
}

/**
 * Get current chain tip - uses public API
 */
export async function getChainTip() {
  const info = await getBlockchainInfo();
  return {
    height: info.blocks,
    hash: info.bestblockhash,
  };
}

/**
 * Parse Zcash block header
 * Header structure (1487 bytes for Zcash):
 * - nVersion: 4 bytes
 * - hashPrevBlock: 32 bytes
 * - hashMerkleRoot: 32 bytes  
 * - hashFinalSaplingRoot: 32 bytes
 * - nTime: 4 bytes
 * - nBits: 4 bytes
 * - nNonce: 32 bytes
 * - nSolution: variable (1344 bytes for Equihash(200,9))
 */
export function parseBlockHeader(headerHex) {
  const header = Buffer.from(headerHex, 'hex');
  
  return {
    version: header.readUInt32LE(0),
    prevBlockHash: header.slice(4, 36).reverse().toString('hex'),
    merkleRoot: header.slice(36, 68).reverse().toString('hex'),
    saplingRoot: header.slice(68, 100).reverse().toString('hex'),
    timestamp: header.readUInt32LE(100),
    bits: header.readUInt32LE(104),
    nonce: header.slice(108, 140).toString('hex'),
    // Solution follows after nonce
  };
}

/**
 * Compute block hash using BLAKE2b-256 with Zcash personalization
 */
export function computeBlockHash(headerBytes) {
  const h = blake2.createHash('blake2b', { 
    digestLength: 32,
    personalization: Buffer.from('ZcashBlockHash\x00\x00', 'ascii')
  });
  h.update(headerBytes);
  return h.digest().reverse().toString('hex');
}

/**
 * Encode block header for Starknet submission
 * Returns array of felt252 values
 */
export function encodeHeaderForStarknet(header) {
  // Split each 32-byte hash into low/high u128 for u256
  const splitU256 = (hexStr) => {
    const buf = Buffer.from(hexStr, 'hex');
    const low = BigInt('0x' + buf.slice(16, 32).toString('hex'));
    const high = BigInt('0x' + buf.slice(0, 16).toString('hex'));
    return [low.toString(), high.toString()];
  };
  
  const encoded = [
    ...splitU256(header.prevBlockHash),  // [0-1]
    ...splitU256(header.merkleRoot),     // [2-3]
    ...splitU256(header.saplingRoot),    // [4-5]
    header.timestamp.toString(),          // [6]
    header.bits.toString(),               // [7]
  ];
  
  return encoded;
}

/**
 * Get z_viewingkey from a wallet
 */
export async function getViewingKey(zaddr) {
  return await zcashRpc('z_exportviewingkey', [zaddr]);
}

/**
 * List unspent notes for an address
 */
export async function listUnspentNotes(minconf = 1, maxconf = 9999999, includeWatchonly = true, addresses = null) {
  return await zcashRpc('z_listunspent', [minconf, maxconf, includeWatchonly, addresses]);
}

/**
 * Create and send a shielded transaction
 */
export async function sendShielded(fromAddr, toAddr, amount, memo = null) {
  const outputs = [{
    address: toAddr,
    amount: amount,
    memo: memo,
  }];
  
  const opid = await zcashRpc('z_sendmany', [fromAddr, outputs]);
  return opid;
}

/**
 * Get operation status
 */
export async function getOperationStatus(opid) {
  const results = await zcashRpc('z_getoperationresult', [[opid]]);
  return results[0];
}

/**
 * Wait for operation to complete
 */
export async function waitForOperation(opid, onStatus) {
  while (true) {
    const results = await zcashRpc('z_getoperationstatus', [[opid]]);
    const op = results[0];
    
    if (onStatus) {
      onStatus(op.status);
    }
    
    if (op.status === 'success') {
      // Get final result
      const final = await getOperationStatus(opid);
      return final;
    }
    
    if (op.status === 'failed') {
      throw new Error(`Operation failed: ${op.error.message}`);
    }
    
    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// ============ Testnet Specific Functions ============

/**
 * Get testnet faucet info
 */
export function getTestnetFaucetUrl() {
  return 'https://faucet.zecpages.com/';
}

/**
 * Get explorer URL for transaction
 */
export function getExplorerTxUrl(txid) {
  const baseUrl = BLOCK_EXPLORERS[isTestnet() ? 'testnet' : 'mainnet'];
  return `${baseUrl}/tx/${txid}`;
}

/**
 * Get testnet explorer URL for transaction (alias)
 */
export function getTestnetExplorerTxUrl(txid) {
  return getExplorerTxUrl(txid);
}

/**
 * Get explorer URL for block
 */
export function getExplorerBlockUrl(hashOrHeight) {
  const baseUrl = BLOCK_EXPLORERS[isTestnet() ? 'testnet' : 'mainnet'];
  return `${baseUrl}/block/${hashOrHeight}`;
}

/**
 * Get testnet explorer URL for block (alias)
 */
export function getTestnetExplorerBlockUrl(hashOrHeight) {
  return getExplorerBlockUrl(hashOrHeight);
}

/**
 * Get explorer URL for address
 */
export function getExplorerAddressUrl(address) {
  const baseUrl = BLOCK_EXPLORERS[isTestnet() ? 'testnet' : 'mainnet'];
  return `${baseUrl}/address/${address}`;
}

/**
 * Get testnet explorer URL for address (alias)
 */
export function getTestnetExplorerAddressUrl(address) {
  return getExplorerAddressUrl(address);
}

/**
 * Get block data from public API
 */
export async function getBlockFromExplorer(hashOrHeight) {
  try {
    const { data, source } = await publicApi(`/block/${hashOrHeight}`);
    
    if (source === 'blockbook') {
      return normalizeBlockbookBlock(data);
    }
    return data;
  } catch (error) {
    throw new Error(`Failed to fetch block: ${error.message}`);
  }
}

/**
 * Get transaction data from public API
 */
export async function getTxFromExplorer(txid) {
  try {
    const { data, source } = await publicApi(`/tx/${txid}`);
    
    if (source === 'blockbook') {
      return {
        txid: data.txid,
        hash: data.hash || data.txid,
        version: data.version,
        blockHash: data.blockHash,
        blockHeight: data.blockHeight,
        confirmations: data.confirmations,
        time: data.blockTime,
        valueIn: data.valueIn,
        valueOut: data.valueOut,
        fees: data.fees,
        vin: data.vin,
        vout: data.vout,
        _source: 'blockbook',
      };
    }
    return data;
  } catch (error) {
    throw new Error(`Failed to fetch transaction: ${error.message}`);
  }
}

/**
 * Check if a transaction is confirmed with N confirmations
 */
export async function isTransactionConfirmed(txid, minConfirmations = 20) {
  try {
    // Try public API first
    const txData = await getTxFromExplorer(txid);
    return (txData.confirmations || 0) >= minConfirmations;
  } catch (apiError) {
    // Try RPC as fallback
    try {
      const tx = await zcashRpc('gettransaction', [txid]);
      return tx.confirmations >= minConfirmations;
    } catch (rpcError) {
      throw new Error(`Cannot verify transaction: ${apiError.message}`);
    }
  }
}

/**
 * Get the recommended testnet nodes to connect to
 */
export function getTestnetNodes() {
  return [
    'testnet.z.cash:18233',
    'testnet.lightwalletd.com:18233',
  ];
}

/**
 * Generate zcash.conf content for testnet
 */
export function generateTestnetConfig(options = {}) {
  const {
    rpcUser = 'zcashrpc',
    rpcPassword = 'changeme_' + Math.random().toString(36).substring(7),
    rpcPort = 18232,
    rpcAllowIp = '127.0.0.1',
    txIndex = true,
    experimentalFeatures = true,
  } = options;
  
  return `# Zcash Testnet Configuration
# Generated by zarklink CLI

# Network
testnet=1

# RPC Settings
server=1
rpcuser=${rpcUser}
rpcpassword=${rpcPassword}
rpcport=${rpcPort}
rpcallowip=${rpcAllowIp}

# Recommended settings
${txIndex ? 'txindex=1' : '# txindex=1'}
${experimentalFeatures ? 'experimentalfeatures=1' : ''}
${experimentalFeatures ? 'orchardwallet=1' : ''}

# Testnet nodes
addnode=testnet.z.cash
addnode=testnet.lightwalletd.com

# Logging
debug=rpc
`;
}

/**
 * Get network-specific parameters
 */
export function getNetworkParams() {
  if (isTestnet()) {
    return {
      network: 'testnet',
      port: 18233,
      rpcPort: 18232,
      addressPrefix: {
        transparent: 'tm',  // Testnet starts with tm
        sapling: 'ztestsapling',
        unified: 'utest',
      },
      genesisHash: '05a60a92d99d85997cce3b87616c089f6124d7342af37106edc76126334a2c38',
      activationHeights: {
        sapling: 280000,
        blossom: 584000,
        heartwood: 903800,
        canopy: 1028500,
        nu5: 1842420,
      },
    };
  } else {
    return {
      network: 'mainnet',
      port: 8233,
      rpcPort: 8232,
      addressPrefix: {
        transparent: 't1',  // Mainnet starts with t1
        sapling: 'zs',
        unified: 'u',
      },
      genesisHash: '00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08',
      activationHeights: {
        sapling: 419200,
        blossom: 653600,
        heartwood: 903000,
        canopy: 1046400,
        nu5: 1687104,
      },
    };
  }
}

/**
 * Validate a Zcash address for the current network
 */
export function validateAddress(address) {
  const params = getNetworkParams();
  
  // Check transparent address
  if (address.startsWith('t')) {
    if (isTestnet()) {
      return address.startsWith('tm');
    } else {
      return address.startsWith('t1') || address.startsWith('t3');
    }
  }
  
  // Check shielded address
  if (address.startsWith('z')) {
    if (isTestnet()) {
      return address.startsWith('ztestsapling') || address.startsWith('ztest');
    } else {
      return address.startsWith('zs');
    }
  }
  
  // Check unified address
  if (address.startsWith('u')) {
    if (isTestnet()) {
      return address.startsWith('utest');
    } else {
      return address.startsWith('u1');
    }
  }
  
  return false;
}

/**
 * Get address type
 */
export function getAddressType(address) {
  if (address.startsWith('t')) return 'transparent';
  if (address.startsWith('z')) return 'sapling';
  if (address.startsWith('u')) return 'unified';
  return 'unknown';
}

/**
 * Get address balance - uses public API for transparent addresses
 */
export async function getAddressBalance(address) {
  // For transparent addresses, use public API
  if (address.startsWith('t')) {
    try {
      const { data, source } = await publicApi(`/address/${address}`);
      
      if (source === 'blockbook') {
        // Blockbook returns balance in satoshis as string
        const balanceSat = BigInt(data.balance || '0');
        return Number(balanceSat) / 1e8;
      }
      return data.balance || 0;
    } catch (apiError) {
      // Try RPC as fallback
      try {
        return await zcashRpc('z_getbalance', [address]);
      } catch (rpcError) {
        throw new Error(`Cannot get balance: ${apiError.message}`);
      }
    }
  }
  
  // Shielded addresses require RPC
  try {
    return await zcashRpc('z_getbalance', [address]);
  } catch (rpcError) {
    throw new Error(`Shielded address balance requires local zcashd node`);
  }
}

/**
 * Get address transaction history - uses public API
 */
export async function getAddressTransactions(address, page = 1) {
  if (!address.startsWith('t')) {
    throw new Error('Transaction history only available for transparent addresses via public API');
  }
  
  try {
    const { data, source } = await publicApi(`/address/${address}?page=${page}`);
    
    if (source === 'blockbook') {
      return {
        address: data.address,
        balance: Number(BigInt(data.balance || '0')) / 1e8,
        txs: data.txs || [],
        totalPages: data.totalPages || 1,
        page: data.page || page,
        _source: 'api',
      };
    }
    return data;
  } catch (error) {
    throw new Error(`Cannot fetch address history: ${error.message}`);
  }
}

// Export network constants
export const TESTNET = {
  faucetUrl: 'https://faucet.zecpages.com/',
  explorerUrl: BLOCK_EXPLORERS.testnet,
  lightwalletd: LIGHTWALLETD_ENDPOINTS.testnet[0],
  rpcPort: 18232,
  p2pPort: 18233,
  currency: 'TAZ', // Testnet coins
  requiresLocalNode: true, // No public testnet API available
};

export const MAINNET = {
  explorerUrl: BLOCK_EXPLORERS.mainnet,
  blockchairUrl: REST_APIS.blockchair.mainnet,
  lightwalletd: LIGHTWALLETD_ENDPOINTS.mainnet[0],
  rpcPort: 8232,
  p2pPort: 8233,
  currency: 'ZEC',
  requiresLocalNode: false, // Can use Blockchair API
};

// Export API configuration for external use
export const API_ENDPOINTS = {
  lightwalletd: LIGHTWALLETD_ENDPOINTS,
  rest: REST_APIS,
  explorers: BLOCK_EXPLORERS,
};