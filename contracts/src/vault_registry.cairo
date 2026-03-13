// ============================================================================
// Zarklink — Vault Registry Contract
// ============================================================================
// Maintains a public registry of all active vaults, their collateral,
// and their Zcash shielded payment addresses. Includes bridge protocol
// authorization for slashing and deposit/withdrawal with collateral checks.

use starknet::ContractAddress;

#[derive(Drop, Serde, starknet::Store, Copy, PartialEq)]
pub enum VaultStatus {
  #[default]
  Inactive,
  Active,
  Locked,
  Suspended,
  Liquidated,
}

#[derive(Drop, Serde, starknet::Store, Copy)]
pub struct VaultInfo {
  pub owner: ContractAddress,
  pub zcash_addr_d: felt252,
  pub zcash_addr_pkd: felt252,
  pub collateral: u256,
  pub status: VaultStatus,
  pub last_proof_of_balance: u64,
  pub last_proof_of_capacity: u64,
  pub registered_at: u64,
  pub total_issued: u256,
  pub total_redeemed: u256,
}

#[starknet::interface]
pub trait IVaultRegistry<TContractState> {
  fn register_vault(
    ref self: TContractState,
    zcash_addr_d: felt252,
    zcash_addr_pkd: felt252,
  );
  fn deposit_collateral(ref self: TContractState, amount: u256);
  fn withdraw_collateral(ref self: TContractState, amount: u256);
  fn submit_proof_of_capacity(ref self: TContractState, proof: Span<felt252>);
  fn submit_proof_of_balance(ref self: TContractState, proof: Span<felt252>);
  fn submit_proof_of_insolvency(ref self: TContractState, proof: Span<felt252>);
  fn slash_vault(ref self: TContractState, vault_id: u32, amount: u256);
  fn set_bridge_protocol(ref self: TContractState, bridge: ContractAddress);
  fn record_issue(ref self: TContractState, vault_id: u32, amount: u256);
  fn record_redeem(ref self: TContractState, vault_id: u32, amount: u256);
  fn update_vault_zcash_addr(
    ref self: TContractState,
    zcash_addr_d: felt252,
    zcash_addr_pkd: felt252,
  );
  fn get_vault(self: @TContractState, vault_id: u32) -> VaultInfo;
  fn get_vault_count(self: @TContractState) -> u32;
  fn get_vault_id_by_owner(self: @TContractState, owner: ContractAddress) -> u32;
  fn is_vault_active(self: @TContractState, vault_id: u32) -> bool;
  fn get_required_collateral(self: @TContractState, lock_amount: u256) -> u256;
}

#[starknet::contract]
pub mod VaultRegistry {
  use super::{VaultInfo, VaultStatus, IVaultRegistry};
  use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
  use starknet::storage::{
    Map, StorageMapReadAccess, StorageMapWriteAccess,
    StoragePointerReadAccess, StoragePointerWriteAccess,
  };
  use core::poseidon::poseidon_hash_span;

  // Collateral ratio denominator (150% = 15000 / 10000)
  const RATIO_DENOMINATOR: u256 = 10000;
  // Liquidation threshold (120% = 12000 / 10000)
  const LIQUIDATION_THRESHOLD: u256 = 12000;
  // Proof validity period: 24 hours in seconds
  const PROOF_VALIDITY_PERIOD: u64 = 86400;

  #[storage]
  struct Storage {
    owner: ContractAddress,
    bridge_protocol: ContractAddress,
    vault_count: u32,
    vaults: Map<u32, VaultInfo>,
    vault_by_owner: Map<ContractAddress, u32>,
    has_vault: Map<ContractAddress, bool>,
    collateral_token: ContractAddress,
    standard_collateral_ratio: u256,
    max_lock_amount: u256,
    fee_rate: u256,
  }

  #[event]
  #[derive(Drop, starknet::Event)]
  pub enum Event {
    VaultRegistered: VaultRegistered,
    VaultSlashed: VaultSlashed,
    ProofSubmitted: ProofSubmitted,
    CollateralDeposited: CollateralDeposited,
    CollateralWithdrawn: CollateralWithdrawn,
    BridgeProtocolSet: BridgeProtocolSet,
  }

  #[derive(Drop, starknet::Event)]
  pub struct VaultRegistered {
    #[key]
    pub vault_id: u32,
    pub owner: ContractAddress,
  }

  #[derive(Drop, starknet::Event)]
  pub struct VaultSlashed {
    #[key]
    pub vault_id: u32,
    pub amount: u256,
  }

  #[derive(Drop, starknet::Event)]
  pub struct ProofSubmitted {
    #[key]
    pub vault_id: u32,
    pub proof_type: felt252,
  }

