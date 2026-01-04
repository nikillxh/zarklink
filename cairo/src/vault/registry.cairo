// Vault Registry - Manages vaults for ZCLAIM protocol

use starknet::ContractAddress;
use zclaim::vault::types::{Vault, VaultRegistration, BalanceProof, VaultStatus};

/// ERC20 interface for collateral token transfers
#[starknet::interface]
pub trait IERC20<TContractState> {
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256
    ) -> bool;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IVaultRegistry<TContractState> {
    /// Register a new vault
    fn register_vault(ref self: TContractState, registration: VaultRegistration) -> u256;
    
    /// Add collateral to vault
    fn add_collateral(ref self: TContractState, amount: u256);
    
    /// Withdraw collateral (if over-collateralized)
    fn withdraw_collateral(ref self: TContractState, amount: u256);
    
    /// Submit balance proof
    fn submit_balance_proof(ref self: TContractState, proof: BalanceProof);
    
    /// Set vault availability for issue requests
    fn set_accepts_issue(ref self: TContractState, accepts: bool);
    
    /// Set vault availability for redeem requests
    fn set_accepts_redeem(ref self: TContractState, accepts: bool);
    
    /// Get vault info
    fn get_vault(self: @TContractState, vault_id: ContractAddress) -> Vault;
    
    /// Get vault status
    fn get_vault_status(self: @TContractState, vault_id: ContractAddress) -> VaultStatus;
    
    /// Get vault count
    fn get_vault_count(self: @TContractState) -> u256;
    
    /// Get vaults accepting issue
    fn get_available_vaults_for_issue(self: @TContractState) -> Array<ContractAddress>;
    
    /// Get vaults accepting redeem
    fn get_available_vaults_for_redeem(self: @TContractState) -> Array<ContractAddress>;
    
    /// Check if vault is properly collateralized
    fn is_collateralized(self: @TContractState, vault_id: ContractAddress) -> bool;
    
    /// Get current exchange rate (ZEC/STRK)
    fn get_exchange_rate(self: @TContractState) -> u256;
    
    /// Update exchange rate (only oracle)
    fn update_exchange_rate(ref self: TContractState, rate: u256);
}

