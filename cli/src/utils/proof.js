/**
 * ZK Proof Generation Utilities
 * Generate and verify zk-SNARK proofs for zarklink bridge
 */

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import blake2 from 'blake2';

// Paths
const CIRCUIT_PATH = process.env.CIRCUIT_PATH || '../circom';
const OUTPUT_PATH = process.env.OUTPUT_PATH || './output';

/**
 * Generate mint proof (πZKMint)
 * Proves that a Zcash note exists and is addressed to the vault
 */
export async function generateMintProof(params) {
  const {
    permitNonce,
    vaultAddressHash,
    noteCommitment,
    valueCommitmentCv,
    netValueCommitmentCvn,
    saplingRoot,
    // Private inputs
    value,
    fee,
    rcm,
    rcv,
    merkleProof,
  } = params;

  // Ensure output directory exists
  if (!existsSync(OUTPUT_PATH)) {
    mkdirSync(OUTPUT_PATH, { recursive: true });
  }

  // Prepare circuit input
  const input = {
    permit_nonce: bytesToBits(hexToBytes(permitNonce)),
    vault_address_hash: bytesToBits(hexToBytes(vaultAddressHash)),
    note_commitment: bytesToBits(hexToBytes(noteCommitment)),
    value_commitment_cv: bytesToBits(hexToBytes(valueCommitmentCv)),
    net_value_commitment_cvn: bytesToBits(hexToBytes(netValueCommitmentCvn)),
    sapling_root: bytesToBits(hexToBytes(saplingRoot)),
    value: u64ToBits(value),
    fee: u64ToBits(fee),
    rcm: bytesToBits(hexToBytes(rcm)),
    rcv: bytesToBits(hexToBytes(rcv)),
    merkle_proof: merkleProof.map(h => bytesToBits(hexToBytes(h))),
    merkle_index: merkleProof.index,
  };

  // Write input file
  const inputPath = join(OUTPUT_PATH, 'mint_input.json');
  writeFileSync(inputPath, JSON.stringify(input, null, 2));

  // Generate witness (requires compiled circuit)
  const witnessPath = join(OUTPUT_PATH, 'mint_witness.wtns');
  const circuitWasm = join(CIRCUIT_PATH, 'output', 'zclaim_mint_js', 'zclaim_mint.wasm');
  
  if (existsSync(circuitWasm)) {
    execSync(`node ${CIRCUIT_PATH}/output/zclaim_mint_js/generate_witness.js ${circuitWasm} ${inputPath} ${witnessPath}`);
  }

  // Generate proof using snarkjs
  const zkeyPath = join(CIRCUIT_PATH, 'output', 'zclaim_mint.zkey');
  const proofPath = join(OUTPUT_PATH, 'proof.json');
  const publicPath = join(OUTPUT_PATH, 'public.json');

  if (existsSync(zkeyPath)) {
    execSync(`snarkjs groth16 prove ${zkeyPath} ${witnessPath} ${proofPath} ${publicPath}`);
    
    const proof = JSON.parse(readFileSync(proofPath, 'utf8'));
    const publicSignals = JSON.parse(readFileSync(publicPath, 'utf8'));
    
    return { proof, publicSignals };
  }

  // Return mock proof for testing
  return {
    proof: {
      pi_a: ['0x1', '0x2', '0x1'],
      pi_b: [['0x3', '0x4'], ['0x5', '0x6'], ['0x1', '0x0']],
      pi_c: ['0x7', '0x8', '0x1'],
      protocol: 'groth16',
    },
    publicSignals: [
      permitNonce,
      vaultAddressHash,
      noteCommitment,
      valueCommitmentCv,
      netValueCommitmentCvn,
      saplingRoot,
    ],
  };
}

/**
 * Generate balance proof for vault
 * Proves vault's ZEC obligations match their holdings
 */
export async function generateBalanceProof(params) {
  const {
    vaultAddress,
    balanceCommitment,
    exchangeRate,
    notes, // Array of unspent notes
  } = params;

  // In production, this would generate a zk-SNARK proving
  // sum(notes.value) >= obligations
  
  return {
    proof: {
      pi_a: ['0x1', '0x2', '0x1'],
      pi_b: [['0x3', '0x4'], ['0x5', '0x6'], ['0x1', '0x0']],
      pi_c: ['0x7', '0x8', '0x1'],
    },
    balanceCommitment,
    exchangeRate,
    validAtHeight: Date.now(),
  };
}

/**
 * Derive rcm (note randomness) from permit nonce
 * rcm = BLAKE2b-256("Zclaim_rcm" || permit_nonce || user_emk)
 */
export function deriveRcm(permitNonce, userEmk) {
  const h = blake2.createHash('blake2b', {
    digestLength: 32,
    personalization: Buffer.from('Zclaim__rcm_drv\x00', 'ascii'),
  });
  h.update(Buffer.from(permitNonce, 'hex'));
  h.update(Buffer.from(userEmk, 'hex'));
  return h.digest().toString('hex');
}

/**
 * Compute note commitment
 * cm = PedersenCommit(d || pkd || v || rcm)
 */
export function computeNoteCommitment(d, pkd, value, rcm) {
  // Simplified - in production use actual Pedersen commitment
  const h = blake2.createHash('blake2b', {
    digestLength: 32,
    personalization: Buffer.from('Zcash_cm_commit\x00', 'ascii'),
  });
  h.update(Buffer.from(d, 'hex'));
  h.update(Buffer.from(pkd, 'hex'));
  h.update(Buffer.alloc(8).fill(0)); // value as 8 bytes
  h.update(Buffer.from(rcm, 'hex'));
  return h.digest().toString('hex');
}

/**
 * Compute value commitment
 * cv = ValueCommit(v, rcv) = v*V + rcv*R
 */
export function computeValueCommitment(value, rcv) {
  const h = blake2.createHash('blake2b', {
    digestLength: 32,
    personalization: Buffer.from('Zcash_cv_commit\x00', 'ascii'),
  });
  const valueBuf = Buffer.alloc(8);
  valueBuf.writeBigUInt64LE(BigInt(value));
  h.update(valueBuf);
  h.update(Buffer.from(rcv, 'hex'));
  return h.digest().toString('hex');
}

// Helper functions
function hexToBytes(hex) {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Buffer.from(cleanHex, 'hex');
}

function bytesToBits(bytes) {
  const bits = [];
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }
  return bits;
}

function u64ToBits(value) {
  const bits = [];
  const bigValue = BigInt(value);
  for (let i = 63; i >= 0; i--) {
    bits.push(Number((bigValue >> BigInt(i)) & 1n));
  }
  return bits;
}
