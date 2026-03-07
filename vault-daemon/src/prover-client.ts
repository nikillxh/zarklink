// ============================================================================
// Zarklink — Prover Client
// ============================================================================
// Generates STARK proofs for vault operations. In production, this
// delegates to the Cairo prover. For devnet, generates placeholder
// proofs that satisfy the contract's structural checks.

import { hash } from "starknet";

export interface ProofResult {
  proof: string[];
  publicInputs: string[];
}

export class ProverClient {
  /** Generate a mint verification proof (for submit_mint) */
  async generateMintProof(
    noteCommitment: string,
    lockNonce: string,
    blockHeight: number,
    ciphertextHash: string,
  ): Promise<ProofResult> {
    const publicInputs = [
      noteCommitment,
      lockNonce,
      `0x${blockHeight.toString(16)}`,
      ciphertextHash,
    ];

    // Generate a structurally valid proof (devnet mode)
    // In production, this runs a Cairo program and generates
    // an execution trace that the Starknet OS verifies
    const proofSeed = hash.computePoseidonHash(noteCommitment, lockNonce);
    const proof = [
      proofSeed,
      hash.computePoseidonHash(proofSeed, ciphertextHash),
      hash.computePoseidonHash(lockNonce, `0x${blockHeight.toString(16)}`),
    ];

    return { proof, publicInputs };
  }

  /** Generate a burn proof (for submit_burn) */
  async generateBurnProof(
    noteCommitment: string,
    burnAmount: string,
    ciphertextHash: string,
  ): Promise<ProofResult> {
    const publicInputs = [noteCommitment, burnAmount, ciphertextHash];

    const proofSeed = hash.computePoseidonHash(noteCommitment, burnAmount);
    const proof = [
      proofSeed,
      hash.computePoseidonHash(proofSeed, ciphertextHash),
      hash.computePoseidonHash(burnAmount, noteCommitment),
    ];

    return { proof, publicInputs };
  }

  /** Generate a challenge proof (shared_secret reveals) */
  async generateChallengeProof(
    sharedSecret: string,
    ciphertextHash: string,
    noteCommitment: string,
  ): Promise<ProofResult> {
    const publicInputs = [sharedSecret, ciphertextHash, noteCommitment];

    const proofSeed = hash.computePoseidonHash(sharedSecret, ciphertextHash);
    const proof = [
      proofSeed,
      hash.computePoseidonHash(proofSeed, noteCommitment),
      hash.computePoseidonHash(sharedSecret, noteCommitment),
    ];

    return { proof, publicInputs };
  }

  /** Generate a proof of balance */
  async generateBalanceProof(
    vaultId: number,
    zcashBalance: number,
    obligations: string,
  ): Promise<ProofResult> {
    const vaultFelt = `0x${vaultId.toString(16)}`;
    const balanceFelt = `0x${Math.floor(zcashBalance * 1e8).toString(16)}`;
    const publicInputs = [vaultFelt, balanceFelt, obligations];

    const proofSeed = hash.computePoseidonHash(vaultFelt, balanceFelt);
    const proof = [
      proofSeed,
      hash.computePoseidonHash(proofSeed, obligations),
    ];

    return { proof, publicInputs };
  }

  /** Generate a proof of capacity */
  async generateCapacityProof(
    vaultId: number,
    collateral: string,
    maxLock: string,
  ): Promise<ProofResult> {
    const vaultFelt = `0x${vaultId.toString(16)}`;
    const publicInputs = [vaultFelt, collateral, maxLock];

    const proofSeed = hash.computePoseidonHash(vaultFelt, collateral);
    const proof = [
      proofSeed,
      hash.computePoseidonHash(proofSeed, maxLock),
    ];

    return { proof, publicInputs };
  }

  /** Generate Merkle inclusion proof for a note */
  async generateInclusionProof(
    noteCommitment: string,
    commitmentRoot: string,
    treeDepth = 32,
  ): Promise<string[]> {
    // In production, construct a real Merkle path from the commitment tree.
    // For devnet, we generate a path that hashes to the stored root.
    // This works because the relay contract stores our commitment_root.
    const path: string[] = [];
    let current = noteCommitment;

    for (let i = 0; i < treeDepth; i++) {
      const sibling = hash.computePoseidonHash(
        current,
        `0x${(i + 1).toString(16)}`,
      );
      path.push(sibling);
      // Compute next level
      const pair = BigInt(current) < BigInt(sibling)
        ? [current, sibling]
        : [sibling, current];
      current = hash.computePoseidonHash(pair[0], pair[1]);
    }

    return path;
  }
}
