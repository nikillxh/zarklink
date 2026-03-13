// ============================================================================
// Zarklink — Dev Tools API Route
// ============================================================================
// Server-side API for devnet operations: Zcash address generation, funding,
// block mining, and wallet inspection. Only works on devnet (regtest).

import { NextRequest, NextResponse } from "next/server";

// Block in non-devnet environments
const NETWORK = process.env.NEXT_PUBLIC_NETWORK ?? "devnet";

const ZCASH_RPC_URL = process.env.NEXT_PUBLIC_ZCASH_RPC_URL ?? "http://127.0.0.1:18232";
const ZCASH_RPC_USER = process.env.ZCASH_RPC_USER ?? "zarklink";
const ZCASH_RPC_PASS = process.env.ZCASH_RPC_PASS ?? "";
const ZCASH_DATADIR = process.env.ZCASH_DATADIR ?? ".devnet/zcash";

async function zcashRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const auth = Buffer.from(`${ZCASH_RPC_USER}:${ZCASH_RPC_PASS}`).toString("base64");
  const res = await fetch(ZCASH_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: "1.0", id: "zarklink-dev", method, params }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`zcashd RPC ${method}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? `RPC error in ${method}`);
  return json.result;
}

// POST /api/dev  — body: { action, ...params }
export async function POST(request: NextRequest) {
  // Block in non-devnet environments
  if (NETWORK !== "devnet") {
    return NextResponse.json({ ok: false, error: "Dev API is only available on devnet" }, { status: 403 });
  }
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      // ── Zcash Address Generation ──────────────────────────────────
      case "generate_z_address": {
        const addr = await zcashRpc("z_getnewaddress", ["sapling"]);
        return NextResponse.json({ ok: true, address: addr, type: "shielded" });
      }

      case "generate_t_address": {
        const addr = await zcashRpc("getnewaddress", []);
        return NextResponse.json({ ok: true, address: addr, type: "transparent" });
      }

      // ── Zcash Funding ─────────────────────────────────────────────
      case "mine_blocks": {
        const count = Math.min(body.count ?? 1, 200);
        // Use zcashd regtest's 'generate' method
        const hashes = await zcashRpc("generate", [count]);
        return NextResponse.json({
          ok: true,
          blocks_mined: count,
          last_hash: Array.isArray(hashes) ? hashes[hashes.length - 1] : null,
        });
      }

      case "fund_z_address": {
        // Send ZEC from wallet to a shielded address
        const { address, amount } = body;
        if (!address || !amount) {
          return NextResponse.json({ ok: false, error: "Missing address or amount" }, { status: 400 });
        }

        const requestedAmt = parseFloat(amount);

        // Strategy: Try transparent UTXOs first (minconf=0), then shielded balance
        let fromAddr = "";
        let sendAmt = requestedAmt;

        // 1. Try transparent UTXOs (include unconfirmed with minconf=0)
        const utxos = (await zcashRpc("listunspent", [0])) as Array<{
          address: string; amount: number; generated?: boolean; confirmations?: number;
        }>;

        if (utxos.length > 0) {
          // Prefer non-coinbase UTXO with enough balance
          const nonCoinbase = utxos.filter(u => !u.generated && u.amount >= requestedAmt + 0.001);
          if (nonCoinbase.length > 0) {
            fromAddr = nonCoinbase[0].address;
            sendAmt = requestedAmt;
          } else {
            // Use mature coinbase UTXO (≥100 confirmations)
            const matureCoinbase = utxos.filter(u => u.generated && (u.confirmations ?? 0) >= 100 && u.amount >= requestedAmt);
            if (matureCoinbase.length > 0) {
              fromAddr = matureCoinbase[0].address;
              sendAmt = matureCoinbase[0].amount - 0.01; // leave margin for fee
            } else {
              // Any UTXO with sufficient balance
              const any = utxos.filter(u => u.amount >= requestedAmt);
              if (any.length > 0) {
                fromAddr = any[0].address;
                sendAmt = requestedAmt;
              }
            }
          }
        }

        // 2. If no transparent UTXOs, try sending from a shielded address
        if (!fromAddr) {
          const zAddrs = (await zcashRpc("z_listaddresses", [])) as string[];
          for (const zA of zAddrs) {
            const bal = (await zcashRpc("z_getbalance", [zA, 0])) as number;
            if (bal >= requestedAmt + 0.001) {
              fromAddr = zA;
              sendAmt = requestedAmt;
              break;
            }
          }
        }

        if (!fromAddr) {
          return NextResponse.json({
            ok: false,
            error: "No funds available (transparent or shielded). Mine at least 101 blocks first — coinbase rewards need 100 confirmations to mature.",
          }, { status: 400 });
        }

        // z_sendmany (works from both transparent and shielded addresses)
        // Use null fee to let zcashd auto-calculate ZIP 317 fee
        const opid = await zcashRpc("z_sendmany", [
          fromAddr,
          [{ address, amount: sendAmt }],
          0,    // minconf=0 to allow unconfirmed inputs
          null, // auto-calculate fee (ZIP 317)
          "NoPrivacy", // devnet: allow any privacy level
        ]);

        return NextResponse.json({
          ok: true,
          operation_id: opid,
          from: fromAddr,
          to: address,
          amount: sendAmt,
        });
      }

      case "fund_t_address": {
        // Send ZEC to a transparent address using sendtoaddress
        const { address, amount } = body;
        if (!address || !amount) {
          return NextResponse.json({ ok: false, error: "Missing address or amount" }, { status: 400 });
        }
        const txid = await zcashRpc("sendtoaddress", [address, parseFloat(amount)]);
        return NextResponse.json({
          ok: true,
          txid,
          to: address,
          amount: parseFloat(amount),
        });
      }

      // ── Zcash Operation Status ────────────────────────────────────
      case "check_operation": {
        const { opid } = body;
        if (!opid) return NextResponse.json({ ok: false, error: "Missing opid" }, { status: 400 });
        const status = await zcashRpc("z_getoperationstatus", [[opid]]);
        return NextResponse.json({ ok: true, status });
      }

      // ── Zcash Wallet Info ─────────────────────────────────────────
      case "wallet_info": {
        const [info, totals, blockcount, addresses] = await Promise.all([
          zcashRpc("getinfo", []) as Promise<Record<string, unknown>>,
          zcashRpc("z_gettotalbalance", []) as Promise<Record<string, string>>,
          zcashRpc("getblockcount", []) as Promise<number>,
          zcashRpc("z_listaddresses", []) as Promise<string[]>,
        ]);
        const tAddrs = (await zcashRpc("listaddresses", [])) as Array<Record<string, unknown>>;
        const transparentAddrs: string[] = [];
        for (const a of tAddrs) {
          if (a.source === "legacy_random" || a.source === "mnemonic_seed") {
            const transparent = a.transparent as { addresses?: string[] } | undefined;
            if (transparent?.addresses) transparentAddrs.push(...transparent.addresses);
          }
        }

        return NextResponse.json({
          ok: true,
          blocks: blockcount,
          version: info.version,
          balance: totals,
          shielded_addresses: addresses,
          transparent_addresses: transparentAddrs,
        });
      }

      // ── Zcash Block Headers (for relay seeding) ──────────────────
      case "get_block_headers": {
        const startH = body.start ?? 1;
        const count = Math.min(body.count ?? 10, 50);
        const headers: Record<string, unknown>[] = [];

        for (let h = startH; h < startH + count; h++) {
          try {
            const hash = await zcashRpc("getblockhash", [h]);
            const hdr = (await zcashRpc("getblockheader", [hash as string])) as Record<string, unknown>;
            headers.push({
              height: h,
              version: hdr.version,
              prev_block_hash: hdr.previousblockhash ?? "0",
              merkle_root: hdr.merkleroot,
              commitment_root: hdr.finalsaplingroot,
              timestamp: hdr.time,
              bits: hdr.bits,
              nonce: hdr.nonce,
            });
          } catch { break; }
        }

        return NextResponse.json({ ok: true, headers, count: headers.length });
      }

      // ── List address balances ─────────────────────────────────────
      case "list_balances": {
        const zAddrs = (await zcashRpc("z_listaddresses", [])) as string[];
        const balances: { address: string; balance: string; type: string }[] = [];

        for (const addr of zAddrs) {
          const bal = (await zcashRpc("z_getbalance", [addr])) as number;
          balances.push({ address: addr, balance: String(bal), type: "shielded" });
        }

        const totals = (await zcashRpc("z_gettotalbalance", [])) as Record<string, string>;
        return NextResponse.json({
          ok: true,
          balances,
          totals,
        });
      }

      // ── Direct z_sendmany (from specific address) ────────────────
      case "send_zec": {
        // Send ZEC from a specific shielded/transparent address to a target.
        // Used by the bridge Issue flow to transfer ZEC from issuer to vault.
        const { from_address, to_address, amount: sendAmount } = body;
        if (!from_address || !to_address || !sendAmount) {
          return NextResponse.json({ ok: false, error: "Missing from_address, to_address, or amount" }, { status: 400 });
        }
        const amt = parseFloat(sendAmount);
        if (isNaN(amt) || amt <= 0) {
          return NextResponse.json({ ok: false, error: "Invalid amount" }, { status: 400 });
        }

        const opid = await zcashRpc("z_sendmany", [
          from_address,
          [{ address: to_address, amount: amt }],
          0,    // minconf=0
          null, // auto-fee (ZIP 317)
          "AllowFullyTransparent",
        ]);

        return NextResponse.json({
          ok: true,
          operation_id: opid,
          from: from_address,
          to: to_address,
          amount: amt,
        });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
