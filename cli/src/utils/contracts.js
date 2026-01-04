/**
 * Bridge Contract Interaction
 * Functions for interacting with zarklink bridge on Starknet
 */

import { Contract, CallData } from 'starknet';
import { getProvider, getAccount, bigIntToU256, u256ToBigInt, waitForTransaction } from './starknet.js';
import { config } from '../config.js';

// Bridge ABI (minimal)
const BRIDGE_ABI = [
  {
    name: 'request_lock',
    type: 'function',
    inputs: [
      { name: 'vault', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'amount', type: 'core::integer::u256' },
      { name: 'user_emk', type: 'core::integer::u256' },
    ],
    outputs: [{ name: 'permit_nonce', type: 'core::integer::u256' }],
    state_mutability: 'external',
  },
  {
    name: 'get_permit',
    type: 'function',
    inputs: [{ name: 'nonce', type: 'core::integer::u256' }],
    outputs: [
      { name: 'vault_address', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'vault_zaddr_hash', type: 'core::integer::u256' },
      { name: 'amount', type: 'core::integer::u256' },
      { name: 'user_emk', type: 'core::integer::u256' },
      { name: 'expires_at', type: 'core::integer::u64' },
      { name: 'status', type: 'core::integer::u8' },
    ],
    state_mutability: 'view',
  },
  {
    name: 'mint',
    type: 'function',
    inputs: [
      { name: 'permit_nonce', type: 'core::integer::u256' },
      { name: 'block_hash', type: 'core::integer::u256' },
      { name: 'note_commitment', type: 'core::integer::u256' },
      { name: 'cv', type: 'core::integer::u256' },
      { name: 'cvn', type: 'core::integer::u256' },
      { name: 'merkle_proof', type: 'core::array::Array::<core::integer::u256>' },
      { name: 'merkle_index', type: 'core::integer::u32' },
      { name: 'encrypted_note', type: 'core::array::Array::<core::felt252>' },
    ],
    outputs: [{ name: 'minted_amount', type: 'core::integer::u256' }],
    state_mutability: 'external',
  },
  {
    name: 'request_redeem',
    type: 'function',
    inputs: [
      { name: 'amount', type: 'core::integer::u256' },
      { name: 'vault', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'encrypted_dest', type: 'core::array::Array::<core::felt252>' },
    ],
    outputs: [{ name: 'burn_nonce', type: 'core::integer::u256' }],
    state_mutability: 'external',
  },
  {
    name: 'confirm_release',
    type: 'function',
    inputs: [
      { name: 'burn_nonce', type: 'core::integer::u256' },
      { name: 'zcash_txid', type: 'core::integer::u256' },
    ],
    outputs: [],
    state_mutability: 'external',
  },
  {
    name: 'claim_collateral',
    type: 'function',
    inputs: [{ name: 'burn_nonce', type: 'core::integer::u256' }],
    outputs: [{ name: 'collateral_amount', type: 'core::integer::u256' }],
    state_mutability: 'external',
  },
  {
    name: 'get_burn_request',
    type: 'function',
    inputs: [{ name: 'burn_nonce', type: 'core::integer::u256' }],
    outputs: [
      { name: 'burner', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'vault', type: 'core::starknet::contract_address::ContractAddress' },
      { name: 'amount', type: 'core::integer::u256' },
      { name: 'encrypted_dest', type: 'core::array::Array::<core::felt252>' },
      { name: 'timeout', type: 'core::integer::u64' },
      { name: 'status', type: 'core::integer::u8' },
    ],
    state_mutability: 'view',
  },
];

// Relay ABI (minimal)
const RELAY_ABI = [
  {
    name: 'get_chain_tip',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'tip_hash', type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    name: 'get_chain_tip_height',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'height', type: 'core::integer::u64' }],
    state_mutability: 'view',
  },
  {
    name: 'get_sapling_root',
    type: 'function',
    inputs: [{ name: 'block_hash', type: 'core::integer::u256' }],
    outputs: [{ name: 'sapling_root', type: 'core::integer::u256' }],
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
    name: 'submit_block_header',
    type: 'function',
    inputs: [
      { name: 'header_data', type: 'core::array::Array::<core::felt252>' },
      { name: 'height', type: 'core::integer::u64' },
    ],
    outputs: [{ name: 'block_hash', type: 'core::integer::u256' }],
    state_mutability: 'external',
  },
];