#[starknet::contract]
pub mod VaultRegistry {
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        Map, StoragePathEntry
    };
    use zclaim::vault::types::{Vault, VaultRegistration, BalanceProof, VaultStatus, collateral};
    use super::IERC20DispatcherTrait;
    use super::IERC20Dispatcher;

    #[storage]
    struct Storage {
        /// Vault address => Vault data
        vaults: Map<ContractAddress, Vault>,
        /// Vault address => Status
        vault_status: Map<ContractAddress, VaultStatus>,
        /// Total number of registered vaults
        vault_count: u256,
        /// List of all vault addresses (by index)
        vault_list: Map<u256, ContractAddress>,
        /// Current ZEC/STRK exchange rate (fixed point, 18 decimals)
        exchange_rate: u256,
        /// Oracle address (authorized to update exchange rate)
        oracle: ContractAddress,
        /// Bridge contract address
        bridge: ContractAddress,
        /// Owner address
        owner: ContractAddress,
        /// Collateral token (STRK or other ERC20)
        collateral_token: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        VaultRegistered: VaultRegistered,
        CollateralAdded: CollateralAdded,
        CollateralWithdrawn: CollateralWithdrawn,
        BalanceProofSubmitted: BalanceProofSubmitted,
        VaultStatusChanged: VaultStatusChanged,
        ExchangeRateUpdated: ExchangeRateUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VaultRegistered {
        #[key]
        pub vault: ContractAddress,
        pub collateral: u256,
        pub zcash_address_hash: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CollateralAdded {
        #[key]
        pub vault: ContractAddress,
        pub amount: u256,
        pub new_total: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CollateralWithdrawn {
        #[key]
        pub vault: ContractAddress,
        pub amount: u256,
        pub new_total: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BalanceProofSubmitted {
        #[key]
        pub vault: ContractAddress,
        pub balance_commitment: u256,
        pub exchange_rate: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VaultStatusChanged {
        #[key]
        pub vault: ContractAddress,
        pub old_status: VaultStatus,
        pub new_status: VaultStatus,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ExchangeRateUpdated {
        pub old_rate: u256,
        pub new_rate: u256,
    }

    pub mod Errors {
        pub const NOT_OWNER: felt252 = 'Registry: not owner';
        pub const NOT_ORACLE: felt252 = 'Registry: not oracle';
        pub const VAULT_EXISTS: felt252 = 'Registry: vault exists';
        pub const VAULT_NOT_FOUND: felt252 = 'Registry: vault not found';
        pub const INSUFFICIENT_COLLATERAL: felt252 = 'Registry: insufficient collat';
        pub const VAULT_NOT_ACTIVE: felt252 = 'Registry: vault not active';
        pub const CANNOT_WITHDRAW: felt252 = 'Registry: cannot withdraw';
        pub const INVALID_PROOF: felt252 = 'Registry: invalid proof';
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        oracle: ContractAddress,
        collateral_token: ContractAddress,
        initial_rate: u256
    ) {
        self.owner.write(owner);
        self.oracle.write(oracle);
        self.collateral_token.write(collateral_token);
        self.exchange_rate.write(initial_rate);
        self.vault_count.write(0);
    }

    #[abi(embed_v0)]
    impl VaultRegistryImpl of super::IVaultRegistry<ContractState> {
        fn register_vault(ref self: ContractState, registration: VaultRegistration) -> u256 {
            let caller = get_caller_address();
            
            // Check vault doesn't already exist
            let existing_status = self.vault_status.entry(caller).read();
            assert(existing_status == VaultStatus::Unregistered, Errors::VAULT_EXISTS);
            
            // Compute Zcash address hash
            let zcash_address_hash = compute_address_hash(
                registration.zcash_diversifier,
                registration.zcash_pkd
            );
            
            // Transfer collateral from caller to this contract
            let collateral_token = self.collateral_token.read();
            let this_contract = starknet::get_contract_address();
            IERC20Dispatcher { contract_address: collateral_token }
                .transfer_from(caller, this_contract, registration.collateral);
            
            // Create vault
            let vault = Vault {
                address: caller,
                zcash_address_hash,
                collateral: registration.collateral,
                balance_commitment: 0, // No obligations yet
                last_exchange_rate: self.exchange_rate.read(),
                accepts_issue: true,
                accepts_redeem: true,
                registered_at: get_block_timestamp(),
                active: true,
            };
            
            self.vaults.entry(caller).write(vault);
            self.vault_status.entry(caller).write(VaultStatus::Active);
            
            // Add to vault list
            let count = self.vault_count.read();
            self.vault_list.entry(count).write(caller);
            self.vault_count.write(count + 1);
            
            self.emit(VaultRegistered {
                vault: caller,
                collateral: registration.collateral,
                zcash_address_hash,
            });
            
            count
        }

        fn add_collateral(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            let status = self.vault_status.entry(caller).read();
            assert(status == VaultStatus::Active, Errors::VAULT_NOT_ACTIVE);
            
            // Transfer collateral from caller to this contract
            let collateral_token = self.collateral_token.read();
            let this_contract = starknet::get_contract_address();
            IERC20Dispatcher { contract_address: collateral_token }
                .transfer_from(caller, this_contract, amount);
            
            let mut vault = self.vaults.entry(caller).read();
            let new_total = vault.collateral + amount;
            vault.collateral = new_total;
            self.vaults.entry(caller).write(vault);
            
            self.emit(CollateralAdded {
                vault: caller,
                amount,
                new_total,
            });
        }

        fn withdraw_collateral(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            let status = self.vault_status.entry(caller).read();
            assert(status == VaultStatus::Active, Errors::VAULT_NOT_ACTIVE);
            
            let vault = self.vaults.entry(caller).read();
            
            // Check withdrawal doesn't under-collateralize
            let new_collateral = vault.collateral - amount;
            let required = self._calculate_required_collateral(@vault);
            assert(new_collateral >= required, Errors::CANNOT_WITHDRAW);
            
            // Transfer collateral back to vault owner
            let collateral_token = self.collateral_token.read();
            IERC20Dispatcher { contract_address: collateral_token }
                .transfer(caller, amount);
            
            let mut updated_vault = vault;
            updated_vault.collateral = new_collateral;
            self.vaults.entry(caller).write(updated_vault);
            
            self.emit(CollateralWithdrawn {
                vault: caller,
                amount,
                new_total: new_collateral,
            });
        }

        fn submit_balance_proof(ref self: ContractState, proof: BalanceProof) {
            let caller = get_caller_address();
            let status = self.vault_status.entry(caller).read();
            assert(status == VaultStatus::Active, Errors::VAULT_NOT_ACTIVE);
            
            // TODO: Verify the zk-SNARK proof
            let valid = self._verify_balance_proof(@proof);
            assert(valid, Errors::INVALID_PROOF);
            
            let mut vault = self.vaults.entry(caller).read();
            vault.balance_commitment = proof.balance_commitment;
            vault.last_exchange_rate = proof.exchange_rate;
            self.vaults.entry(caller).write(vault);
            
            self.emit(BalanceProofSubmitted {
                vault: caller,
                balance_commitment: proof.balance_commitment,
                exchange_rate: proof.exchange_rate,
            });
        }

        fn set_accepts_issue(ref self: ContractState, accepts: bool) {
            let caller = get_caller_address();
            let mut vault = self.vaults.entry(caller).read();
            vault.accepts_issue = accepts;
            self.vaults.entry(caller).write(vault);
        }

        fn set_accepts_redeem(ref self: ContractState, accepts: bool) {
            let caller = get_caller_address();
            let mut vault = self.vaults.entry(caller).read();
            vault.accepts_redeem = accepts;
            self.vaults.entry(caller).write(vault);
        }

        fn get_vault(self: @ContractState, vault_id: ContractAddress) -> Vault {
            self.vaults.entry(vault_id).read()
        }

        fn get_vault_status(self: @ContractState, vault_id: ContractAddress) -> VaultStatus {
            self.vault_status.entry(vault_id).read()
        }

        fn get_vault_count(self: @ContractState) -> u256 {
            self.vault_count.read()
        }

        fn get_available_vaults_for_issue(self: @ContractState) -> Array<ContractAddress> {
            let mut result: Array<ContractAddress> = array![];
            let count = self.vault_count.read();
            
            let mut i: u256 = 0;
            loop {
                if i >= count {
                    break;
                }
                let vault_addr = self.vault_list.entry(i).read();
                let vault = self.vaults.entry(vault_addr).read();
                let status = self.vault_status.entry(vault_addr).read();
                
                if status == VaultStatus::Active && vault.accepts_issue {
                    result.append(vault_addr);
                }
                i += 1;
            };
            
            result
        }

        fn get_available_vaults_for_redeem(self: @ContractState) -> Array<ContractAddress> {
            let mut result: Array<ContractAddress> = array![];
            let count = self.vault_count.read();
            
            let mut i: u256 = 0;
            loop {
                if i >= count {
                    break;
                }
                let vault_addr = self.vault_list.entry(i).read();
                let vault = self.vaults.entry(vault_addr).read();
                let status = self.vault_status.entry(vault_addr).read();
                
                if status == VaultStatus::Active && vault.accepts_redeem {
                    result.append(vault_addr);
                }
                i += 1;
            };
            
            result
        }

        fn is_collateralized(self: @ContractState, vault_id: ContractAddress) -> bool {
            let vault = self.vaults.entry(vault_id).read();
            let required = self._calculate_required_collateral(@vault);
            vault.collateral >= required
        }

        fn get_exchange_rate(self: @ContractState) -> u256 {
            self.exchange_rate.read()
        }

        fn update_exchange_rate(ref self: ContractState, rate: u256) {
            let caller = get_caller_address();
            assert(caller == self.oracle.read(), Errors::NOT_ORACLE);
            
            let old_rate = self.exchange_rate.read();
            self.exchange_rate.write(rate);
            
            self.emit(ExchangeRateUpdated {
                old_rate,
                new_rate: rate,
            });
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _calculate_required_collateral(self: @ContractState, vault: @Vault) -> u256 {
            // Required = obligations * exchange_rate * collateral_ratio
            // Since obligations are hidden, use balance_commitment
            // In production, this requires homomorphic verification
            
            let rate = self.exchange_rate.read();
            // Simplified: assume commitment directly represents value
            // In production, verify via zk-SNARK
            (*vault.balance_commitment * rate * collateral::STANDARD_RATIO) 
                / collateral::RATIO_DENOMINATOR
        }

        fn _verify_balance_proof(self: @ContractState, proof: @BalanceProof) -> bool {
            // Verify zk-SNARK proof for vault solvency
            // Proof demonstrates:
            // (Σ mint_values - Σ burn_values) * exchange_rate * collateral_ratio ≤ collateral
            //
            // Public inputs:
            // - balance_commitment: Pedersen commitment to net obligations
            // - exchange_rate: Current ZEC/collateral rate
            // - valid_at_height: Block height at which proof is valid
            //
            // In production: use Groth16 verifier
            // For now: accept proofs from registered vaults with valid structure
            
            // Basic validation: proof must have data
            let has_proof_data = proof.proof.len() > 0;
            
            // Verify exchange rate matches current
            let current_rate = self.exchange_rate.read();
            let rate_valid = *proof.exchange_rate == current_rate;
            
            // In production: call Groth16 verifier
            // verify_groth16_proof(proof.proof, public_inputs, vk_hash)
            
            has_proof_data && rate_valid
        }
    }

    /// Compute hash of Zcash shielded address (d, pkd)
    fn compute_address_hash(diversifier: u256, pkd: u256) -> u256 {
        // Use BLAKE2b with personalization for proper derivation
        // Simplified XOR for now - in production use:
        // blake2b_256_personalized([d, pkd], "ZclaimAddr")
        diversifier ^ pkd
    }
}
