// BLAKE2b-256 Hash Implementation for Cairo
// Used for Zcash block hashing and personalized hashes
// Full implementation with 12 rounds of mixing

use core::num::traits::WrappingAdd;

/// BLAKE2b state - 8 x 64-bit words
#[derive(Drop, Clone)]
struct Blake2bState {
    h: Array<u64>,      // State vector (8 words)
    t: Array<u64>,      // Counter (2 words) 
    f: Array<u64>,      // Finalization flags (2 words)
}

/// BLAKE2b IV (Initialization Vector) constants
/// First 64 bits of fractional parts of square roots of first 8 primes
pub mod IV {
    pub const IV0: u64 = 0x6a09e667f3bcc908;
    pub const IV1: u64 = 0xbb67ae8584caa73b;
    pub const IV2: u64 = 0x3c6ef372fe94f82b;
    pub const IV3: u64 = 0xa54ff53a5f1d36f1;
    pub const IV4: u64 = 0x510e527fade682d1;
    pub const IV5: u64 = 0x9b05688c2b3e6c1f;
    pub const IV6: u64 = 0x1f83d9abfb41bd6b;
    pub const IV7: u64 = 0x5be0cd19137e2179;
}

/// Get IV value by index
fn get_iv(index: u32) -> u64 {
    if index == 0 { IV::IV0 }
    else if index == 1 { IV::IV1 }
    else if index == 2 { IV::IV2 }
    else if index == 3 { IV::IV3 }
    else if index == 4 { IV::IV4 }
    else if index == 5 { IV::IV5 }
    else if index == 6 { IV::IV6 }
    else if index == 7 { IV::IV7 }
    else { 0 }
}

