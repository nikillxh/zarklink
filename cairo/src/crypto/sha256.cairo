// SHA256 Hash Implementation for Cairo
// Used for Zcash Merkle tree verification (SHA256d = double SHA256)

use core::num::traits::WrappingAdd;

/// SHA256 K constants (first 32 bits of fractional parts of cube roots of first 64 primes)
pub mod K {
    pub fn get(i: u32) -> u32 {
        if i == 0 { 0x428a2f98 } else if i == 1 { 0x71374491 }
        else if i == 2 { 0xb5c0fbcf } else if i == 3 { 0xe9b5dba5 }
        else if i == 4 { 0x3956c25b } else if i == 5 { 0x59f111f1 }
        else if i == 6 { 0x923f82a4 } else if i == 7 { 0xab1c5ed5 }
        else if i == 8 { 0xd807aa98 } else if i == 9 { 0x12835b01 }
        else if i == 10 { 0x243185be } else if i == 11 { 0x550c7dc3 }
        else if i == 12 { 0x72be5d74 } else if i == 13 { 0x80deb1fe }
        else if i == 14 { 0x9bdc06a7 } else if i == 15 { 0xc19bf174 }
        else if i == 16 { 0xe49b69c1 } else if i == 17 { 0xefbe4786 }
        else if i == 18 { 0x0fc19dc6 } else if i == 19 { 0x240ca1cc }
        else if i == 20 { 0x2de92c6f } else if i == 21 { 0x4a7484aa }
        else if i == 22 { 0x5cb0a9dc } else if i == 23 { 0x76f988da }
        else if i == 24 { 0x983e5152 } else if i == 25 { 0xa831c66d }
        else if i == 26 { 0xb00327c8 } else if i == 27 { 0xbf597fc7 }
        else if i == 28 { 0xc6e00bf3 } else if i == 29 { 0xd5a79147 }
        else if i == 30 { 0x06ca6351 } else if i == 31 { 0x14292967 }
        else if i == 32 { 0x27b70a85 } else if i == 33 { 0x2e1b2138 }
        else if i == 34 { 0x4d2c6dfc } else if i == 35 { 0x53380d13 }
        else if i == 36 { 0x650a7354 } else if i == 37 { 0x766a0abb }
        else if i == 38 { 0x81c2c92e } else if i == 39 { 0x92722c85 }
        else if i == 40 { 0xa2bfe8a1 } else if i == 41 { 0xa81a664b }
        else if i == 42 { 0xc24b8b70 } else if i == 43 { 0xc76c51a3 }
        else if i == 44 { 0xd192e819 } else if i == 45 { 0xd6990624 }
        else if i == 46 { 0xf40e3585 } else if i == 47 { 0x106aa070 }
        else if i == 48 { 0x19a4c116 } else if i == 49 { 0x1e376c08 }
        else if i == 50 { 0x2748774c } else if i == 51 { 0x34b0bcb5 }
        else if i == 52 { 0x391c0cb3 } else if i == 53 { 0x4ed8aa4a }
        else if i == 54 { 0x5b9cca4f } else if i == 55 { 0x682e6ff3 }
        else if i == 56 { 0x748f82ee } else if i == 57 { 0x78a5636f }
        else if i == 58 { 0x84c87814 } else if i == 59 { 0x8cc70208 }
        else if i == 60 { 0x90befffa } else if i == 61 { 0xa4506ceb }
        else if i == 62 { 0xbef9a3f7 } else if i == 63 { 0xc67178f2 }
        else { 0 }
    }
}

/// SHA256 initial hash values (H)
pub mod H {
    pub const H0: u32 = 0x6a09e667;
    pub const H1: u32 = 0xbb67ae85;
    pub const H2: u32 = 0x3c6ef372;
    pub const H3: u32 = 0xa54ff53a;
    pub const H4: u32 = 0x510e527f;
    pub const H5: u32 = 0x9b05688c;
    pub const H6: u32 = 0x1f83d9ab;
    pub const H7: u32 = 0x5be0cd19;
}

