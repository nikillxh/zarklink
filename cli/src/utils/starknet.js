/**
 * Starknet Utilities
 * Helper functions for interacting with Starknet
 */

import { Account, RpcProvider, Contract, CallData, stark, ec } from 'starknet';
import { config, getStarknetRpcUrl } from '../config.js';

/**
 * Get RPC Provider
 */
export function getProvider() {
  const rpcUrl = config.starknet.rpcUrl || getStarknetRpcUrl(config.starknet.network);
  return new RpcProvider({ nodeUrl: rpcUrl });
}

/**
 * Get Account instance
 */
export function getAccount() {
  const provider = getProvider();
  
  if (!config.starknet.accountAddress || !config.starknet.privateKey) {
    throw new Error('Account address and private key must be configured');
  }
  
  return new Account(
    provider,
    config.starknet.accountAddress,
    config.starknet.privateKey
  );
}

/**
 * Get Contract instance
 */
export async function getContract(address, abi) {
  const provider = getProvider();
  return new Contract(abi, address, provider);
}

/**
 * Get Contract with Account (for transactions)
 */
export async function getContractWithAccount(address, abi) {
  const account = getAccount();
  return new Contract(abi, address, account);
}

/**
 * Format felt252 to hex string
 */
export function feltToHex(felt) {
  return '0x' + BigInt(felt).toString(16).padStart(64, '0');
}

/**
 * Format hex string to felt252
 */
export function hexToFelt(hex) {
  return BigInt(hex).toString();
}

/**
 * Convert u256 from Starknet (low, high) to BigInt
 */
export function u256ToBigInt(u256) {
  const low = BigInt(u256.low);
  const high = BigInt(u256.high);
  return low + (high << 128n);
}

/**
 * Convert BigInt to Starknet u256 (low, high)
 */
export function bigIntToU256(value) {
  const bigValue = BigInt(value);
  const low = bigValue & ((1n << 128n) - 1n);
  const high = bigValue >> 128n;
  return { low: low.toString(), high: high.toString() };
}

/**
 * Wait for transaction with status updates
 */
export async function waitForTransaction(txHash, onStatus) {
  const provider = getProvider();
  let status = 'PENDING';
  
  while (status === 'PENDING' || status === 'RECEIVED') {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      status = receipt.status;
      
      if (onStatus) {
        onStatus(status);
      }
      
      if (status === 'ACCEPTED_ON_L2' || status === 'ACCEPTED_ON_L1') {
        return receipt;
      }
      
      if (status === 'REJECTED') {
        throw new Error(`Transaction rejected: ${txHash}`);
      }
    } catch (error) {
      if (!error.message.includes('not found')) {
        throw error;
      }
    }
    
    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  return null;
}

/**
 * Estimate transaction fee
 */
export async function estimateFee(account, calls) {
  const estimate = await account.estimateFee(calls);
  return {
    overall_fee: estimate.overall_fee,
    gas_price: estimate.gas_price,
    gas_consumed: estimate.gas_consumed,
  };
}
