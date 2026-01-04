/**
 * Starknet Relay Client
 * Submits block headers to the relay contract on Starknet
 */

import { Account, RpcProvider, Contract, CallData } from 'starknet';

// Relay contract ABI (minimal for header submission)
const RELAY_ABI = [
  {
    name: 'submit_block_header',
    type: 'function',
    inputs: [
      { name: 'header_data', type: 'core::array::Array::<core::felt252>' },
      { name: 'height', type: 'core::integer::u64' }
    ],
    outputs: [{ name: 'block_hash', type: 'core::integer::u256' }],
    state_mutability: 'external',
  },
  {
    name: 'get_chain_tip',
    type: 'function',
    inputs: [],
    outputs: [
      { name: 'tip_hash', type: 'core::integer::u256' },
      { name: 'tip_height', type: 'core::integer::u64' }
    ],
    state_mutability: 'view',
  },
  {
    name: 'is_confirmed',
    type: 'function',
    inputs: [{ name: 'block_hash', type: 'core::integer::u256' }],
    outputs: [{ name: 'confirmed', type: 'core::bool' }],
    state_mutability: 'view',
  },
  {
    name: 'is_relayer',
    type: 'function',
    inputs: [{ name: 'address', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [{ name: 'is_relayer', type: 'core::bool' }],
    state_mutability: 'view',
  },
];

export class StarknetRelay {
  constructor(config) {
    this.rpcUrl = config.starknetRpcUrl;
    this.accountAddress = config.starknetAccountAddress;
    this.privateKey = config.starknetPrivateKey;
    this.contractAddress = config.relayContractAddress;
    
    this.provider = null;
    this.account = null;
    this.contract = null;
  }
  
  async connect() {
    // Create provider
    this.provider = new RpcProvider({ nodeUrl: this.rpcUrl });
    
    // Create account
    if (!this.accountAddress || !this.privateKey) {
      throw new Error('Starknet account address and private key required');
    }
    
    this.account = new Account(
      this.provider,
      this.accountAddress,
      this.privateKey
    );
    
    // Create contract
    if (!this.contractAddress) {
      throw new Error('Relay contract address required');
    }
    
    this.contract = new Contract(RELAY_ABI, this.contractAddress, this.account);
    
    // Verify we're a relayer
    const isRelayer = await this.contract.is_relayer(this.accountAddress);
    if (!isRelayer) {
      console.warn('Warning: Account is not registered as a relayer');
    }
  }
  
  async getChainTip() {
    const result = await this.contract.get_chain_tip();
    return [
      this.u256ToBigInt(result.tip_hash),
      Number(result.tip_height),
    ];
  }
  
  async submitBlockHeader(headerData, height) {
    // Prepare calldata
    const call = this.contract.populate('submit_block_header', [
      headerData,
      height,
    ]);
    
    // Execute transaction
    const tx = await this.account.execute([call]);
    
    return tx.transaction_hash;
  }
  
  async waitForTransaction(txHash, timeout = 120000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const receipt = await this.provider.getTransactionReceipt(txHash);
        
        if (receipt.status === 'ACCEPTED_ON_L2' || receipt.status === 'ACCEPTED_ON_L1') {
          return receipt;
        }
        
        if (receipt.status === 'REJECTED') {
          throw new Error(`Transaction rejected: ${txHash}`);
        }
      } catch (error) {
        if (!error.message.includes('not found')) {
          throw error;
        }
      }
      
      await this.sleep(5000);
    }
    
    throw new Error(`Transaction timeout: ${txHash}`);
  }
  
  async isConfirmed(blockHash) {
    const hashU256 = this.bigIntToU256(BigInt(blockHash));
    return await this.contract.is_confirmed(hashU256);
  }
  
  // Helper: Convert Starknet u256 to BigInt
  u256ToBigInt(u256) {
    const low = BigInt(u256.low);
    const high = BigInt(u256.high);
    return low + (high << 128n);
  }
  
  // Helper: Convert BigInt to Starknet u256
  bigIntToU256(value) {
    const low = value & ((1n << 128n) - 1n);
    const high = value >> 128n;
    return { low: low.toString(), high: high.toString() };
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