/// Power of 2 for u32
fn pow2_32(n: u32) -> u32 {
    if n == 0 { 1_u32 }
    else if n == 1 { 2_u32 }
    else if n == 2 { 4_u32 }
    else if n == 3 { 8_u32 }
    else if n == 4 { 16_u32 }
    else if n == 5 { 32_u32 }
    else if n == 6 { 64_u32 }
    else if n == 7 { 128_u32 }
    else if n == 8 { 256_u32 }
    else if n == 9 { 512_u32 }
    else if n == 10 { 1024_u32 }
    else if n == 11 { 2048_u32 }
    else if n == 12 { 4096_u32 }
    else if n == 13 { 8192_u32 }
    else if n == 14 { 16384_u32 }
    else if n == 15 { 32768_u32 }
    else if n == 16 { 65536_u32 }
    else if n == 17 { 131072_u32 }
    else if n == 18 { 262144_u32 }
    else if n == 19 { 524288_u32 }
    else if n == 20 { 1048576_u32 }
    else if n == 21 { 2097152_u32 }
    else if n == 22 { 4194304_u32 }
    else if n == 23 { 8388608_u32 }
    else if n == 24 { 16777216_u32 }
    else if n == 25 { 33554432_u32 }
    else if n == 26 { 67108864_u32 }
    else if n == 27 { 134217728_u32 }
    else if n == 28 { 268435456_u32 }
    else if n == 29 { 536870912_u32 }
    else if n == 30 { 1073741824_u32 }
    else if n == 31 { 2147483648_u32 }
    else { 1_u32 }
}

/// Right rotate for u32
fn rotr32(x: u32, n: u32) -> u32 {
    (x / pow2_32(n)) | (x * pow2_32(32 - n))
}

/// Right shift for u32
fn shr32(x: u32, n: u32) -> u32 {
    x / pow2_32(n)
}

/// SHA256 Ch function: Ch(x,y,z) = (x AND y) XOR (NOT x AND z)
fn ch(x: u32, y: u32, z: u32) -> u32 {
    (x & y) ^ ((~x) & z)
}

/// SHA256 Maj function: Maj(x,y,z) = (x AND y) XOR (x AND z) XOR (y AND z)
fn maj(x: u32, y: u32, z: u32) -> u32 {
    (x & y) ^ (x & z) ^ (y & z)
}

/// SHA256 Σ0 function (big sigma 0)
fn big_sigma0(x: u32) -> u32 {
    rotr32(x, 2) ^ rotr32(x, 13) ^ rotr32(x, 22)
}

/// SHA256 Σ1 function (big sigma 1)
fn big_sigma1(x: u32) -> u32 {
    rotr32(x, 6) ^ rotr32(x, 11) ^ rotr32(x, 25)
}

/// SHA256 σ0 function (small sigma 0)
fn small_sigma0(x: u32) -> u32 {
    rotr32(x, 7) ^ rotr32(x, 18) ^ shr32(x, 3)
}

/// SHA256 σ1 function (small sigma 1)
fn small_sigma1(x: u32) -> u32 {
    rotr32(x, 17) ^ rotr32(x, 19) ^ shr32(x, 10)
}

/// Get array element with bounds check
fn get_w(w: @Array<u32>, i: u32) -> u32 {
    if i < w.len() { *w.at(i) } else { 0 }
}