/// BLAKE2b sigma permutation table - full 12 rounds
pub mod SIGMA {
    pub fn get(round: u32, index: u32) -> u32 {
        let flat_index = (round % 10) * 16 + index;
        
        // Round 0: 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15
        if flat_index == 0 { return 0; } if flat_index == 1 { return 1; }
        if flat_index == 2 { return 2; } if flat_index == 3 { return 3; }
        if flat_index == 4 { return 4; } if flat_index == 5 { return 5; }
        if flat_index == 6 { return 6; } if flat_index == 7 { return 7; }
        if flat_index == 8 { return 8; } if flat_index == 9 { return 9; }
        if flat_index == 10 { return 10; } if flat_index == 11 { return 11; }
        if flat_index == 12 { return 12; } if flat_index == 13 { return 13; }
        if flat_index == 14 { return 14; } if flat_index == 15 { return 15; }
        // Round 1: 14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3
        if flat_index == 16 { return 14; } if flat_index == 17 { return 10; }
        if flat_index == 18 { return 4; } if flat_index == 19 { return 8; }
        if flat_index == 20 { return 9; } if flat_index == 21 { return 15; }
        if flat_index == 22 { return 13; } if flat_index == 23 { return 6; }
        if flat_index == 24 { return 1; } if flat_index == 25 { return 12; }
        if flat_index == 26 { return 0; } if flat_index == 27 { return 2; }
        if flat_index == 28 { return 11; } if flat_index == 29 { return 7; }
        if flat_index == 30 { return 5; } if flat_index == 31 { return 3; }
        // Round 2: 11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4
        if flat_index == 32 { return 11; } if flat_index == 33 { return 8; }
        if flat_index == 34 { return 12; } if flat_index == 35 { return 0; }
        if flat_index == 36 { return 5; } if flat_index == 37 { return 2; }
        if flat_index == 38 { return 15; } if flat_index == 39 { return 13; }
        if flat_index == 40 { return 10; } if flat_index == 41 { return 14; }
        if flat_index == 42 { return 3; } if flat_index == 43 { return 6; }
        if flat_index == 44 { return 7; } if flat_index == 45 { return 1; }
        if flat_index == 46 { return 9; } if flat_index == 47 { return 4; }
        // Round 3: 7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8
        if flat_index == 48 { return 7; } if flat_index == 49 { return 9; }
        if flat_index == 50 { return 3; } if flat_index == 51 { return 1; }
        if flat_index == 52 { return 13; } if flat_index == 53 { return 12; }
        if flat_index == 54 { return 11; } if flat_index == 55 { return 14; }
        if flat_index == 56 { return 2; } if flat_index == 57 { return 6; }
        if flat_index == 58 { return 5; } if flat_index == 59 { return 10; }
        if flat_index == 60 { return 4; } if flat_index == 61 { return 0; }
        if flat_index == 62 { return 15; } if flat_index == 63 { return 8; }
        // Round 4: 9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13
        if flat_index == 64 { return 9; } if flat_index == 65 { return 0; }
        if flat_index == 66 { return 5; } if flat_index == 67 { return 7; }
        if flat_index == 68 { return 2; } if flat_index == 69 { return 4; }
        if flat_index == 70 { return 10; } if flat_index == 71 { return 15; }
        if flat_index == 72 { return 14; } if flat_index == 73 { return 1; }
        if flat_index == 74 { return 11; } if flat_index == 75 { return 12; }
        if flat_index == 76 { return 6; } if flat_index == 77 { return 8; }
        if flat_index == 78 { return 3; } if flat_index == 79 { return 13; }
        // Round 5: 2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9
        if flat_index == 80 { return 2; } if flat_index == 81 { return 12; }
        if flat_index == 82 { return 6; } if flat_index == 83 { return 10; }
        if flat_index == 84 { return 0; } if flat_index == 85 { return 11; }
        if flat_index == 86 { return 8; } if flat_index == 87 { return 3; }
        if flat_index == 88 { return 4; } if flat_index == 89 { return 13; }
        if flat_index == 90 { return 7; } if flat_index == 91 { return 5; }
        if flat_index == 92 { return 15; } if flat_index == 93 { return 14; }
        if flat_index == 94 { return 1; } if flat_index == 95 { return 9; }
        // Round 6: 12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11
        if flat_index == 96 { return 12; } if flat_index == 97 { return 5; }
        if flat_index == 98 { return 1; } if flat_index == 99 { return 15; }
        if flat_index == 100 { return 14; } if flat_index == 101 { return 13; }
        if flat_index == 102 { return 4; } if flat_index == 103 { return 10; }
        if flat_index == 104 { return 0; } if flat_index == 105 { return 7; }
        if flat_index == 106 { return 6; } if flat_index == 107 { return 3; }
        if flat_index == 108 { return 9; } if flat_index == 109 { return 2; }
        if flat_index == 110 { return 8; } if flat_index == 111 { return 11; }
        // Round 7: 13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10
        if flat_index == 112 { return 13; } if flat_index == 113 { return 11; }
        if flat_index == 114 { return 7; } if flat_index == 115 { return 14; }
        if flat_index == 116 { return 12; } if flat_index == 117 { return 1; }
        if flat_index == 118 { return 3; } if flat_index == 119 { return 9; }
        if flat_index == 120 { return 5; } if flat_index == 121 { return 0; }
        if flat_index == 122 { return 15; } if flat_index == 123 { return 4; }
        if flat_index == 124 { return 8; } if flat_index == 125 { return 6; }
        if flat_index == 126 { return 2; } if flat_index == 127 { return 10; }
        // Round 8: 6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5
        if flat_index == 128 { return 6; } if flat_index == 129 { return 15; }
        if flat_index == 130 { return 14; } if flat_index == 131 { return 9; }
        if flat_index == 132 { return 11; } if flat_index == 133 { return 3; }
        if flat_index == 134 { return 0; } if flat_index == 135 { return 8; }
        if flat_index == 136 { return 12; } if flat_index == 137 { return 2; }
        if flat_index == 138 { return 13; } if flat_index == 139 { return 7; }
        if flat_index == 140 { return 1; } if flat_index == 141 { return 4; }
        if flat_index == 142 { return 10; } if flat_index == 143 { return 5; }
        // Round 9: 10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0
        if flat_index == 144 { return 10; } if flat_index == 145 { return 2; }
        if flat_index == 146 { return 8; } if flat_index == 147 { return 4; }
        if flat_index == 148 { return 7; } if flat_index == 149 { return 6; }
        if flat_index == 150 { return 1; } if flat_index == 151 { return 5; }
        if flat_index == 152 { return 15; } if flat_index == 153 { return 11; }
        if flat_index == 154 { return 9; } if flat_index == 155 { return 14; }
        if flat_index == 156 { return 3; } if flat_index == 157 { return 12; }
        if flat_index == 158 { return 13; } if flat_index == 159 { return 0; }
        
        // Fallback
        index % 16
    }
}

/// Rotate right for u64
fn rotr64(x: u64, n: u32) -> u64 {
    let n64: u64 = n.into();
    (x / pow2_64(n)) | (x * pow2_64(64 - n))
}

