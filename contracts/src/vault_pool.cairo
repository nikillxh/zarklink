// ============================================================================
// Zarklink — Vault Pool Contract
// ============================================================================
// Aggregated vault liquidity pool with VRF-based request assignment.
// Improves privacy (no vault selection signal) and capital efficiency.
// Integrates with vault_registry for vault lookup and validation.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IVaultPool<TContractState> {
  fn deposit_collateral(ref self: TContractState, amount: u256);
  fn withdraw_collateral(ref self: TContractState, amount: u256);
  fn assign_request(ref self: TContractState, request_id: felt252) -> u32;
  fn encumber(ref self: TContractState, vault_id: u32, amount: u256);
  fn release_encumbrance(ref self: TContractState, vault_id: u32, amount: u256);
  fn set_bridge_protocol(ref self: TContractState, bridge: ContractAddress);
  fn get_pool_capacity(self: @TContractState) -> u256;
  fn get_vault_pool_share(self: @TContractState, vault_id: u32) -> u256;
  fn get_vault_free_collateral(self: @TContractState, vault_id: u32) -> u256;
  fn get_total_deposited(self: @TContractState) -> u256;
  fn get_active_vault_count(self: @TContractState) -> u32;
}

#[starknet::contract]
pub mod VaultPool {
  use super::IVaultPool;
  use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
  use starknet::storage::{
    Map, StorageMapReadAccess, StorageMapWriteAccess,
    StoragePointerReadAccess, StoragePointerWriteAccess,
  };
  use core::poseidon::poseidon_hash_span;
  use crate::vault_registry::{IVaultRegistryDispatcher, IVaultRegistryDispatcherTrait};

  #[storage]
  struct Storage {
    owner: ContractAddress,
    bridge_protocol: ContractAddress,
    vault_registry: ContractAddress,
    collateral_token: ContractAddress,
    total_deposited: u256,
    active_vault_count: u32,
    vault_deposits: Map<u32, u256>,
    vault_id_by_index: Map<u32, u32>,
    vault_index_by_id: Map<u32, u32>,
    is_in_pool: Map<u32, bool>,
    encumbered: Map<u32, u256>,
    assignment_nonce: felt252,
  }

  #[event]
  #[derive(Drop, starknet::Event)]
  pub enum Event {
    CollateralDeposited: CollateralDeposited,
    CollateralWithdrawn: CollateralWithdrawn,
    RequestAssigned: RequestAssigned,
    Encumbered: Encumbered,
    EncumbranceReleased: EncumbranceReleased,
  }

  #[derive(Drop, starknet::Event)]
  pub struct CollateralDeposited {
    #[key]
    pub vault_id: u32,
    pub amount: u256,
  }

  #[derive(Drop, starknet::Event)]
  pub struct CollateralWithdrawn {
    #[key]
    pub vault_id: u32,
    pub amount: u256,
  }

  #[derive(Drop, starknet::Event)]
  pub struct RequestAssigned {
    #[key]
    pub request_id: felt252,
    pub vault_id: u32,
  }

  #[derive(Drop, starknet::Event)]
  pub struct Encumbered {
    #[key]
    pub vault_id: u32,
    pub amount: u256,
  }

  #[derive(Drop, starknet::Event)]
  pub struct EncumbranceReleased {
    #[key]
    pub vault_id: u32,
    pub amount: u256,
  }

  #[constructor]
  fn constructor(
    ref self: ContractState,
    owner: ContractAddress,
    vault_registry: ContractAddress,
    collateral_token: ContractAddress,
  ) {
    self.owner.write(owner);
    self.vault_registry.write(vault_registry);
    self.collateral_token.write(collateral_token);
    self.total_deposited.write(0_u256);
    self.active_vault_count.write(0);
    self.assignment_nonce.write(0);
  }

  #[generate_trait]
  impl InternalImpl of InternalTrait {
    /// Get vault registry dispatcher
    fn registry(self: @ContractState) -> IVaultRegistryDispatcher {
      IVaultRegistryDispatcher { contract_address: self.vault_registry.read() }
    }

    /// Look up vault_id from caller via registry
    fn get_caller_vault_id(self: @ContractState) -> u32 {
      let caller = get_caller_address();
      let registry = self.registry();
      registry.get_vault_id_by_owner(caller)
    }

    /// Add vault to active pool index
    fn add_to_pool(ref self: ContractState, vault_id: u32) {
      if !self.is_in_pool.read(vault_id) {
        let idx = self.active_vault_count.read();
        self.vault_id_by_index.write(idx, vault_id);
        self.vault_index_by_id.write(vault_id, idx);
        self.is_in_pool.write(vault_id, true);
        self.active_vault_count.write(idx + 1);
      }
    }

    /// Remove vault from active pool index (swap-and-pop)
    fn remove_from_pool(ref self: ContractState, vault_id: u32) {
      if self.is_in_pool.read(vault_id) {
        let count = self.active_vault_count.read();
        let idx = self.vault_index_by_id.read(vault_id);
        let last_idx = count - 1;

        if idx != last_idx {
          // Swap with last element
          let last_vault_id = self.vault_id_by_index.read(last_idx);
          self.vault_id_by_index.write(idx, last_vault_id);
          self.vault_index_by_id.write(last_vault_id, idx);
        }

        self.is_in_pool.write(vault_id, false);
        self.active_vault_count.write(last_idx);
      }
    }
  }