/// SHA256 compression function for one 512-bit block
fn sha256_compress(state: @Array<u32>, block: @Array<u32>) -> Array<u32> {
    // Message schedule array W[0..63]
    let mut w: Array<u32> = array![];
    
    // First 16 words are from the message block
    let mut i: u32 = 0;
    loop {
        if i >= 16 {
            break;
        }
        if i < block.len() {
            w.append(*block.at(i));
        } else {
            w.append(0);
        }
        i += 1;
    };
    
    // Extend to 64 words
    i = 16;
    loop {
        if i >= 64 {
            break;
        }
        let s0 = small_sigma0(get_w(@w, i - 15));
        let s1 = small_sigma1(get_w(@w, i - 2));
        let new_w = get_w(@w, i - 16).wrapping_add(s0)
            .wrapping_add(get_w(@w, i - 7)).wrapping_add(s1);
        w.append(new_w);
        i += 1;
    };
    
    // Initialize working variables
    let mut a = *state.at(0);
    let mut b = *state.at(1);
    let mut c = *state.at(2);
    let mut d = *state.at(3);
    let mut e = *state.at(4);
    let mut f = *state.at(5);
    let mut g = *state.at(6);
    let mut h = *state.at(7);
    
    // Main compression loop (64 rounds)
    i = 0;
    loop {
        if i >= 64 {
            break;
        }
        
        let s1 = big_sigma1(e);
        let ch_val = ch(e, f, g);
        let temp1 = h.wrapping_add(s1).wrapping_add(ch_val)
            .wrapping_add(K::get(i)).wrapping_add(get_w(@w, i));
        let s0 = big_sigma0(a);
        let maj_val = maj(a, b, c);
        let temp2 = s0.wrapping_add(maj_val);
        
        h = g;
        g = f;
        f = e;
        e = d.wrapping_add(temp1);
        d = c;
        c = b;
        b = a;
        a = temp1.wrapping_add(temp2);
        
        i += 1;
    };
    
    // Add compressed chunk to current hash value
    let result: Array<u32> = array![
        (*state.at(0)).wrapping_add(a),
        (*state.at(1)).wrapping_add(b),
        (*state.at(2)).wrapping_add(c),
        (*state.at(3)).wrapping_add(d),
        (*state.at(4)).wrapping_add(e),
        (*state.at(5)).wrapping_add(f),
        (*state.at(6)).wrapping_add(g),
        (*state.at(7)).wrapping_add(h)
    ];
    
    result
}

/// Convert felt252 array to u32 words (big-endian)
fn felt_to_u32_words(data: @Array<felt252>) -> Array<u32> {
    let mut words: Array<u32> = array![];
    let len = data.len();
    let mut i: u32 = 0;
    
    loop {
        if i >= len {
            break;
        }
        let val: felt252 = *data.at(i);
        let val_u256: u256 = val.into();
        // Extract two u32 words from each felt252 (lower 64 bits)
        let low: u32 = (val_u256.low % 0x100000000).try_into().unwrap();
        let high: u32 = ((val_u256.low / 0x100000000) % 0x100000000).try_into().unwrap();
        words.append(high);
        words.append(low);
        i += 1;
    };
    
    words
}

/// Convert u256 to u32 words (8 words, big-endian)
fn u256_to_u32_words(val: u256) -> Array<u32> {
    let mut words: Array<u32> = array![];
    
    // High 128 bits (4 words) - extract from high part
    let h0: u32 = ((val.high / 0x1000000000000000000000000_u128) % 0x100000000_u128).try_into().unwrap();
    let h1: u32 = ((val.high / 0x10000000000000000_u128) % 0x100000000_u128).try_into().unwrap();
    let h2: u32 = ((val.high / 0x100000000_u128) % 0x100000000_u128).try_into().unwrap();
    let h3: u32 = (val.high % 0x100000000_u128).try_into().unwrap();
    words.append(h0);
    words.append(h1);
    words.append(h2);
    words.append(h3);
    
    // Low 128 bits (4 more words)
    let l0: u32 = ((val.low / 0x1000000000000000000000000_u128) % 0x100000000_u128).try_into().unwrap();
    let l1: u32 = ((val.low / 0x10000000000000000_u128) % 0x100000000_u128).try_into().unwrap();
    let l2: u32 = ((val.low / 0x100000000_u128) % 0x100000000_u128).try_into().unwrap();
    let l3: u32 = (val.low % 0x100000000_u128).try_into().unwrap();
    words.append(l0);
    words.append(l1);
    words.append(l2);
    words.append(l3);
    
    words
}

/// Convert u32 words to u256 (big-endian)
fn u32_words_to_u256(words: @Array<u32>) -> u256 {
    let w0: u128 = (*words.at(0)).into();
    let w1: u128 = (*words.at(1)).into();
    let w2: u128 = (*words.at(2)).into();
    let w3: u128 = (*words.at(3)).into();
    let w4: u128 = (*words.at(4)).into();
    let w5: u128 = (*words.at(5)).into();
    let w6: u128 = (*words.at(6)).into();
    let w7: u128 = (*words.at(7)).into();
    
    let high: u128 = (w0 * 0x1000000000000000000000000) 
        + (w1 * 0x10000000000000000) 
        + (w2 * 0x100000000) 
        + w3;
    let low: u128 = (w4 * 0x1000000000000000000000000) 
        + (w5 * 0x10000000000000000) 
        + (w6 * 0x100000000) 
        + w7;
    
    u256 { low, high }
}