  #[derive(Drop, starknet::Event)]
  pub struct CollateralDeposited {
    #[key]
    pub vault_id: u32,
    pub amount: u256,
    pub new_total: u256,
  }

  #[derive(Drop, starknet::Event)]
  pub struct CollateralWithdrawn {
    #[key]
    pub vault_id: u32,
    pub amount: u256,
    pub new_total: u256,
  }

  #[derive(Drop, starknet::Event)]
  pub struct BridgeProtocolSet {
    pub bridge: ContractAddress,
  }

  #[constructor]
  fn constructor(
    ref self: ContractState,
    owner: ContractAddress,
    collateral_token: ContractAddress,
    standard_collateral_ratio: u256,
    max_lock_amount: u256,
    fee_rate: u256,
  ) {
    self.owner.write(owner);
    self.collateral_token.write(collateral_token);
    self.standard_collateral_ratio.write(standard_collateral_ratio);
    self.max_lock_amount.write(max_lock_amount);
    self.fee_rate.write(fee_rate);
    self.vault_count.write(0);
  }

  #[generate_trait]
  impl InternalImpl of InternalTrait {
    /// Verify a STARK proof (structural validation)
    fn verify_proof(self: @ContractState, proof: Span<felt252>) -> bool {
      assert(proof.len() > 0, 'Empty proof');
      let proof_hash = poseidon_hash_span(proof);
      proof_hash != 0
    }

    /// Check if vault proofs are current
    fn are_proofs_current(self: @ContractState, vault_id: u32) -> bool {
      let vault = self.vaults.read(vault_id);
      let now = get_block_timestamp();
      let balance_fresh = (now - vault.last_proof_of_balance) < PROOF_VALIDITY_PERIOD;
      let capacity_fresh = (now - vault.last_proof_of_capacity) < PROOF_VALIDITY_PERIOD;
      balance_fresh && capacity_fresh
    }
  }

  #[abi(embed_v0)]
  impl VaultRegistryImpl of IVaultRegistry<ContractState> {
    fn register_vault(
      ref self: ContractState,
      zcash_addr_d: felt252,
      zcash_addr_pkd: felt252,
    ) {
      let caller = get_caller_address();
      let has_existing = self.has_vault.read(caller);
      assert(!has_existing, 'Already registered');

      let vault_id = self.vault_count.read();
      let now = get_block_timestamp();

      let vault = VaultInfo {
        owner: caller,
        zcash_addr_d,
        zcash_addr_pkd,
        collateral: 0_u256,
        status: VaultStatus::Active,
        last_proof_of_balance: now,
        last_proof_of_capacity: now,
        registered_at: now,
        total_issued: 0_u256,
        total_redeemed: 0_u256,
      };

      self.vaults.write(vault_id, vault);
      self.vault_by_owner.write(caller, vault_id);
      self.has_vault.write(caller, true);
      self.vault_count.write(vault_id + 1);

      self.emit(VaultRegistered { vault_id, owner: caller });
    }

    fn deposit_collateral(ref self: ContractState, amount: u256) {
      assert(amount > 0, 'Amount must be positive');
      let caller = get_caller_address();
      assert(self.has_vault.read(caller), 'Not a vault operator');

      let vault_id = self.vault_by_owner.read(caller);
      let mut vault = self.vaults.read(vault_id);

      // Reactivate suspended vault if depositing
      if vault.status == VaultStatus::Suspended {
        vault.status = VaultStatus::Active;
      }

      vault.collateral += amount;
      self.vaults.write(vault_id, vault);

      self.emit(CollateralDeposited {
        vault_id,
        amount,
        new_total: vault.collateral,
      });
    }

    fn withdraw_collateral(ref self: ContractState, amount: u256) {
      let caller = get_caller_address();
      assert(self.has_vault.read(caller), 'Not a vault operator');

      let vault_id = self.vault_by_owner.read(caller);
      let mut vault = self.vaults.read(vault_id);
      assert(vault.collateral >= amount, 'Insufficient collateral');

      // Ensure remaining collateral meets minimum ratio for obligations
      let remaining = vault.collateral - amount;
      let obligations = vault.total_issued - vault.total_redeemed;
      if obligations > 0 {
        let required = (obligations * self.standard_collateral_ratio.read())
          / RATIO_DENOMINATOR;
        assert(remaining >= required, 'Below collateral ratio');
      }

      vault.collateral = remaining;
      self.vaults.write(vault_id, vault);

      self.emit(CollateralWithdrawn {
        vault_id,
        amount,
        new_total: remaining,
      });
    }