/// Power of 2 for u64 shifts
fn pow2_64(n: u32) -> u64 {
    if n == 0 { 1_u64 }
    else if n == 1 { 2_u64 }
    else if n == 2 { 4_u64 }
    else if n == 3 { 8_u64 }
    else if n == 4 { 16_u64 }
    else if n == 5 { 32_u64 }
    else if n == 6 { 64_u64 }
    else if n == 7 { 128_u64 }
    else if n == 8 { 256_u64 }
    else if n == 16 { 65536_u64 }
    else if n == 24 { 16777216_u64 }
    else if n == 32 { 4294967296_u64 }
    else if n == 48 { 281474976710656_u64 }
    else if n == 56 { 72057594037927936_u64 }
    else if n == 63 { 9223372036854775808_u64 }
    else if n == 64 { 1_u64 } // Wrap around
    else {
        // General case
        let mut result: u64 = 1;
        let mut i: u32 = 0;
        loop {
            if i >= n {
                break;
            }
            result = result * 2;
            i += 1;
        };
        result
    }
}

/// BLAKE2b G mixing function
/// Mixes values in the working vector v
fn g(v: @Array<u64>, a: u32, b: u32, c: u32, d: u32, x: u64, y: u64) -> Array<u64> {
    let mut result: Array<u64> = array![];
    
    // Get current values
    let va = *v.at(a);
    let vb = *v.at(b);
    let vc = *v.at(c);
    let vd = *v.at(d);
    
    // G function operations:
    // v[a] = v[a] + v[b] + x
    let va_new = va.wrapping_add(vb).wrapping_add(x);
    // v[d] = rotr(v[d] ^ v[a], 32)
    let vd_new = rotr64(vd ^ va_new, 32);
    // v[c] = v[c] + v[d]
    let vc_new = vc.wrapping_add(vd_new);
    // v[b] = rotr(v[b] ^ v[c], 24)
    let vb_new = rotr64(vb ^ vc_new, 24);
    // v[a] = v[a] + v[b] + y
    let va_final = va_new.wrapping_add(vb_new).wrapping_add(y);
    // v[d] = rotr(v[d] ^ v[a], 16)
    let vd_final = rotr64(vd_new ^ va_final, 16);
    // v[c] = v[c] + v[d]
    let vc_final = vc_new.wrapping_add(vd_final);
    // v[b] = rotr(v[b] ^ v[c], 63)
    let vb_final = rotr64(vb_new ^ vc_final, 63);
    
    // Build result array with updated values
    let mut i: u32 = 0;
    loop {
        if i >= 16 {
            break;
        }
        if i == a { result.append(va_final); }
        else if i == b { result.append(vb_final); }
        else if i == c { result.append(vc_final); }
        else if i == d { result.append(vd_final); }
        else { result.append(*v.at(i)); }
        i += 1;
    };
    
    result
}

/// Get message word by index
fn get_m(m: @Array<u64>, index: u32) -> u64 {
    if index < m.len() { *m.at(index) } else { 0 }
}

/// BLAKE2b compression function F
fn compress(h: @Array<u64>, m: @Array<u64>, t0: u64, t1: u64, f: bool) -> Array<u64> {
    // Initialize working vector v (16 words)
    let mut v: Array<u64> = array![
        *h.at(0), *h.at(1), *h.at(2), *h.at(3),
        *h.at(4), *h.at(5), *h.at(6), *h.at(7),
        IV::IV0, IV::IV1, IV::IV2, IV::IV3,
        IV::IV4 ^ t0, IV::IV5 ^ t1, 
        if f { IV::IV6 ^ 0xffffffffffffffff } else { IV::IV6 }, 
        IV::IV7
    ];
    
    // 12 rounds of mixing
    let mut round: u32 = 0;
    loop {
        if round >= 12 {
            break;
        }
        
        // Column step
        v = g(@v, 0, 4, 8, 12, get_m(m, SIGMA::get(round, 0)), get_m(m, SIGMA::get(round, 1)));
        v = g(@v, 1, 5, 9, 13, get_m(m, SIGMA::get(round, 2)), get_m(m, SIGMA::get(round, 3)));
        v = g(@v, 2, 6, 10, 14, get_m(m, SIGMA::get(round, 4)), get_m(m, SIGMA::get(round, 5)));
        v = g(@v, 3, 7, 11, 15, get_m(m, SIGMA::get(round, 6)), get_m(m, SIGMA::get(round, 7)));
        
        // Diagonal step
        v = g(@v, 0, 5, 10, 15, get_m(m, SIGMA::get(round, 8)), get_m(m, SIGMA::get(round, 9)));
        v = g(@v, 1, 6, 11, 12, get_m(m, SIGMA::get(round, 10)), get_m(m, SIGMA::get(round, 11)));
        v = g(@v, 2, 7, 8, 13, get_m(m, SIGMA::get(round, 12)), get_m(m, SIGMA::get(round, 13)));
        v = g(@v, 3, 4, 9, 14, get_m(m, SIGMA::get(round, 14)), get_m(m, SIGMA::get(round, 15)));
        
        round += 1;
    };
    
    // Finalize: h' = h XOR v[0..7] XOR v[8..15]
    let mut result: Array<u64> = array![];
    let mut i: u32 = 0;
    loop {
        if i >= 8 {
            break;
        }
        result.append(*h.at(i) ^ *v.at(i) ^ *v.at(i + 8));
        i += 1;
    };
    
    result
}