// Vault Registry ABI (minimal)
const REGISTRY_ABI = [
  {
    name: 'get_vault',
    type: 'function',
    inputs: [{ name: 'vault_address', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [
      { name: 'zcash_address_hash', type: 'core::integer::u256' },
      { name: 'collateral', type: 'core::integer::u256' },
      { name: 'active', type: 'core::bool' },
    ],
    state_mutability: 'view',
  },
  {
    name: 'get_vault_zaddr',
    type: 'function',
    inputs: [{ name: 'vault_address', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [{ name: 'zaddr_hash', type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    name: 'get_vault_count',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'count', type: 'core::integer::u32' }],
    state_mutability: 'view',
  },
];

// Token ABI (minimal)
const TOKEN_ABI = [
  {
    name: 'name',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'name', type: 'core::felt252' }],
    state_mutability: 'view',
  },
  {
    name: 'symbol',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'symbol', type: 'core::felt252' }],
    state_mutability: 'view',
  },
  {
    name: 'decimals',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'decimals', type: 'core::integer::u8' }],
    state_mutability: 'view',
  },
  {
    name: 'total_supply',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'supply', type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
  {
    name: 'balance_of',
    type: 'function',
    inputs: [{ name: 'account', type: 'core::starknet::contract_address::ContractAddress' }],
    outputs: [{ name: 'balance', type: 'core::integer::u256' }],
    state_mutability: 'view',
  },
];

/**
 * Get Bridge contract instance
 */
export function getBridgeContract(withAccount = false) {
  const address = config.contracts.bridge;
  if (!address) throw new Error('Bridge contract address not configured');
  
  if (withAccount) {
    const account = getAccount();
    return new Contract(BRIDGE_ABI, address, account);
  }
  return new Contract(BRIDGE_ABI, address, getProvider());
}

/**
 * Get Relay contract instance
 */
export function getRelayContract(withAccount = false) {
  const address = config.contracts.relay;
  if (!address) throw new Error('Relay contract address not configured');
  
  if (withAccount) {
    const account = getAccount();
    return new Contract(RELAY_ABI, address, account);
  }
  return new Contract(RELAY_ABI, address, getProvider());
}

/**
 * Get Registry contract instance
 */
export function getRegistryContract() {
  const address = config.contracts.registry;
  if (!address) throw new Error('Registry contract address not configured');
  return new Contract(REGISTRY_ABI, address, getProvider());
}

/**
 * Get Token contract instance
 */
export function getTokenContract() {
  const address = config.contracts.token;
  if (!address) throw new Error('Token contract address not configured');
  return new Contract(TOKEN_ABI, address, getProvider());
}

// ============ Issue Protocol Functions ============

/**
 * Request a lock permit from the bridge
 */
export async function requestLockPermit(vaultAddress, amount, userEmk) {
  const contract = getBridgeContract(true);
  
  const tx = await contract.request_lock(
    vaultAddress,
    bigIntToU256(amount),
    bigIntToU256(userEmk)
  );
  
  const receipt = await waitForTransaction(tx.transaction_hash);
  
  // Extract permit nonce from events
  const permitNonce = receipt.events?.[0]?.data?.[0] || '0';
  
  return {
    txHash: tx.transaction_hash,
    permitNonce: BigInt(permitNonce),
  };
}

/**
 * Get lock permit details
 */
export async function getLockPermit(nonce) {
  const contract = getBridgeContract();
  
  const result = await contract.get_permit(bigIntToU256(nonce));
  
  return {
    vaultAddress: result.vault_address,
    vaultZaddrHash: u256ToBigInt(result.vault_zaddr_hash).toString(16),
    amount: u256ToBigInt(result.amount),
    userEmk: u256ToBigInt(result.user_emk).toString(16),
    expiresAt: Number(result.expires_at),
    status: Number(result.status),
  };
}

/**
 * Submit mint proof and receive wZEC
 */
export async function submitMintProof(params) {
  const {
    permitNonce,
    blockHash,
    noteCommitment,
    cv,
    cvn,
    merkleProof,
    merkleIndex,
    encryptedNote,
  } = params;

  const contract = getBridgeContract(true);
  
  const tx = await contract.mint(
    bigIntToU256(permitNonce),
    bigIntToU256(BigInt('0x' + blockHash)),
    bigIntToU256(BigInt('0x' + noteCommitment)),
    bigIntToU256(BigInt('0x' + cv)),
    bigIntToU256(BigInt('0x' + cvn)),
    merkleProof.map(h => bigIntToU256(BigInt('0x' + h))),
    merkleIndex,
    encryptedNote.map(b => b.toString())
  );
  
  const receipt = await waitForTransaction(tx.transaction_hash);
  
  return {
    txHash: tx.transaction_hash,
    receipt,
  };
}