/// Pad message block to 512 bits with length
fn pad_block(words: @Array<u32>, total_bits: u64) -> Array<u32> {
    let mut padded: Array<u32> = array![];
    let word_count = words.len();
    
    // Copy existing words
    let mut i: u32 = 0;
    loop {
        if i >= word_count {
            break;
        }
        padded.append(*words.at(i));
        i += 1;
    };
    
    // Add padding bit (0x80000000 if starting new word, or 0x80 shifted)
    if word_count < 14 {
        padded.append(0x80000000);
        // Pad with zeros until we have 14 words
        loop {
            if padded.len() >= 14 {
                break;
            }
            padded.append(0);
        };
    }
    
    // Add 64-bit length (in bits) as last two words
    let len_high: u32 = (total_bits / 0x100000000).try_into().unwrap();
    let len_low: u32 = (total_bits % 0x100000000).try_into().unwrap();
    padded.append(len_high);
    padded.append(len_low);
    
    padded
}

/// Compute SHA256 hash of input data
pub fn sha256(data: @Array<felt252>) -> u256 {
    // Initialize hash state
    let mut state: Array<u32> = array![
        H::H0, H::H1, H::H2, H::H3,
        H::H4, H::H5, H::H6, H::H7
    ];
    
    // Convert input to u32 words
    let words = felt_to_u32_words(data);
    let bit_len: u64 = (words.len() * 32).into();
    
    // Pad the message
    let padded = pad_block(@words, bit_len);
    
    // Process single 512-bit block
    state = sha256_compress(@state, @padded);
    
    // Convert state to u256
    u32_words_to_u256(@state)
}

/// Compute SHA256 hash of a u256 value
pub fn sha256_u256(val: u256) -> u256 {
    let mut state: Array<u32> = array![
        H::H0, H::H1, H::H2, H::H3,
        H::H4, H::H5, H::H6, H::H7
    ];
    
    let words = u256_to_u32_words(val);
    let padded = pad_block(@words, 256); // 256 bits
    
    state = sha256_compress(@state, @padded);
    
    u32_words_to_u256(@state)
}

/// Compute SHA256d (double SHA256) of input data
/// Used by Bitcoin/Zcash for Merkle trees
pub fn sha256d(data: @Array<felt252>) -> u256 {
    let first_hash = sha256(data);
    sha256_u256(first_hash)
}

/// Compute SHA256d of a u256 value
pub fn sha256d_u256(val: u256) -> u256 {
    let first_hash = sha256_u256(val);
    sha256_u256(first_hash)
}

/// Compute SHA256d of two u256 values concatenated (for Merkle trees)
/// SHA256d(a || b) = SHA256(SHA256(a || b))
pub fn sha256d_pair(a: u256, b: u256) -> u256 {
    // Initialize hash state
    let mut state: Array<u32> = array![
        H::H0, H::H1, H::H2, H::H3,
        H::H4, H::H5, H::H6, H::H7
    ];
    
    // Convert both u256 to words (16 words total = 512 bits, perfect block)
    let a_words = u256_to_u32_words(a);
    let b_words = u256_to_u32_words(b);
    
    let mut block: Array<u32> = array![];
    let mut i: u32 = 0;
    loop {
        if i >= 8 {
            break;
        }
        block.append(*a_words.at(i));
        i += 1;
    };
    i = 0;
    loop {
        if i >= 8 {
            break;
        }
        block.append(*b_words.at(i));
        i += 1;
    };
    
    // First hash (512-bit block, no padding needed but length appended)
    state = sha256_compress(@state, @block);
    
    // Need second block for padding
    let mut pad_block_arr: Array<u32> = array![
        0x80000000, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 0, 0x00000000, 0x00000200 // 512 bits = 0x200
    ];
    state = sha256_compress(@state, @pad_block_arr);
    
    let first_hash = u32_words_to_u256(@state);
    
    // Second hash
    sha256_u256(first_hash)
}
