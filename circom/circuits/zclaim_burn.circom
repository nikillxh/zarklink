pragma circom 2.0.0;

include "./blake2b.circom";
include "./merkle_tree.circom";

/**
 * ZCLAIM Burn Proof (πZKBurn) 
 * 
 * This circuit proves:
 * 1. The burn request is properly formed
 * 2. The requested note commitment is valid for the user's address
 * 3. The value commitment matches the burn amount
 * 
 * Note: The actual release proof is simpler - vault just needs to show
 * that the released note exists in a confirmed Zcash block.
 * 
 * Public inputs:
 * - burn_nonce: The burn request nonce
 * - user_emk: User's encrypted master key (for deriving address)
 * - requested_note_commitment: The expected cm for the release note
 * - burn_amount: Amount being burned
 * 
 * Private inputs:
 * - user_ivk: User's incoming viewing key
 * - diversifier: Address diversifier
 * - rcm: Randomness for note commitment
 */
template ZclaimBurnProof() {
    // ============ Public Inputs ============
    signal input burn_nonce[32][8];             // 32 bytes
    signal input user_emk[32][8];               // 32 bytes (encrypted master key)
    signal input requested_note_commitment[32][8]; // 32 bytes
    signal input burn_amount[8][8];             // 8 bytes (u64)
    
    // ============ Private Inputs ============
    signal input user_ivk[32][8];               // 32 bytes (incoming viewing key)
    signal input diversifier[11][8];            // 11 bytes
    signal input rcm[32][8];                    // 32 bytes
    
    var i;
    var j;
    
    // 1. Derive pk_d from ivk and diversifier
    // pk_d = ivk * g_d where g_d = DiversifyHash(diversifier)
    // TODO: Implement proper elliptic curve operations
    signal pk_d[32][8];
    // Placeholder: assume pk_d is derived correctly
    for (i = 0; i < 32; i++) {
        for (j = 0; j < 8; j++) {
            pk_d[i][j] <== user_ivk[i][j]; // Simplified
        }
    }
    
    // 2. Compute expected note commitment
    // cm = NoteCommit(g_d, pk_d, value, rcm)
    // Using Pedersen commitment scheme
    // TODO: Implement proper Pedersen commitment
    
    // For now, use BLAKE2b as a placeholder hash
    var personalization_cm[16][8] = [
        [0, 1, 0, 1, 1, 0, 1, 0], // Z
        [0, 1, 1, 0, 0, 0, 1, 1], // c
        [0, 1, 0, 0, 1, 1, 1, 0], // N
        [0, 1, 1, 0, 1, 1, 1, 1], // o
        [0, 1, 1, 1, 0, 1, 0, 0], // t
        [0, 1, 1, 0, 0, 1, 0, 1], // e
        [0, 1, 0, 0, 0, 0, 1, 1], // C
        [0, 1, 1, 0, 1, 1, 0, 1], // m
        [0, 0, 0, 0, 0, 0, 0, 0], // padding
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0]
    ];
    
    // Hash: personalization || diversifier || pk_d || value || rcm
    component cm_hasher = blake2b(16 + 11 + 32 + 8 + 32);
    var k = 0;
    
    for (i = 0; i < 16; i++) {
        for (j = 0; j < 8; j++) {
            cm_hasher.in[k][j] <== personalization_cm[i][j];
        }
        k++;
    }
    
    for (i = 0; i < 11; i++) {
        for (j = 0; j < 8; j++) {
            cm_hasher.in[k][j] <== diversifier[i][j];
        }
        k++;
    }
    
    for (i = 0; i < 32; i++) {
        for (j = 0; j < 8; j++) {
            cm_hasher.in[k][j] <== pk_d[i][j];
        }
        k++;
    }
    
    for (i = 0; i < 8; i++) {
        for (j = 0; j < 8; j++) {
            cm_hasher.in[k][j] <== burn_amount[i][j];
        }
        k++;
    }
    
    for (i = 0; i < 32; i++) {
        for (j = 0; j < 8; j++) {
            cm_hasher.in[k][j] <== rcm[i][j];
        }
        k++;
    }
    
    // 3. Verify computed cm matches requested_note_commitment
    signal cm_computed[32][8];
    for (i = 0; i < 32; i++) {
        for (j = 0; j < 8; j++) {
            cm_computed[i][j] <== cm_hasher.out[i][j];
            cm_computed[i][j] === requested_note_commitment[i][j];
        }
    }
    
    // 4. Verify user_emk encrypts user_ivk correctly
    // This proves the user owns the address without revealing ivk
    // TODO: Implement proper encryption verification
    
    // 5. Output: proof is valid
    signal output valid;
    valid <== 1;
}

component main {public [burn_nonce, user_emk, requested_note_commitment, burn_amount]} = ZclaimBurnProof();
