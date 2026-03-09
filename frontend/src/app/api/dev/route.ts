// ============================================================================
// Zarklink — Dev Tools API Route
// ============================================================================
// Server-side API for devnet operations: Zcash address generation, funding,
// block mining, and wallet inspection. Only works on devnet (regtest).

import { NextRequest, NextResponse } from "next/server";

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

        // Get a transparent address with balance to send from.
        // Prefer non-coinbase UTXOs; if all are coinbase, send exact UTXO amount.
        const utxos = (await zcashRpc("listunspent", [1])) as Array<{
          address: string; amount: number; generated?: boolean;
        }>;
        if (utxos.length === 0) {
          return NextResponse.json({ ok: false, error: "No unspent UTXOs. Mine some blocks first." }, { status: 400 });
        }

        const requestedAmt = parseFloat(amount);

        // Prefer non-coinbase UTXO with enough balance
        let fromAddr = "";
        let sendAmt = requestedAmt;
        const nonCoinbase = utxos.filter(u => !u.generated && u.amount >= requestedAmt + 0.001);
        if (nonCoinbase.length > 0) {
          fromAddr = nonCoinbase[0].address;
          sendAmt = requestedAmt;
        } else {
          // Use coinbase UTXO — must send exact amount (no change allowed)
          const coinbase = utxos.filter(u => u.generated && u.amount >= requestedAmt);
          if (coinbase.length > 0) {
            fromAddr = coinbase[0].address;
            sendAmt = coinbase[0].amount - 0.01; // leave margin for auto fee
          } else if (utxos.length > 0) {
            fromAddr = utxos[0].address;
            sendAmt = requestedAmt;
          } else {
            return NextResponse.json({ ok: false, error: "No suitable UTXOs found" }, { status: 400 });
          }
        }

        // z_sendmany from transparent → shielded (NoPrivacy for devnet)
        // Use null fee to let zcashd auto-calculate ZIP 317 fee
        const opid = await zcashRpc("z_sendmany", [
          fromAddr,
          [{ address, amount: sendAmt }],
          1,    // minconf
          null, // auto-calculate fee (ZIP 317)
          "NoPrivacy", // devnet: allow transparent change
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

      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