  #[abi(embed_v0)]
  impl VaultPoolImpl of IVaultPool<ContractState> {
    fn deposit_collateral(ref self: ContractState, amount: u256) {
      assert(amount > 0, 'Amount must be positive');

      // Look up vault_id from caller via registry
      let vault_id = self.get_caller_vault_id();

      // Verify vault is active in registry
      let registry = self.registry();
      assert(registry.is_vault_active(vault_id), 'Vault not active');

      let current = self.vault_deposits.read(vault_id);
      self.vault_deposits.write(vault_id, current + amount);

      let total = self.total_deposited.read();
      self.total_deposited.write(total + amount);

      // Add to pool index if not already present
      self.add_to_pool(vault_id);

      self.emit(CollateralDeposited { vault_id, amount });
    }

    fn withdraw_collateral(ref self: ContractState, amount: u256) {
      let vault_id = self.get_caller_vault_id();

      let deposit = self.vault_deposits.read(vault_id);
      let enc = self.encumbered.read(vault_id);
      let free = deposit - enc;
      assert(free >= amount, 'Insufficient free collateral');

      let new_deposit = deposit - amount;
      self.vault_deposits.write(vault_id, new_deposit);
      let total = self.total_deposited.read();
      self.total_deposited.write(total - amount);

      // Remove from pool if fully withdrawn
      if new_deposit == 0 {
        self.remove_from_pool(vault_id);
      }

      self.emit(CollateralWithdrawn { vault_id, amount });
    }

    fn assign_request(ref self: ContractState, request_id: felt252) -> u32 {
      let count = self.active_vault_count.read();
      assert(count > 0, 'No active vaults in pool');

      // VRF-based assignment using Poseidon hash
      let nonce = self.assignment_nonce.read();
      let timestamp: felt252 = get_block_timestamp().into();
      let seed_data = array![request_id, nonce, timestamp];
      let hash = poseidon_hash_span(seed_data.span());

      // Map hash to vault index (modular selection)
      let hash_u256: u256 = hash.into();
      let count_u256: u256 = count.into();
      let index_u256: u256 = hash_u256 % count_u256;
      let index: u32 = index_u256.try_into().unwrap();

      let vault_id = self.vault_id_by_index.read(index);

      // Update nonce for next assignment
      let new_nonce_data = array![nonce, request_id, hash];
      let new_nonce = poseidon_hash_span(new_nonce_data.span());
      self.assignment_nonce.write(new_nonce);

      self.emit(RequestAssigned { request_id, vault_id });
      vault_id
    }

    fn encumber(ref self: ContractState, vault_id: u32, amount: u256) {
      let caller = get_caller_address();
      let bridge = self.bridge_protocol.read();
      assert(caller == bridge, 'Only bridge protocol');

      let deposit = self.vault_deposits.read(vault_id);
      let enc = self.encumbered.read(vault_id);
      assert(deposit - enc >= amount, 'Insufficient capacity');

      self.encumbered.write(vault_id, enc + amount);
      self.emit(Encumbered { vault_id, amount });
    }

    fn release_encumbrance(ref self: ContractState, vault_id: u32, amount: u256) {
      let caller = get_caller_address();
      let bridge = self.bridge_protocol.read();
      assert(caller == bridge, 'Only bridge protocol');

      let enc = self.encumbered.read(vault_id);
      assert(enc >= amount, 'Over-release');
      self.encumbered.write(vault_id, enc - amount);

      self.emit(EncumbranceReleased { vault_id, amount });
    }

    fn set_bridge_protocol(ref self: ContractState, bridge: ContractAddress) {
      let caller = get_caller_address();
      assert(caller == self.owner.read(), 'Only owner');
      self.bridge_protocol.write(bridge);
    }

    fn get_pool_capacity(self: @ContractState) -> u256 {
      let total = self.total_deposited.read();
      // Subtract total encumbered across all vaults
      let mut enc_sum: u256 = 0;
      let count = self.active_vault_count.read();
      let mut i: u32 = 0;
      while i < count {
        let vid = self.vault_id_by_index.read(i);
        enc_sum += self.encumbered.read(vid);
        i += 1;
      };
      total - enc_sum
    }

    fn get_vault_pool_share(self: @ContractState, vault_id: u32) -> u256 {
      self.vault_deposits.read(vault_id)
    }

    fn get_vault_free_collateral(self: @ContractState, vault_id: u32) -> u256 {
      let deposit = self.vault_deposits.read(vault_id);
      let enc = self.encumbered.read(vault_id);
      deposit - enc
    }

    fn get_total_deposited(self: @ContractState) -> u256 {
      self.total_deposited.read()
    }

    fn get_active_vault_count(self: @ContractState) -> u32 {
      self.active_vault_count.read()
    }
  }
}
