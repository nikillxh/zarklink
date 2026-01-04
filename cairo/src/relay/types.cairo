// Relay System Types
// Data structures for Zcash block header relay

use starknet::ContractAddress;

/// Zcash block header structure
/// Total size: ~1487 bytes for Sapling
#[derive(Drop, Serde, starknet::Store)]
pub struct BlockHeader {
    /// BLAKE2b-256 hash of the header
    pub block_hash: u256,
    /// Hash of previous block
    pub prev_block_hash: u256,
    /// Transaction Merkle root
    pub merkle_root: u256,
    /// hashFinalSaplingRoot - Sapling note commitment tree root
    /// THIS IS THE KEY FIELD FOR ZCLAIM
    pub sapling_root: u256,
    /// Block timestamp (Unix time)
    pub timestamp: u64,
    /// Difficulty target in compact form
    pub bits: u32,
    /// Block height
    pub height: u64,
    /// Cumulative chain work
    pub chain_work: u256,
    /// Whether PoW has been verified
    pub verified: bool,
}

/// Merkle proof for note commitment verification
#[derive(Drop, Serde)]
pub struct MerkleProof {
    /// Sibling hashes along the path (bottom to top)
    pub siblings: Array<u256>,
    /// Position of leaf in tree (encodes left/right path)
    /// Bit i indicates if node at level i is right child (1) or left child (0)
    pub index: u64,
}

/// Lock permit issued when user requests to lock ZEC
#[derive(Drop, Copy, Serde, starknet::Store)]
pub struct LockPermit {
    /// Unique permit identifier
    pub nonce: u256,
    /// Vault's Zcash shielded address (d, pkd) - stored as hash
    pub vault_address_hash: u256,
    /// User's ephemeral minting public key
    pub user_emk: u256,
    /// Timestamp when permit was issued
    pub issued_at: u64,
    /// Timestamp when permit expires
    pub expires_at: u64,
    /// Whether permit has been used
    pub used: bool,
}

/// Mint transfer data (for Issue protocol)
#[derive(Drop, Serde)]
pub struct MintTransfer {
    /// Value commitment to wZEC being minted
    pub cv: u256,
    /// Value commitment to ZEC locked
    pub cvn: u256,
    /// Lock permit nonce
    pub permit_nonce: u256,
    /// Note commitment of the locked note
    pub note_commitment: u256,
    /// Block hash containing the note
    pub block_hash: u256,
    /// Merkle proof from note to Sapling root
    pub merkle_proof: MerkleProof,
    /// Encrypted note plaintext (for vault to decrypt)
    pub encrypted_note: Array<felt252>,
}

/// Burn transfer data (for Redeem protocol)
#[derive(Drop, Serde)]
pub struct BurnTransfer {
    /// Value commitment to wZEC being burned
    pub cv: u256,
    /// Value commitment to ZEC to be released
    pub cvn: u256,
    /// Vault identifier
    pub vault_id: ContractAddress,
    /// Requested note commitment (what redeemer wants to receive)
    pub requested_note_commitment: u256,
    /// Encrypted note details (for vault to create the note)
    pub encrypted_note: Array<felt252>,
}

/// Issue request status
#[derive(Drop, Copy, Serde, starknet::Store, PartialEq, Default)]
pub enum IssueStatus {
    /// No request exists
    #[default]
    None,
    /// Waiting for user to submit mint transaction
    AwaitingMint,
    /// Mint submitted, waiting for vault confirmation
    AwaitingConfirmation,
    /// Vault confirmed, issue complete
    Confirmed,
    /// Vault challenged, issue failed
    Challenged,
    /// Timed out (user didn't mint in time)
    Expired,
}

/// Redeem request status
#[derive(Drop, Copy, Serde, starknet::Store, PartialEq, Default)]
pub enum RedeemStatus {
    /// No request exists
    #[default]
    None,
    /// Burn submitted, waiting for vault to release ZEC
    AwaitingRelease,
    /// Vault confirmed release
    Confirmed,
    /// Vault challenged bad encryption
    Challenged,
    /// Timed out (vault didn't release)
    Expired,
}

/// Constants for the relay system
pub mod constants {
    /// Minimum confirmations for a block to be considered final
    pub const MIN_CONFIRMATIONS: u64 = 6;
    
    /// Maximum time (seconds) for user to submit mint after lock permit
    pub const MINT_TIMEOUT: u64 = 3600; // 1 hour
    
    /// Maximum time (seconds) for vault to confirm/challenge issue
    pub const CONFIRM_ISSUE_TIMEOUT: u64 = 7200; // 2 hours
    
    /// Maximum time (seconds) for vault to confirm redeem
    pub const CONFIRM_REDEEM_TIMEOUT: u64 = 7200; // 2 hours
    
    /// Offset of hashFinalSaplingRoot in block header (bytes)
    pub const SAPLING_ROOT_OFFSET: u32 = 68; // 4 + 32 + 32
    
    /// ZEC has 8 decimal places (1 ZEC = 10^8 zatoshi)
    pub const ZEC_DECIMALS: u8 = 8;
    
    /// Fee rate denominator (e.g., 256 for fee = 1/256 = ~0.39%)
    pub const FEE_DENOMINATOR: u256 = 256;
}
