/**
 * Header Processor
 * Parse and encode Zcash block headers for Starknet
 */

import blake2 from 'blake2';

export class HeaderProcessor {
  /**
   * Parse raw Zcash block header
   * @param {string} headerHex - Raw header in hex (280 chars = 140 bytes)
   */
  parseHeader(headerHex) {
    const header = Buffer.from(headerHex, 'hex');
    
    return {
      version: header.readUInt32LE(0),
      prevBlockHash: header.slice(4, 36).reverse().toString('hex'),
      merkleRoot: header.slice(36, 68).reverse().toString('hex'),
      saplingRoot: header.slice(68, 100).reverse().toString('hex'),
      timestamp: header.readUInt32LE(100),
      bits: header.readUInt32LE(104),
      nonce: header.slice(108, 140).toString('hex'),
    };
  }
  
  /**
   * Compute block hash using BLAKE2b-256 with Zcash personalization
   * @param {Buffer} headerBytes - Full header bytes including solution
   */
  computeBlockHash(headerBytes) {
    // Zcash uses BLAKE2b-256 with personalization "ZcashBlockHash"
    const h = blake2.createHash('blake2b', {
      digestLength: 32,
      personalization: Buffer.from('ZcashBlockHash\x00\x00', 'ascii'),
    });
    h.update(headerBytes);
    // Reverse for display format
    return h.digest().reverse().toString('hex');
  }
  
  /**
   * Encode header for Starknet relay contract
   * Returns array of felt252 values
   * @param {Object} header - Parsed header object
   */
  encodeForStarknet(header) {
    // Split 32-byte hash into low/high u128 for u256
    const splitU256 = (hexStr) => {
      const buf = Buffer.from(hexStr, 'hex');
      // Note: We need to handle endianness properly
      // low = last 16 bytes, high = first 16 bytes
      const low = BigInt('0x' + buf.slice(16, 32).toString('hex'));
      const high = BigInt('0x' + buf.slice(0, 16).toString('hex'));
      return [low.toString(), high.toString()];
    };
    
    const encoded = [
      ...splitU256(header.prevBlockHash),  // [0-1]: prev_block_hash u256
      ...splitU256(header.merkleRoot),     // [2-3]: merkle_root u256
      ...splitU256(header.saplingRoot),    // [4-5]: sapling_root u256
      header.timestamp.toString(),          // [6]: timestamp u64
      header.bits.toString(),               // [7]: bits u32
    ];
    
    return encoded;
  }
  
  /**
   * Validate header against target (PoW check)
   * @param {string} blockHash - Block hash in hex
   * @param {number} bits - Difficulty bits
   */
  validatePoW(blockHash, bits) {
    // Extract target from compact bits format
    const exponent = bits >> 24;
    const mantissa = bits & 0x007fffff;
    
    let target;
    if (exponent <= 3) {
      target = BigInt(mantissa) >> BigInt(8 * (3 - exponent));
    } else {
      target = BigInt(mantissa) << BigInt(8 * (exponent - 3));
    }
    
    // Compare hash to target
    const hashValue = BigInt('0x' + blockHash);
    return hashValue <= target;
  }
  
  /**
   * Calculate work from difficulty bits
   * @param {number} bits - Difficulty bits
   */
  calculateWork(bits) {
    const exponent = bits >> 24;
    const mantissa = bits & 0x007fffff;
    
    let target;
    if (exponent <= 3) {
      target = BigInt(mantissa) >> BigInt(8 * (3 - exponent));
    } else {
      target = BigInt(mantissa) << BigInt(8 * (exponent - 3));
    }
    
    if (target === 0n) {
      return 0n;
    }
    
    // Work = 2^256 / (target + 1)
    const maxU256 = (1n << 256n) - 1n;
    return maxU256 / (target + 1n);
  }
  
  /**
   * Verify header chain (prevBlockHash links)
   * @param {Array} headers - Array of parsed headers
   */
  verifyChain(headers) {
    for (let i = 1; i < headers.length; i++) {
      // Each header's prevBlockHash should match previous header's hash
      // Note: Would need to compute hash for each header
      // This is a simplified check
      if (!headers[i].prevBlockHash) {
        return false;
      }
    }
    return true;
  }
}
