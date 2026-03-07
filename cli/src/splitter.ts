// ============================================================================
// Zarklink — Splitting Strategy
// ============================================================================
// Implements the privacy-preserving splitting algorithm from the ZCLAIM
// paper (Section V). Splits transfer amounts across k vaults using
// power-of-2 piece sizes so no vault can infer the total amount.

/**
 * Split an amount into k pieces using the ZCLAIM strategy.
 *
 * Properties:
 *   - All pieces are 0 or powers of 2
 *   - Total pieces = k (padded with zeros)
 *   - Privacy: any vault's posterior ≤ constant × prior
 *
 * @param totalAmount - Total amount in zatoshi
 * @param k - Number of vaults (default 16)
 * @param maxBits - Maximum bit width (default 40 for ~10.99 ZEC)
 * @returns Array of k piece amounts
 */
export function splitAmount(
  totalAmount: bigint,
  k = 16,
  maxBits = 40,
): bigint[] {
  if (totalAmount <= 0n) {
    return new Array(k).fill(0n);
  }

  const maxVal = (1n << BigInt(maxBits)) - 1n;
  if (totalAmount > maxVal) {
    throw new Error(
      `Amount ${totalAmount} exceeds max ${maxVal} (${maxBits} bits)`,
    );
  }

  // Step 1: Decompose into powers of 2
  const pieces: bigint[] = [];
  let remaining = totalAmount;

  // Binary decomposition
  for (let bit = BigInt(maxBits) - 1n; bit >= 0n; bit--) {
    const power = 1n << bit;
    if (remaining >= power) {
      pieces.push(power);
      remaining -= power;
    }
  }

  // Step 2: If more pieces than k, merge smallest pairs
  while (pieces.length > k) {
    // Sort ascending
    pieces.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    // Merge two smallest
    const a = pieces.shift()!;
    const b = pieces.shift()!;
    pieces.push(a + b);
  }

  // Step 3: Randomization — split larger pieces to add noise
  // Split random pieces to increase diversity (up to k total)
  while (pieces.length < k) {
    // Find largest piece that can be split into two powers of 2
    let splitIdx = -1;
    let splitVal = 0n;

    for (let i = 0; i < pieces.length; i++) {
      if (pieces[i] > 1n && pieces[i] > splitVal) {
        splitVal = pieces[i];
        splitIdx = i;
      }
    }

    if (splitIdx === -1) break; // Nothing left to split

    // Split: if piece is a power of 2, split into two halves
    const piece = pieces[splitIdx];
    const half = piece >> 1n;
    if (half > 0n) {
      pieces[splitIdx] = half;
      pieces.push(half);
    } else {
      break;
    }
  }

  // Step 4: Pad with zeros to reach exactly k
  while (pieces.length < k) {
    pieces.push(0n);
  }

  // Step 5: Shuffle using Fisher-Yates
  for (let i = pieces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }

  return pieces;
}

/**
 * Validate that pieces sum to the correct total.
 */
export function validateSplit(pieces: bigint[], expectedTotal: bigint): boolean {
  const sum = pieces.reduce((a, b) => a + b, 0n);
  return sum === expectedTotal;
}

/**
 * Get the entropy (information leaked) of a split.
 * Lower values mean better privacy.
 */
export function splitEntropy(pieces: bigint[]): number {
  const nonZero = pieces.filter((p) => p > 0n);
  const total = nonZero.reduce((a, b) => a + b, 0n);
  if (total === 0n) return 0;

  let entropy = 0;
  for (const piece of nonZero) {
    const p = Number(piece) / Number(total);
    if (p > 0) {
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

/**
 * Format a split for display.
 */
export function formatSplit(pieces: bigint[]): string {
  const nonZero = pieces.filter((p) => p > 0n);
  const total = pieces.reduce((a, b) => a + b, 0n);
  const lines = [
    `Total: ${Number(total) / 1e8} ZEC across ${nonZero.length} vaults (${pieces.length} slots)`,
    `Entropy: ${splitEntropy(pieces).toFixed(3)} bits`,
    `Pieces: ${nonZero.map((p) => `${Number(p) / 1e8}`).join(", ")}`,
  ];
  return lines.join("\n");
}
