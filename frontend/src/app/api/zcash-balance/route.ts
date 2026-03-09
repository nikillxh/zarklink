// ============================================================================
// Zarklink — Zcash Balance API Route
// ============================================================================
// Proxies z_getbalance / z_gettotalbalance requests to zcashd RPC
// since the browser cannot call zcashd directly (CORS + auth).

import { NextRequest, NextResponse } from "next/server";

const ZCASH_RPC_URL = process.env.NEXT_PUBLIC_ZCASH_RPC_URL ?? "http://127.0.0.1:18232";
// Server-only credentials (not exposed to browser)
const ZCASH_RPC_USER = process.env.ZCASH_RPC_USER ?? "zarklink";
const ZCASH_RPC_PASS = process.env.ZCASH_RPC_PASS ?? "";

async function rpcCall(method: string, params: unknown[] = []): Promise<unknown> {
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

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");

  try {
    if (address) {
      // Get balance for a specific shielded address
      const balance = await rpcCall("z_getbalance", [address]);
      return NextResponse.json({ balance: String(balance), address });
    } else {
      // Get total wallet balance
      const totals = (await rpcCall("z_gettotalbalance", [])) as Record<string, string>;
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
