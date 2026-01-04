/**
 * zarklink CLI Configuration
 * Loads environment variables and provides configuration
 * 
 * NOTE: Local zcashd is OPTIONAL. The CLI works with public APIs.
 */

import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Load .env file
dotenv.config();

// Config file path
const CONFIG_PATH = join(homedir(), '.zarklink', 'config.json');

/**
 * Default configuration
 * 
 * Zcash: Uses public APIs by default (no local node required)
 * Starknet: Uses Sepolia testnet with deployed contracts
 */
const defaultConfig = {
  // Starknet settings
  starknet: {
    network: process.env.STARKNET_NETWORK || 'sepolia',
    rpcUrl: process.env.STARKNET_RPC_URL || 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/KKX3txNscJJ_3JAPqQ3E7',
    accountAddress: process.env.STARKNET_ACCOUNT_ADDRESS || '',
    privateKey: process.env.STARKNET_PRIVATE_KEY || '',
  },
  
  // Contract addresses (Starknet Sepolia - already deployed)
  contracts: {
    bridge: process.env.BRIDGE_ADDRESS || '0x069d135c173847a356aa29a182ace00981e9793aea5bb62bfc6c1d4577e9c36e',
    relay: process.env.RELAY_ADDRESS || '0x01ae3dce889773db25632ebed4a04698fb2dff1c71b2101f00e8c0f34b5d7e4b',
    token: process.env.TOKEN_ADDRESS || '0x04c571b6ca21e59add5ccb280eb68a309c6ca4e5eeecfd2186856fe97f74a294',
    registry: process.env.REGISTRY_ADDRESS || '0x007abd698ddafea4669ac4d5e96477ef4958b6e6ebd57e4ef2f61df1f2597436',
  },
  
  // Zcash settings
  // NOTE: rpcUrl is OPTIONAL - public APIs are used by default
  zcash: {
    network: process.env.ZCASH_NETWORK || 'testnet',
    // Optional: Only needed if you want to use a local zcashd node
    rpcUrl: process.env.ZCASH_RPC_URL || null,
    rpcUser: process.env.ZCASH_RPC_USER || '',
    rpcPassword: process.env.ZCASH_RPC_PASSWORD || '',
    // Public API settings
    usePublicApi: process.env.ZCASH_USE_PUBLIC_API !== 'false', // Default true
  },
  
  // Bridge settings
  bridge: {
    minConfirmations: parseInt(process.env.MIN_CONFIRMATIONS || '20'),
    issueTimeout: parseInt(process.env.ISSUE_TIMEOUT || '86400'),
    redeemTimeout: parseInt(process.env.REDEEM_TIMEOUT || '86400'),
    feeRate: parseInt(process.env.FEE_RATE || '10'),
  },
};

/**
 * Load configuration from file
 */
function loadConfig() {
  let config = { ...defaultConfig };
  
  if (existsSync(CONFIG_PATH)) {
    try {
      const fileConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      config = mergeDeep(config, fileConfig);
    } catch (error) {
      console.warn('Warning: Could not parse config file, using defaults');
    }
  }
  
  return config;
}

/**
 * Deep merge objects
 */
function mergeDeep(target, source) {
  const result = { ...target };
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = mergeDeep(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Get Starknet RPC URL for network
 */
function getStarknetRpcUrl(network) {
  const urls = {
    mainnet: 'https://starknet-mainnet.public.blastapi.io',
    sepolia: 'https://starknet-sepolia.public.blastapi.io',
    devnet: 'http://127.0.0.1:5050',
  };
  return urls[network] || urls.sepolia;
}

export const config = loadConfig();
export { getStarknetRpcUrl, defaultConfig };
