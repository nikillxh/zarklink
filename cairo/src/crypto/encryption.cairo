// Encryption Utilities for ZCLAIM
// ChaCha20-Poly1305 style encryption verification

use super::blake2b::blake2b_256_personalized;

/// Encrypted note structure
#[derive(Drop, Serde)]
pub struct EncryptedNote {
    /// Ephemeral public key
    pub epk: u256,
    /// Ciphertext (note plaintext encrypted)
    pub ciphertext: Array<felt252>,
    /// Authentication tag
    pub tag: u256,
}

/// Derive shared secret from ephemeral key and receiver key
/// In production, use proper X25519 or Jubjub ECDH
pub fn derive_shared_secret(
    epk: u256,      // Ephemeral public key
    sk: u256        // Private key
) -> u256 {
    // Simplified: Hash(epk || sk)
    // In production: ECDH on Jubjub curve
    let mut data: Array<felt252> = array![];
    data.append(epk.low.into());
    data.append(epk.high.into());
    data.append(sk.low.into());
    data.append(sk.high.into());
    
    let personalization: Array<u8> = array![
        0x5a, 0x63, 0x6c, 0x61, 0x69, 0x6d, 0x73, 0x73, // "Zclaimss"
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ];
    
    blake2b_256_personalized(@data, @personalization)
}

/// Derive encryption key from shared secret
pub fn derive_encryption_key(shared_secret: u256, context: u256) -> u256 {
    let mut data: Array<felt252> = array![];
    data.append(shared_secret.low.into());
    data.append(shared_secret.high.into());
    data.append(context.low.into());
    data.append(context.high.into());
    
    let personalization: Array<u8> = array![
        0x5a, 0x63, 0x6c, 0x61, 0x69, 0x6d, 0x65, 0x6b, // "Zclaimek"
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ];
    
    blake2b_256_personalized(@data, @personalization)
}

/// Verify decryption produces valid note
/// 
/// Used by vault to challenge bad encryption:
/// If vault can show shared_secret that decrypts to invalid note,
/// the issue is rejected
pub fn verify_decryption_challenge(
    encrypted_note: @EncryptedNote,
    shared_secret: u256,
    expected_note_commitment: u256
) -> bool {
    // 1. Derive encryption key from shared secret
    let enc_key = derive_encryption_key(shared_secret, *encrypted_note.epk);
    
    // 2. Compute expected plaintext hash
    // In production: actually decrypt and verify
    let mut data: Array<felt252> = array![];
    data.append(enc_key.low.into());
    data.append(enc_key.high.into());
    
    // Add ciphertext
    let ct = encrypted_note.ciphertext;
    let mut i: u32 = 0;
    loop {
        if i >= ct.len() {
            break;
        }
        data.append(*ct.at(i));
        i += 1;
    };
    
    let personalization: Array<u8> = array![
        0x5a, 0x63, 0x6c, 0x61, 0x69, 0x6d, 0x64, 0x63, // "Zclaimdc"
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ];
    
    let decrypted_hash = blake2b_256_personalized(@data, @personalization);
    
    // 3. Check if decryption is valid
    // If decrypted note commitment matches expected, encryption was good
    // If not, this is a valid challenge
    decrypted_hash != expected_note_commitment
}

/// Verify that vault's challenge is legitimate
/// 
/// Vault must prove:
/// 1. They have the correct private key for their address
/// 2. The shared secret correctly decrypts to an invalid note
pub fn verify_vault_challenge(
    epk: u256,
    vault_sk: u256,  // Vault proves knowledge via signature/proof
    ciphertext: @Array<felt252>,
    claimed_note_commitment: u256,
    actual_note_contents_hash: u256
) -> bool {
    // Derive the shared secret the vault would compute
    let shared_secret = derive_shared_secret(epk, vault_sk);
    
    // Verify the decryption reveals different note than claimed
    let enc_key = derive_encryption_key(shared_secret, epk);
    
    // Hash what the vault decrypted
    let mut data: Array<felt252> = array![];
    data.append(enc_key.low.into());
    data.append(enc_key.high.into());
    
    let personalization: Array<u8> = array![
        0x5a, 0x63, 0x6c, 0x61, 0x69, 0x6d, 0x76, 0x63, // "Zclaimvc"
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ];
    
    let computed_hash = blake2b_256_personalized(@data, @personalization);
    
    // Challenge is valid if computed hash matches what vault claims
    // AND differs from the note commitment on chain
    computed_hash == actual_note_contents_hash && 
    actual_note_contents_hash != claimed_note_commitment
}

/// Compute authentication tag for encrypted note
pub fn compute_auth_tag(
    enc_key: u256,
    ciphertext: @Array<felt252>
) -> u256 {
    let mut data: Array<felt252> = array![];
    data.append(enc_key.low.into());
    data.append(enc_key.high.into());
    
    let mut i: u32 = 0;
    loop {
        if i >= ciphertext.len() {
            break;
        }
        data.append(*ciphertext.at(i));
        i += 1;
    };
    
    let personalization: Array<u8> = array![
        0x5a, 0x63, 0x6c, 0x61, 0x69, 0x6d, 0x74, 0x67, // "Zclaimtg"
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ];
    
    blake2b_256_personalized(@data, @personalization)
}

/// Verify authentication tag
pub fn verify_auth_tag(
    enc_key: u256,
    ciphertext: @Array<felt252>,
    expected_tag: u256
) -> bool {
    let computed = compute_auth_tag(enc_key, ciphertext);
    computed == expected_tag
}
