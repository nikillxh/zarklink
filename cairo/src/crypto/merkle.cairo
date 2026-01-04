// Merkle Proof Verification for Cairo
// Verifies note commitments against Sapling tree root

use zclaim::relay::types::MerkleProof;
use super::sha256::{sha256d_pair, sha256, sha256d};

/// Verify a Merkle proof from leaf to root
/// Uses SHA256d (double SHA256) like Zcash
pub fn verify_merkle_proof(
    leaf: u256,
    root: u256,
    proof: MerkleProof
) -> bool {
    let computed_root = compute_merkle_root(leaf, proof);
    computed_root == root
}

/// Compute Merkle root from leaf and proof
pub fn compute_merkle_root(leaf: u256, proof: MerkleProof) -> u256 {
    let mut current_hash = leaf;
    let mut index = proof.index;
    let siblings = proof.siblings;
    
    let mut i: u32 = 0;
    let len = siblings.len();
    
    loop {
        if i >= len {
            break;
        }
        
        let sibling = *siblings.at(i);
        
        // Check if current node is left (0) or right (1) child
        if index % 2 == 0 {
            // Current is left child: hash(current || sibling)
            current_hash = sha256d_pair(current_hash, sibling);
        } else {
            // Current is right child: hash(sibling || current)
            current_hash = sha256d_pair(sibling, current_hash);
        }
        
        index = index / 2;
        i += 1;
    };
    
    current_hash
}

/// SHA256 of arbitrary data
pub fn sha256_data(data: @Array<felt252>) -> u256 {
    sha256(data)
}

/// Double SHA256 of arbitrary data
pub fn sha256d_data(data: @Array<felt252>) -> u256 {
    sha256d(data)
}

/// Sapling note commitment tree depth (32 levels)
pub const SAPLING_TREE_DEPTH: u32 = 32;

/// Verify proof has correct depth for Sapling
pub fn verify_proof_depth(proof: @MerkleProof) -> bool {
    proof.siblings.len() == SAPLING_TREE_DEPTH
}