/// Convert Array<felt252> to Array<u64> message blocks
fn felt_array_to_u64_blocks(data: @Array<felt252>) -> Array<u64> {
    let mut result: Array<u64> = array![];
    let len = data.len();
    let mut i: u32 = 0;
    
    loop {
        if i >= len {
            break;
        }
        // Convert felt252 to u64 (taking lower 64 bits)
        let val: felt252 = *data.at(i);
        let val_u256: u256 = val.into();
        let val_u64: u64 = (val_u256.low % 0x10000000000000000).try_into().unwrap();
        result.append(val_u64);
        i += 1;
    };
    
    // Pad to 16 words if needed
    loop {
        if result.len() >= 16 {
            break;
        }
        result.append(0);
    };
    
    result
}

/// Compute BLAKE2b-256 hash of input data
/// Full implementation with 12 rounds
pub fn blake2b_256(data: @Array<felt252>) -> u256 {
    // Initialize state with IV XOR parameter block
    // For BLAKE2b-256: digest length = 32 bytes (0x20), fanout = 1, depth = 1
    let param_block: u64 = 0x01010020; // 256-bit output
    
    let mut h: Array<u64> = array![
        IV::IV0 ^ param_block,
        IV::IV1,
        IV::IV2,
        IV::IV3,
        IV::IV4,
        IV::IV5,
        IV::IV6,
        IV::IV7
    ];
    
    // Convert input to message blocks
    let m = felt_array_to_u64_blocks(data);
    
    // Compute number of bytes (approximate - each felt252 treated as 8 bytes for simplicity)
    let byte_len: u64 = (data.len() * 8).into();
    
    // Single block compression (for messages <= 128 bytes)
    h = compress(@h, @m, byte_len, 0, true);
    
    // Convert h[0..3] to u256 (first 256 bits)
    let h0: u128 = (*h.at(0)).into();
    let h1: u128 = (*h.at(1)).into();
    let h2: u128 = (*h.at(2)).into();
    let h3: u128 = (*h.at(3)).into();
    
    let low: u128 = h0 | (h1 * 0x10000000000000000);
    let high: u128 = h2 | (h3 * 0x10000000000000000);
    
    u256 { low, high }
}

/// BLAKE2b with personalization string (16 bytes)
/// Used for Zcash-specific hashing (e.g., "ZcashBlockHash")
pub fn blake2b_256_personalized(data: @Array<felt252>, personalization: @Array<u8>) -> u256 {
    // Initialize state with IV XOR parameter block including personalization
    // Parameter block for BLAKE2b-256 with personalization:
    // Bytes 0-3: digest length (32), key length (0), fanout (1), depth (1)
    // Bytes 32-47: personalization
    
    let param_block: u64 = 0x01010020; // Base params
    
    // Extract personalization as u64 values (first 16 bytes -> 2 x u64)
    let mut p0: u64 = 0;
    let mut p1: u64 = 0;
    let p_len = personalization.len();
    
    let mut i: u32 = 0;
    loop {
        if i >= 8 {
            break;
        }
        if i < p_len {
            let byte: u64 = (*personalization.at(i)).into();
            p0 = p0 | (byte * pow2_64(i * 8));
        }
        i += 1;
    };
    
    i = 0;
    loop {
        if i >= 8 {
            break;
        }
        if i + 8 < p_len {
            let byte: u64 = (*personalization.at(i + 8)).into();
            p1 = p1 | (byte * pow2_64(i * 8));
        }
        i += 1;
    };
    
    // h[6] and h[7] are XORed with personalization
    let mut h: Array<u64> = array![
        IV::IV0 ^ param_block,
        IV::IV1,
        IV::IV2,
        IV::IV3,
        IV::IV4,
        IV::IV5,
        IV::IV6 ^ p0,
        IV::IV7 ^ p1
    ];
    
    let m = felt_array_to_u64_blocks(data);
    let byte_len: u64 = (data.len() * 8).into();
    
    h = compress(@h, @m, byte_len, 0, true);
    
    let h0: u128 = (*h.at(0)).into();
    let h1: u128 = (*h.at(1)).into();
    let h2: u128 = (*h.at(2)).into();
    let h3: u128 = (*h.at(3)).into();
    
    let low: u128 = h0 | (h1 * 0x10000000000000000);
    let high: u128 = h2 | (h3 * 0x10000000000000000);
    
    u256 { low, high }
}