// ============ Redeem Protocol Functions ============

/**
 * Get burn request info
 */
export async function getBurnRequest(burnNonce) {
  const contract = getBridgeContract();
  
  const result = await contract.get_burn_request(bigIntToU256(burnNonce));
  
  const statusMap = {
    0: 'pending',
    1: 'released',
    2: 'claimed',
    3: 'expired'
  };
  
  return {
    burner: '0x' + result.burner.toString(16),
    vault: '0x' + result.vault.toString(16),
    amount: u256ToBigInt(result.amount),
    encryptedDest: result.encrypted_dest,
    timeout: Number(result.timeout),
    status: statusMap[Number(result.status)] || 'unknown',
    statusCode: Number(result.status),
  };
}

/**
 * Request redemption (burn wZEC)
 */
export async function requestRedeem(amount, vaultAddress, encryptedDest) {
  const contract = getBridgeContract(true);
  
  const tx = await contract.request_redeem(
    bigIntToU256(amount),
    vaultAddress,
    encryptedDest
  );
  
  const receipt = await waitForTransaction(tx.transaction_hash);
  
  const burnNonce = receipt.events?.[0]?.data?.[0] || '0';
  
  return {
    txHash: tx.transaction_hash,
    burnNonce: BigInt(burnNonce),
  };
}

/**
 * Confirm ZEC release (vault only)
 */
export async function confirmRelease(burnNonce, zcashTxid) {
  const contract = getBridgeContract(true);
  
  const tx = await contract.confirm_release(
    bigIntToU256(burnNonce),
    bigIntToU256(BigInt('0x' + zcashTxid))
  );
  
  return await waitForTransaction(tx.transaction_hash);
}

/**
 * Claim collateral after timeout
 */
export async function claimCollateral(burnNonce) {
  const contract = getBridgeContract(true);
  
  const tx = await contract.claim_collateral(bigIntToU256(burnNonce));
  
  return await waitForTransaction(tx.transaction_hash);
}

// ============ Relay Functions ============

/**
 * Get current chain tip from relay
 */
export async function getRelayChainTip() {
  const contract = getRelayContract();
  
  const [tipHash, tipHeight] = await Promise.all([
    contract.get_chain_tip(),
    contract.get_chain_tip_height(),
  ]);
  
  return {
    hash: u256ToBigInt(tipHash).toString(16).padStart(64, '0'),
    height: Number(tipHeight),
  };
}

/**
 * Get Sapling root for a block
 */
export async function getRelaySaplingRoot(blockHash) {
  const contract = getRelayContract();
  
  const root = await contract.get_sapling_root(
    bigIntToU256(BigInt('0x' + blockHash))
  );
  
  return u256ToBigInt(root).toString(16).padStart(64, '0');
}

/**
 * Check if block is confirmed
 */
export async function isBlockConfirmed(blockHash) {
  const contract = getRelayContract();
  
  return await contract.is_confirmed(
    bigIntToU256(BigInt('0x' + blockHash))
  );
}

/**
 * Submit block header to relay
 */
export async function submitBlockHeader(headerData, height) {
  const contract = getRelayContract(true);
  
  const tx = await contract.submit_block_header(headerData, height);
  
  return await waitForTransaction(tx.transaction_hash);
}

// ============ Query Functions ============

/**
 * Get vault info
 */
export async function getVaultInfo(vaultAddress) {
  const contract = getRegistryContract();
  
  const result = await contract.get_vault(vaultAddress);
  
  return {
    zcashAddressHash: u256ToBigInt(result.zcash_address_hash).toString(16),
    collateral: u256ToBigInt(result.collateral),
    active: result.active,
  };
}

/**
 * Get wZEC token info
 */
export async function getTokenInfo() {
  const contract = getTokenContract();
  
  const [name, symbol, decimals, totalSupply] = await Promise.all([
    contract.name(),
    contract.symbol(),
    contract.decimals(),
    contract.total_supply(),
  ]);
  
  return {
    name: feltToString(name),
    symbol: feltToString(symbol),
    decimals: Number(decimals),
    totalSupply: u256ToBigInt(totalSupply),
  };
}

/**
 * Get wZEC balance
 */
export async function getBalance(address) {
  const contract = getTokenContract();
  const balance = await contract.balance_of(address);
  return u256ToBigInt(balance);
}

// Helper
function feltToString(felt) {
  const hex = BigInt(felt).toString(16);
  let str = '';
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  }
  return str;
}
