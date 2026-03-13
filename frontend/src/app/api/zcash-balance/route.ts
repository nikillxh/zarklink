// ============================================================================
// Zarklink — Zcash Balance API Route
// ============================================================================
// Proxies z_getbalance / z_gettotalbalance requests to zcashd RPC
// since the browser cannot call zcashd directly (CORS + auth).
//
// On testnet: public RPCs don't support wallet methods (z_getbalance, etc.).
// The balance is managed client-side via Zcash account association.

import { NextRequest, NextResponse } from "next/server";

const network = process.env.NEXT_PUBLIC_NETWORK ?? process.env.NETWORK ?? "devnet";

// ── Devnet / localhost zcashd ────────────────────────────────────────────────

const ZCASH_RPC_URL = process.env.NEXT_PUBLIC_ZCASH_RPC_URL ?? "http://127.0.0.1:18232";
// Server-only credentials (not exposed to browser)
const ZCASH_RPC_USER = process.env.ZCASH_RPC_USER ?? "zarklink";
const ZCASH_RPC_PASS = process.env.ZCASH_RPC_PASS ?? "";

// ── Zcash testnet public RPC (blockchain queries only) ──────────────────────

const ZCASH_TESTNET_RPC_URL = process.env.ZCASH_TESTNET_RPC_URL ?? "";
const TATUM_API_KEY = process.env.TATUM_API_KEY ?? "";

async function devnetRpcCall(method: string, params: unknown[] = []): Promise<unknown> {
  const auth = Buffer.from(`${ZCASH_RPC_USER}:${ZCASH_RPC_PASS}`).toString("base64");
  const res = await fetch(ZCASH_RPC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({ jsonrpc: "1.0", id: "zarklink-fe", method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`zcashd RPC error: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result;
}

async function testnetRpcCall(method: string, params: unknown[] = []): Promise<unknown> {
  if (!ZCASH_TESTNET_RPC_URL) throw new Error("ZCASH_TESTNET_RPC_URL not configured");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (TATUM_API_KEY) {
    headers["x-api-key"] = TATUM_API_KEY;
  }
  const res = await fetch(ZCASH_TESTNET_RPC_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: "zarklink-fe", method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Zcash testnet RPC error: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result;
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const method = request.nextUrl.searchParams.get("method"); // optional: for blockchain queries

  // ── Testnet mode ─────────────────────────────────────────────────────────
  if (network === "testnet") {
    // Wallet methods (z_getbalance, z_sendmany, etc.) are NOT available
    // on public testnet RPCs. Return "—" for balance queries.
    if (!method) {
      return NextResponse.json({
        balance: "—",
        note: "TAZ balance is managed in your Zcash testnet wallet. " +
              "Associate your Zcash address on the Account page.",
      });
    }

    // Allow blockchain queries (getblockcount, getblock, etc.) via testnet RPC
    try {
      const result = await testnetRpcCall(method, address ? [address] : []);
      return NextResponse.json({ result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: msg }, { status: 200 });
    }
  }

  // ── Devnet mode ──────────────────────────────────────────────────────────
  if (!ZCASH_RPC_PASS) {
    return NextResponse.json({ balance: "—" });
  }

  try {
    if (address) {
      // Get balance for a specific shielded address
      const balance = await devnetRpcCall("z_getbalance", [address]);
      return NextResponse.json({ balance: String(balance), address });
    } else {
      // Get total wallet balance
      const totals = (await devnetRpcCall("z_gettotalbalance", [])) as Record<string, string>;
      return NextResponse.json({
        transparent: totals.transparent ?? "0",
        private: totals.private ?? "0",
        total: totals.total ?? "0",
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    // Don't fail hard — just return unknown balance
    return NextResponse.json({ balance: "—", error: msg }, { status: 200 });
  }
}
