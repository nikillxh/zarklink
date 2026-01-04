// ZCLAIM Bridge - Main Bridge Contract
// Coordinates Issue and Redeem protocols

use starknet::ContractAddress;
use zclaim::relay::types::{LockPermit, MintTransfer, BurnTransfer, IssueStatus, RedeemStatus};

#[starknet::interface]
pub trait IZclaimBridge<TContractState> {
    // ============ Issue Protocol ============
    
    /// Step 1: Request lock permit (user wants to lock ZEC)
    fn request_lock(
        ref self: TContractState,
        vault: ContractAddress,
        user_emk: u256
    ) -> u256;
    
    /// Step 2: Submit mint transaction with proof
    fn mint(
        ref self: TContractState,
        permit_nonce: u256,
        transfer: MintTransfer
    );
    
    /// Step 3a: Vault confirms issue (happy path)
    fn confirm_issue(ref self: TContractState, permit_nonce: u256);
    
    /// Step 3b: Vault challenges issue (bad encryption)
    fn challenge_issue(
        ref self: TContractState,
        permit_nonce: u256,
        shared_secret: u256
    );
    
    // ============ Redeem Protocol ============
    
    /// Step 1: Submit burn transaction
    fn burn(ref self: TContractState, transfer: BurnTransfer) -> u256;
    
    /// Step 2a: Vault confirms redeem (proves note release)
    fn confirm_redeem(
        ref self: TContractState,
        burn_nonce: u256,
        note_commitment: u256,
        block_hash: u256,
        proof_siblings: Array<u256>,
        proof_index: u64
    );
    
    /// Step 2b: Vault challenges redeem (bad encryption)
    fn challenge_redeem(
        ref self: TContractState,
        burn_nonce: u256,
        shared_secret: u256
    );
    
    // ============ View Functions ============
    
    /// Get issue request status
    fn get_issue_status(self: @TContractState, permit_nonce: u256) -> IssueStatus;
    
    /// Get redeem request status
    fn get_redeem_status(self: @TContractState, burn_nonce: u256) -> RedeemStatus;
    
    /// Get lock permit
    fn get_lock_permit(self: @TContractState, nonce: u256) -> LockPermit;
    
    /// Get wZEC token address
    fn get_token(self: @TContractState) -> ContractAddress;
    
    /// Get relay system address
    fn get_relay(self: @TContractState) -> ContractAddress;
    
    /// Get vault registry address
    fn get_registry(self: @TContractState) -> ContractAddress;
}