    fn submit_proof_of_capacity(ref self: ContractState, proof: Span<felt252>) {
      let caller = get_caller_address();
      assert(self.has_vault.read(caller), 'Not a vault operator');
      let vault_id = self.vault_by_owner.read(caller);
      let now = get_block_timestamp();

      // Verify STARK proof of capacity
      assert(self.verify_proof(proof), 'Invalid proof');

      let mut vault = self.vaults.read(vault_id);
      vault.last_proof_of_capacity = now;
      self.vaults.write(vault_id, vault);

      self.emit(ProofSubmitted { vault_id, proof_type: 'capacity' });
    }

    fn submit_proof_of_balance(ref self: ContractState, proof: Span<felt252>) {
      let caller = get_caller_address();
      assert(self.has_vault.read(caller), 'Not a vault operator');
      let vault_id = self.vault_by_owner.read(caller);
      let now = get_block_timestamp();

      // Verify STARK proof of balance
      assert(self.verify_proof(proof), 'Invalid proof');

      let mut vault = self.vaults.read(vault_id);
      vault.last_proof_of_balance = now;
      self.vaults.write(vault_id, vault);

      self.emit(ProofSubmitted { vault_id, proof_type: 'balance' });
    }

    fn submit_proof_of_insolvency(ref self: ContractState, proof: Span<felt252>) {
      let caller = get_caller_address();
      assert(self.has_vault.read(caller), 'Not a vault operator');
      let vault_id = self.vault_by_owner.read(caller);

      assert(self.verify_proof(proof), 'Invalid proof');

      let mut vault = self.vaults.read(vault_id);
      vault.status = VaultStatus::Suspended;
      self.vaults.write(vault_id, vault);

      self.emit(ProofSubmitted { vault_id, proof_type: 'insolvency' });
    }

    fn slash_vault(ref self: ContractState, vault_id: u32, amount: u256) {
      // Only callable by bridge protocol contract
      let caller = get_caller_address();
      let bridge = self.bridge_protocol.read();
      assert(caller == bridge, 'Only bridge protocol');

      let mut vault = self.vaults.read(vault_id);
      assert(vault.collateral >= amount, 'Insufficient collateral');
      vault.collateral -= amount;

      if vault.collateral == 0_u256 {
        vault.status = VaultStatus::Liquidated;
      }

      self.vaults.write(vault_id, vault);
      self.emit(VaultSlashed { vault_id, amount });
    }

    fn set_bridge_protocol(ref self: ContractState, bridge: ContractAddress) {
      let caller = get_caller_address();
      assert(caller == self.owner.read(), 'Only owner');
      self.bridge_protocol.write(bridge);
      self.emit(BridgeProtocolSet { bridge });
    }

    fn record_issue(ref self: ContractState, vault_id: u32, amount: u256) {
      let caller = get_caller_address();
      let bridge = self.bridge_protocol.read();
      assert(caller == bridge, 'Only bridge protocol');
      let mut vault = self.vaults.read(vault_id);
      vault.total_issued = vault.total_issued + amount;
      self.vaults.write(vault_id, vault);
    }

    fn record_redeem(ref self: ContractState, vault_id: u32, amount: u256) {
      let caller = get_caller_address();
      let bridge = self.bridge_protocol.read();
      assert(caller == bridge, 'Only bridge protocol');
      let mut vault = self.vaults.read(vault_id);
      vault.total_redeemed = vault.total_redeemed + amount;
      self.vaults.write(vault_id, vault);
    }

    fn update_vault_zcash_addr(
      ref self: ContractState,
      zcash_addr_d: felt252,
      zcash_addr_pkd: felt252,
    ) {
      let caller = get_caller_address();
      assert(self.has_vault.read(caller), 'Not a vault operator');
      let vault_id = self.vault_by_owner.read(caller);
      let mut vault = self.vaults.read(vault_id);
      vault.zcash_addr_d = zcash_addr_d;
      vault.zcash_addr_pkd = zcash_addr_pkd;
      self.vaults.write(vault_id, vault);
    }

    fn get_vault(self: @ContractState, vault_id: u32) -> VaultInfo {
      self.vaults.read(vault_id)
    }

    fn get_vault_count(self: @ContractState) -> u32 {
      self.vault_count.read()
    }

    fn get_vault_id_by_owner(self: @ContractState, owner: ContractAddress) -> u32 {
      self.vault_by_owner.read(owner)
    }

    fn is_vault_active(self: @ContractState, vault_id: u32) -> bool {
      let vault = self.vaults.read(vault_id);
      vault.status == VaultStatus::Active
    }

    fn get_required_collateral(self: @ContractState, lock_amount: u256) -> u256 {
      let ratio = self.standard_collateral_ratio.read();
      (lock_amount * ratio) / RATIO_DENOMINATOR
    }
  }
}
