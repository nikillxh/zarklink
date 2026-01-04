// ZCLAIM Bridge - Burn Helper Module
// Helper functions for Redeem protocol (wZEC → ZEC)

use starknet::ContractAddress;
use zclaim::relay::types::BurnTransfer;
use zclaim::crypto::commitments::{
    compute_note_commitment, SaplingNote
};
use zclaim::crypto::snark::{verify_burn_proof, Groth16Proof, BurnProofInputs};
use zclaim::crypto::encryption::{derive_shared_secret, verify_decryption_challenge, EncryptedNote};

/// Helper struct for burn transaction verification
#[derive(Drop, Copy, Serde)]
pub struct BurnVerification {
    /// Was the proof verified successfully
    pub proof_valid: bool,
    /// Value being burned
    pub value: u256,
    /// Vault to release to
    pub vault: ContractAddress,
    /// Expected note commitment
    pub expected_note_commitment: u256,
}

/// Minimum redeem amount (0.001 ZEC in zatoshi)
pub const MIN_REDEEM_AMOUNT: u256 = 100_000;

/// Maximum redeem amount (1000 ZEC in zatoshi)
pub const MAX_REDEEM_AMOUNT: u256 = 100_000_000_000;

/// Verify burn transaction with full proof
pub fn verify_burn_proof_full(
    transfer: @BurnTransfer,
    proof: @Groth16Proof,
    user_d: u256,
    user_pkd: u256
) -> BurnVerification {
    // Build proof inputs
    let inputs = BurnProofInputs {
        cv: *transfer.cv,
        requested_note_commitment: *transfer.requested_note_commitment,
        user_d,
        user_pkd,
    };
    
    // Verify zk-SNARK proof
    let snark_valid = verify_burn_proof(proof, @inputs);
    
    let value = *transfer.cv;
    
    BurnVerification {
        proof_valid: snark_valid,
        value,
        vault: *transfer.vault_id,
        expected_note_commitment: *transfer.requested_note_commitment,
    }
}

/// Simple verification without full proof
pub fn verify_burn_params(transfer: @BurnTransfer) -> BurnVerification {
    let value = *transfer.cv;
    
    BurnVerification {
        proof_valid: true,
        value,
        vault: *transfer.vault_id,
        expected_note_commitment: *transfer.requested_note_commitment,
    }
}

/// Check if redeem amount is within limits
pub fn is_valid_redeem_amount(amount: u256) -> bool {
    amount >= MIN_REDEEM_AMOUNT && amount <= MAX_REDEEM_AMOUNT
}

/// Derive the expected note address for redeem
/// 
/// The vault should create a note addressed to the user's
/// diversified address derived from their emk
pub fn derive_user_note_address(
    user_d: u256,
    user_pkd: u256,
    value: u256,
    rcm: u256
) -> u256 {
    // Compute note commitment for user's address
    let note = SaplingNote {
        d: user_d,
        pkd: user_pkd,
        value,
        rcm,
    };
    
    compute_note_commitment(@note)
}

/// Encode burn request for off-chain use
pub fn encode_burn_request(
    burn_nonce: u256,
    transfer: @BurnTransfer
) -> Array<felt252> {
    let mut encoded: Array<felt252> = ArrayTrait::new();
    
    // Convert u256 to felt252 (lossy for large values)
    let nonce_felt: felt252 = burn_nonce.try_into().unwrap_or(0);
    let cv_felt: felt252 = (*transfer.cv).try_into().unwrap_or(0);
    let cvn_felt: felt252 = (*transfer.cvn).try_into().unwrap_or(0);
    let note_cm_felt: felt252 = (*transfer.requested_note_commitment).try_into().unwrap_or(0);
    
    encoded.append(nonce_felt);
    encoded.append(cv_felt);
    encoded.append(cvn_felt);
    encoded.append((*transfer.vault_id).into());
    encoded.append(note_cm_felt);
    
    encoded
}

/// Check if redeem timeout has expired
/// 
/// If vault doesn't release funds within timeout,
/// user can claim vault's collateral
pub fn is_timeout_expired(
    submitted_at: u64,
    current_time: u64,
    timeout: u64
) -> bool {
    current_time > submitted_at + timeout
}

/// Calculate collateral slashing amount
/// 
/// If vault fails to release funds, they lose collateral
/// proportional to the burn value plus a penalty
pub fn calculate_slash_amount(
    burn_value: u256,
    exchange_rate: u256,
    penalty_rate: u256
) -> u256 {
    const RATE_DENOMINATOR: u256 = 10000;
    
    // Convert ZEC value to collateral value
    let collateral_value = burn_value * exchange_rate / 100_000_000; // zatoshi to wei-equivalent
    
    // Add penalty
    let penalty = (collateral_value * penalty_rate) / RATE_DENOMINATOR;
    
    collateral_value + penalty
}

/// Verify vault's encryption challenge
/// 
/// If vault proves the encrypted note is malformed, redeem is rejected
pub fn verify_encryption_challenge(
    encrypted_note: @EncryptedNote,
    vault_sk: u256,
    claimed_note_commitment: u256
) -> bool {
    // Derive shared secret vault would compute
    let shared_secret = derive_shared_secret(*encrypted_note.epk, vault_sk);
    
    // Check if decryption challenge is valid
    verify_decryption_challenge(encrypted_note, shared_secret, claimed_note_commitment)
}

#[cfg(test)]
mod tests {
    use super::{is_valid_redeem_amount, is_timeout_expired, calculate_slash_amount};
    use super::{MIN_REDEEM_AMOUNT, MAX_REDEEM_AMOUNT};

    #[test]
    fn test_valid_redeem_amount() {
        assert(is_valid_redeem_amount(1_000_000_u256), 'should be valid');
        assert(!is_valid_redeem_amount(100_u256), 'too small');
        assert(!is_valid_redeem_amount(1_000_000_000_000_u256), 'too large');
    }

    #[test]
    fn test_is_timeout_expired() {
        let submitted = 1000_u64;
        let timeout = 3600_u64; // 1 hour
        
        assert(!is_timeout_expired(submitted, 2000, timeout), 'not expired');
        assert(is_timeout_expired(submitted, 5000, timeout), 'should be expired');
    }

    #[test]
    fn test_calculate_slash_amount() {
        let burn_value = 100_000_000_u256; // 1 ZEC in zatoshi
        let exchange_rate = 30_00000000_u256; // $30 per ZEC (8 decimals)
        let penalty_rate = 1000_u256; // 10%
        
        let slash = calculate_slash_amount(burn_value, exchange_rate, penalty_rate);
        assert(slash > 0, 'slash should be positive');
    }
}