#[starknet::contract]
pub mod ZclaimBridge {
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        Map, StoragePathEntry
    };
    use core::num::traits::Zero;
    use zclaim::relay::types::{
        LockPermit, MintTransfer, BurnTransfer, 
        IssueStatus, RedeemStatus, MerkleProof, constants
    };
    use zclaim::token::wzec::{IwZECDispatcher, IwZECDispatcherTrait};
    use zclaim::relay::relay_system::{IRelaySystemDispatcher, IRelaySystemDispatcherTrait};
    use zclaim::vault::registry::{IVaultRegistryDispatcher, IVaultRegistryDispatcherTrait};
    use zclaim::crypto::snark::{Groth16Proof, MintProofInputs, verify_mint_proof};
    use zclaim::crypto::encryption::{derive_shared_secret, derive_encryption_key};
    use zclaim::crypto::commitments::{verify_note_commitment, derive_rcm_from_nonce};

    #[storage]
    struct Storage {
        /// wZEC token contract
        token: ContractAddress,
        /// Relay system contract
        relay: ContractAddress,
        /// Vault registry contract
        registry: ContractAddress,
        /// Owner
        owner: ContractAddress,
        
        /// Permit nonce counter
        permit_nonce: u256,
        /// Burn nonce counter
        burn_nonce: u256,
        
        /// Lock permits by nonce
        lock_permits: Map<u256, LockPermit>,
        /// Issue status by permit nonce
        issue_status: Map<u256, IssueStatus>,
        /// Mint transfer data by permit nonce
        mint_transfers: Map<u256, MintTransferStorage>,
        
        /// Redeem status by burn nonce
        redeem_status: Map<u256, RedeemStatus>,
        /// Burn transfer data by burn nonce
        burn_transfers: Map<u256, BurnTransferStorage>,
        
        /// Fee rate (1/FEE_DENOMINATOR)
        fee_rate: u256,
        /// Fee recipient
        fee_recipient: ContractAddress,
    }

    /// Simplified storage for mint transfer (without dynamic arrays)
    #[derive(Drop, Serde, starknet::Store)]
    struct MintTransferStorage {
        cv: u256,
        cvn: u256,
        permit_nonce: u256,
        note_commitment: u256,
        block_hash: u256,
        user: ContractAddress,
        vault: ContractAddress,
        vault_d: u256,        // Vault's diversifier
        vault_pkd: u256,      // Vault's diversified key
        user_emk: u256,       // User's minting key
        submitted_at: u64,
    }

    /// Simplified storage for burn transfer
    #[derive(Drop, Serde, starknet::Store)]
    struct BurnTransferStorage {
        cv: u256,
        cvn: u256,
        vault: ContractAddress,
        requested_note_commitment: u256,
        user: ContractAddress,
        encrypted_note_epk: u256,  // Ephemeral key for challenge verification
        submitted_at: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        LockPermitIssued: LockPermitIssued,
        MintSubmitted: MintSubmitted,
        IssueConfirmed: IssueConfirmed,
        IssueChallenged: IssueChallenged,
        BurnSubmitted: BurnSubmitted,
        RedeemConfirmed: RedeemConfirmed,
        RedeemChallenged: RedeemChallenged,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LockPermitIssued {
        #[key]
        pub nonce: u256,
        #[key]
        pub vault: ContractAddress,
        pub user: ContractAddress,
        pub expires_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct MintSubmitted {
        #[key]
        pub permit_nonce: u256,
        pub note_commitment: u256,
        pub block_hash: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct IssueConfirmed {
        #[key]
        pub permit_nonce: u256,
        pub user: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct IssueChallenged {
        #[key]
        pub permit_nonce: u256,
        pub vault: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BurnSubmitted {
        #[key]
        pub burn_nonce: u256,
        pub vault: ContractAddress,
        pub user: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RedeemConfirmed {
        #[key]
        pub burn_nonce: u256,
        pub note_commitment: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RedeemChallenged {
        #[key]
        pub burn_nonce: u256,
        pub vault: ContractAddress,
    }

    pub mod Errors {
        pub const NOT_OWNER: felt252 = 'Bridge: not owner';
        pub const VAULT_NOT_AVAILABLE: felt252 = 'Bridge: vault not available';
        pub const PERMIT_EXPIRED: felt252 = 'Bridge: permit expired';
        pub const PERMIT_USED: felt252 = 'Bridge: permit already used';
        pub const INVALID_PERMIT: felt252 = 'Bridge: invalid permit';
        pub const NOT_VAULT: felt252 = 'Bridge: caller not vault';
        pub const WRONG_STATUS: felt252 = 'Bridge: wrong status';
        pub const BLOCK_NOT_CONFIRMED: felt252 = 'Bridge: block not confirmed';
        pub const INVALID_PROOF: felt252 = 'Bridge: invalid proof';
        pub const TIMEOUT_NOT_REACHED: felt252 = 'Bridge: timeout not reached';
        pub const INVALID_AMOUNT: felt252 = 'Bridge: invalid amount';
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        token: ContractAddress,
        relay: ContractAddress,
        registry: ContractAddress,
        owner: ContractAddress,
        fee_rate: u256
    ) {
        self.token.write(token);
        self.relay.write(relay);
        self.registry.write(registry);
        self.owner.write(owner);
        self.fee_rate.write(fee_rate);
        self.fee_recipient.write(owner);
        self.permit_nonce.write(0);
        self.burn_nonce.write(0);
    }

    #[abi(embed_v0)]
    impl ZclaimBridgeImpl of super::IZclaimBridge<ContractState> {
        fn request_lock(
            ref self: ContractState,
            vault: ContractAddress,
            user_emk: u256
        ) -> u256 {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Verify vault is available for issue
            let registry = IVaultRegistryDispatcher { contract_address: self.registry.read() };
            let vault_info = registry.get_vault(vault);
            assert(vault_info.accepts_issue, Errors::VAULT_NOT_AVAILABLE);
            
            // Generate permit nonce
            let nonce = self.permit_nonce.read();
            self.permit_nonce.write(nonce + 1);
            
            // Create lock permit
            let permit = LockPermit {
                nonce,
                vault_address_hash: vault_info.zcash_address_hash,
                user_emk,
                issued_at: timestamp,
                expires_at: timestamp + constants::MINT_TIMEOUT,
                used: false,
            };
            
            self.lock_permits.entry(nonce).write(permit);
            self.issue_status.entry(nonce).write(IssueStatus::AwaitingMint);
            
            self.emit(LockPermitIssued {
                nonce,
                vault,
                user: caller,
                expires_at: timestamp + constants::MINT_TIMEOUT,
            });
            
            nonce
        }

        fn mint(
            ref self: ContractState,
            permit_nonce: u256,
            transfer: MintTransfer
        ) {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Verify permit exists and is valid
            let permit = self.lock_permits.entry(permit_nonce).read();
            assert(permit.nonce == permit_nonce, Errors::INVALID_PERMIT);
            assert(!permit.used, Errors::PERMIT_USED);
            assert(timestamp <= permit.expires_at, Errors::PERMIT_EXPIRED);
            
            // Verify status
            let status = self.issue_status.entry(permit_nonce).read();
            assert(status == IssueStatus::AwaitingMint, Errors::WRONG_STATUS);
            
            // Verify block is confirmed
            let relay = IRelaySystemDispatcher { contract_address: self.relay.read() };
            assert(relay.is_confirmed(transfer.block_hash), Errors::BLOCK_NOT_CONFIRMED);
            
            // Verify note commitment Merkle proof
            let proof = MerkleProof {
                siblings: transfer.merkle_proof.siblings,
                index: transfer.merkle_proof.index,
            };
            let valid = relay.verify_note_commitment(
                transfer.block_hash,
                transfer.note_commitment,
                proof
            );
            assert(valid, Errors::INVALID_PROOF);
            
            // TODO: Verify zk-SNARK proof (πZKMint)
            // Build proof inputs and verify
            let proof_inputs = MintProofInputs {
                cv: transfer.cv,
                cvn: transfer.cvn,
                note_commitment: transfer.note_commitment,
                permit_nonce,
                vault_address_hash: permit.vault_address_hash,
                user_emk: permit.user_emk,
            };
            // Note: In production, proof would be passed in transfer
            // For now, we skip full proof verification
            
            // Verify note commitment is correctly derived
            // Get vault's Zcash address from registry
            let registry = IVaultRegistryDispatcher { contract_address: self.registry.read() };
            let vault_data = registry.get_vault(caller);
            let vault_d = vault_data.zcash_address_hash; // Simplified: use hash as d
            let vault_pkd = vault_data.zcash_address_hash; // Simplified: would be separate field
            
            // Verify rcm derivation (note randomness from permit nonce)
            let _expected_rcm = derive_rcm_from_nonce(permit_nonce, permit.user_emk);
            // In production: verify note_commitment matches expected derivation
            
            // Save user_emk before permit is consumed
            let user_emk = permit.user_emk;
            
            // Mark permit as used
            let mut updated_permit = permit;
            updated_permit.used = true;
            self.lock_permits.entry(permit_nonce).write(updated_permit);
            
            // Store mint transfer data with vault info
            let mint_storage = MintTransferStorage {
                cv: transfer.cv,
                cvn: transfer.cvn,
                permit_nonce,
                note_commitment: transfer.note_commitment,
                block_hash: transfer.block_hash,
                user: caller,
                vault: caller,  // Get from permit/registry lookup
                vault_d,
                vault_pkd,
                user_emk,
                submitted_at: timestamp,
            };
            self.mint_transfers.entry(permit_nonce).write(mint_storage);
            
            // Update status to awaiting confirmation
            self.issue_status.entry(permit_nonce).write(IssueStatus::AwaitingConfirmation);
            
            self.emit(MintSubmitted {
                permit_nonce,
                note_commitment: transfer.note_commitment,
                block_hash: transfer.block_hash,
            });
        }

        fn confirm_issue(ref self: ContractState, permit_nonce: u256) {
            let caller = get_caller_address();
            
            // Verify status
            let status = self.issue_status.entry(permit_nonce).read();
            assert(status == IssueStatus::AwaitingConfirmation, Errors::WRONG_STATUS);
            
            // Get mint transfer
            let mint_storage = self.mint_transfers.entry(permit_nonce).read();
            
            // Verify caller is the vault (vault that received the locked ZEC)
            // In production: verify via registry or permit
            // For now: any registered vault can confirm (to be tightened)
            let registry = IVaultRegistryDispatcher { contract_address: self.registry.read() };
            let vault_data = registry.get_vault(caller);
            assert(vault_data.active, Errors::NOT_VAULT);
            
            // Calculate amount to mint from net value commitment
            // In production: extract from proof public inputs
            // cvn represents the net amount after fee
            let amount = mint_storage.cvn;
            
            // Mint wZEC to user
            let token = IwZECDispatcher { contract_address: self.token.read() };
            token.mint(mint_storage.user, amount);
            
            // Update status
            self.issue_status.entry(permit_nonce).write(IssueStatus::Confirmed);
            
            self.emit(IssueConfirmed {
                permit_nonce,
                user: mint_storage.user,
                amount,
            });
        }

        fn challenge_issue(
            ref self: ContractState,
            permit_nonce: u256,
            shared_secret: u256
        ) {
            let caller = get_caller_address();
            
            // Verify status
            let status = self.issue_status.entry(permit_nonce).read();
            assert(status == IssueStatus::AwaitingConfirmation, Errors::WRONG_STATUS);
            
            // Get mint transfer
            let mint_storage = self.mint_transfers.entry(permit_nonce).read();
            
            // Verify caller is a registered vault
            let registry = IVaultRegistryDispatcher { contract_address: self.registry.read() };
            let vault_data = registry.get_vault(caller);
            assert(vault_data.active, Errors::NOT_VAULT);
            
            // Verify the shared secret proves bad encryption
            // 1. Derive encryption key from shared secret
            let enc_key = derive_encryption_key(shared_secret, mint_storage.note_commitment);
            
            // 2. Verify the derivation matches vault's private key
            // In production: vault proves knowledge of sk such that:
            //   shared_secret = ECDH(epk, sk)
            // For now: we trust the vault's claim if they're registered
            
            // 3. If vault can show decryption reveals invalid note,
            //    the challenge is valid
            // The fact that vault is challenging means they couldn't
            // decrypt a valid note - we accept this for now
            
            // Update status
            self.issue_status.entry(permit_nonce).write(IssueStatus::Challenged);
            
            self.emit(IssueChallenged {
                permit_nonce,
                vault: caller,
            });
        }

        fn burn(ref self: ContractState, transfer: BurnTransfer) -> u256 {
            let caller = get_caller_address();
            let timestamp = get_block_timestamp();
            
            // Generate burn nonce
            let nonce = self.burn_nonce.read();
            self.burn_nonce.write(nonce + 1);
            
            // Extract amount from value commitment
            // cv represents the committed value
            // In production: verify commitment is well-formed via zk-SNARK
            let amount = transfer.cv;
            
            // Verify amount is within acceptable range
            assert(amount > 0, Errors::INVALID_AMOUNT);
            
            // Burn wZEC from user
            let token = IwZECDispatcher { contract_address: self.token.read() };
            token.burn(caller, amount);
            
            // Extract ephemeral key from encrypted note for challenge verification
            // In production: encrypted_note would contain epk
            let encrypted_note_epk: u256 = 0; // Placeholder - would come from transfer
            
            // Store burn transfer data
            let burn_storage = BurnTransferStorage {
                cv: transfer.cv,
                cvn: transfer.cvn,
                vault: transfer.vault_id,
                requested_note_commitment: transfer.requested_note_commitment,
                user: caller,
                encrypted_note_epk,
                submitted_at: timestamp,
            };
            self.burn_transfers.entry(nonce).write(burn_storage);
            
            // Update status
            self.redeem_status.entry(nonce).write(RedeemStatus::AwaitingRelease);
            
            self.emit(BurnSubmitted {
                burn_nonce: nonce,
                vault: transfer.vault_id,
                user: caller,
            });
            
            nonce
        }

        fn confirm_redeem(
            ref self: ContractState,
            burn_nonce: u256,
            note_commitment: u256,
            block_hash: u256,
            proof_siblings: Array<u256>,
            proof_index: u64
        ) {
            let caller = get_caller_address();
            
            // Verify status
            let status = self.redeem_status.entry(burn_nonce).read();
            assert(status == RedeemStatus::AwaitingRelease, Errors::WRONG_STATUS);
            
            // Get burn transfer
            let burn_storage = self.burn_transfers.entry(burn_nonce).read();
            
            // Verify caller is the vault
            assert(caller == burn_storage.vault, Errors::NOT_VAULT);
            
            // Verify note commitment matches what was requested
            assert(note_commitment == burn_storage.requested_note_commitment, Errors::INVALID_PROOF);
            
            // Verify block is confirmed
            let relay = IRelaySystemDispatcher { contract_address: self.relay.read() };
            assert(relay.is_confirmed(block_hash), Errors::BLOCK_NOT_CONFIRMED);
            
            // Verify note commitment Merkle proof
            let proof = MerkleProof {
                siblings: proof_siblings,
                index: proof_index,
            };
            let valid = relay.verify_note_commitment(block_hash, note_commitment, proof);
            assert(valid, Errors::INVALID_PROOF);
            
            // Update status
            self.redeem_status.entry(burn_nonce).write(RedeemStatus::Confirmed);
            
            self.emit(RedeemConfirmed {
                burn_nonce,
                note_commitment,
            });
        }

        fn challenge_redeem(
            ref self: ContractState,
            burn_nonce: u256,
            shared_secret: u256
        ) {
            let caller = get_caller_address();
            
            // Verify status
            let status = self.redeem_status.entry(burn_nonce).read();
            assert(status == RedeemStatus::AwaitingRelease, Errors::WRONG_STATUS);
            
            // Get burn transfer
            let burn_storage = self.burn_transfers.entry(burn_nonce).read();
            
            // Verify caller is the vault
            assert(caller == burn_storage.vault, Errors::NOT_VAULT);
            
            // Verify the shared secret proves bad encryption
            // 1. Derive encryption key from shared secret and ephemeral key
            let enc_key = derive_encryption_key(shared_secret, burn_storage.encrypted_note_epk);
            
            // 2. Vault proves that decryption with this key reveals
            //    different note parameters than what user requested
            // In production: vault would provide decrypted plaintext
            // and we verify it hashes to different commitment
            
            // 3. Accept challenge from vault - they proved bad encryption
            // Update status
            self.redeem_status.entry(burn_nonce).write(RedeemStatus::Challenged);
            
            self.emit(RedeemChallenged {
                burn_nonce,
                vault: caller,
            });
        }

        fn get_issue_status(self: @ContractState, permit_nonce: u256) -> IssueStatus {
            self.issue_status.entry(permit_nonce).read()
        }

        fn get_redeem_status(self: @ContractState, burn_nonce: u256) -> RedeemStatus {
            self.redeem_status.entry(burn_nonce).read()
        }

        fn get_lock_permit(self: @ContractState, nonce: u256) -> LockPermit {
            self.lock_permits.entry(nonce).read()
        }

        fn get_token(self: @ContractState) -> ContractAddress {
            self.token.read()
        }

        fn get_relay(self: @ContractState) -> ContractAddress {
            self.relay.read()
        }

        fn get_registry(self: @ContractState) -> ContractAddress {
            self.registry.read()
        }
    }
}
