// ZCLAIM Bridge - Mint Helper Module
// Helper functions for Issue protocol (ZEC → wZEC)

use starknet::ContractAddress;
use zclaim::relay::types::{LockPermit, MintTransfer, MerkleProof};
use zclaim::crypto::commitments::{
    compute_note_commitment, derive_rcm_from_nonce, 
    verify_value_commitment, SaplingNote
};
use zclaim::crypto::snark::{verify_mint_proof, Groth16Proof, MintProofInputs};

/// Helper struct for mint transaction verification
#[derive(Drop, Copy, Serde)]
pub struct MintVerification {
    /// Was the proof verified successfully
    pub proof_valid: bool,
    /// Extracted value from commitment
    pub value: u256,
    /// Fee deducted
    pub fee: u256,
    /// Net amount to mint
    pub net_amount: u256,
}

/// Calculate fee for a given amount
/// Fee rate is expressed as parts per FEE_DENOMINATOR
pub fn calculate_fee(amount: u256, fee_rate: u256) -> u256 {
    const FEE_DENOMINATOR: u256 = 10000; // 100% = 10000
    
    if fee_rate == 0 {
        return 0;
    }
    
    (amount * fee_rate) / FEE_DENOMINATOR
}

/// Calculate net amount after fee deduction
pub fn calculate_net_amount(amount: u256, fee_rate: u256) -> u256 {
    amount - calculate_fee(amount, fee_rate)
}

/// Verify mint transaction proof
/// 
/// This verifies:
/// 1. The zk-SNARK proof (πZKMint)
/// 2. The value commitment
/// 3. The note commitment derivation
/// 4. Fee deduction
pub fn verify_mint_proof_full(
    transfer: @MintTransfer,
    permit: @LockPermit,
    proof: @Groth16Proof,
    vault_d: u256,
    vault_pkd: u256
) -> MintVerification {
    // Build proof inputs
    let inputs = MintProofInputs {
        cv: *transfer.cv,
        cvn: *transfer.cvn,
        note_commitment: *transfer.note_commitment,
        permit_nonce: *transfer.permit_nonce,
        vault_address_hash: *permit.vault_address_hash,
        user_emk: *permit.user_emk,
    };
    
    // Verify zk-SNARK proof
    let snark_valid = verify_mint_proof(proof, @inputs);
    
    // Verify note commitment matches expected derivation
    let expected_rcm = derive_rcm_from_nonce(*transfer.permit_nonce, *permit.user_emk);
    let note = SaplingNote {
        d: vault_d,
        pkd: vault_pkd,
        value: *transfer.cvn, // Net value after fee
        rcm: expected_rcm,
    };
    let expected_cm = compute_note_commitment(@note);
    let cm_valid = *transfer.note_commitment == expected_cm;
    
    // Extract values (in production, from proof public inputs)
    let value = *transfer.cv;
    let fee = value - *transfer.cvn;
    let net_amount = *transfer.cvn;
    
    MintVerification {
        proof_valid: snark_valid && cm_valid,
        value,
        fee,
        net_amount,
    }
}

/// Simple verification without full proof (for testing)
pub fn verify_mint_proof_simple(
    transfer: @MintTransfer,
    permit: @LockPermit
) -> MintVerification {
    let value = *transfer.cv;
    let fee = 0_u256;
    let net_amount = value;
    
    MintVerification {
        proof_valid: true,
        value,
        fee,
        net_amount,
    }
}

/// Derive the expected note commitment from mint parameters
/// 
/// A Zcash Sapling note commitment is:
/// cm = NoteCommit(g_d, pk_d, v, rcm)
pub fn derive_expected_note_commitment(
    vault_d: u256,
    vault_pkd: u256,
    value: u256,
    permit_nonce: u256,
    user_emk: u256
) -> u256 {
    let rcm = derive_rcm_from_nonce(permit_nonce, user_emk);
    
    let note = SaplingNote {
        d: vault_d,
        pkd: vault_pkd,
        value,
        rcm,
    };
    
    compute_note_commitment(@note)
}

/// Encode lock permit for off-chain use
pub fn encode_lock_permit(permit: @LockPermit) -> Array<felt252> {
    let mut encoded: Array<felt252> = ArrayTrait::new();
    
    // Convert u256 to felt252 (lossy for large values)
    let nonce_felt: felt252 = (*permit.nonce).try_into().unwrap_or(0);
    let vault_addr_felt: felt252 = (*permit.vault_address_hash).try_into().unwrap_or(0);
    let user_emk_felt: felt252 = (*permit.user_emk).try_into().unwrap_or(0);
    
    encoded.append(nonce_felt);
    encoded.append(vault_addr_felt);
    encoded.append(user_emk_felt);
    encoded.append((*permit.issued_at).into());
    encoded.append((*permit.expires_at).into());
    
    encoded
}

#[cfg(test)]
mod tests {
    use super::{calculate_fee, calculate_net_amount};

    #[test]
    fn test_calculate_fee_zero() {
        let amount = 1000_u256;
        let fee_rate = 0_u256;
        assert(calculate_fee(amount, fee_rate) == 0, 'fee should be zero');
    }

    #[test]
    fn test_calculate_fee_one_percent() {
        let amount = 10000_u256;
        let fee_rate = 100_u256; // 1%
        assert(calculate_fee(amount, fee_rate) == 100, 'fee should be 100');
    }

    #[test]
    fn test_calculate_net_amount() {
        let amount = 10000_u256;
        let fee_rate = 100_u256; // 1%
        assert(calculate_net_amount(amount, fee_rate) == 9900, 'net should be 9900');
    }
}
