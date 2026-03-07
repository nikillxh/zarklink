"use client";

import { useState } from "react";
import {
  ArrowLeftRight,
  ArrowDown,
  Zap,
  Shield,
  Info,
  Loader2,
} from "lucide-react";
import { useBridgeStats, usePoolStats } from "@/hooks/useStarknet";
import { useAccount } from "@/context/AccountContext";
import { formatZec, shortAddr } from "@/lib/starknet";

type Tab = "issue" | "redeem";

export default function BridgePage() {
  const [tab, setTab] = useState<Tab>("issue");
  const [amount, setAmount] = useState("");
  const [splits, setSplits] = useState("16");
  const [zcashAddress, setZcashAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const { stats: bridge } = useBridgeStats();
  const { stats: pool } = usePoolStats();
  const { current: account, getAccount } = useAccount();

  const zatoshi = Math.floor(parseFloat(amount || "0") * 1e8);
  const fee = bridge ? (zatoshi * bridge.feeRate) / 10000 : 0;
  const receiveAmount = zatoshi - fee;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || zatoshi <= 0) return;

    setSubmitting(true);
    setResult(null);

    try {
      const signer = getAccount();
      if (!signer) {
        setResult("Error: No account selected. Select a devnet account from the navbar.");
        return;
      }

      // Simulate the bridge operation for now — in production this would
      // call the actual Starknet contracts via the selected account
      await new Promise((r) => setTimeout(r, 2000));

      if (tab === "issue") {
        setResult(
          `Issue request submitted for ${formatZec(BigInt(zatoshi))} ` +
          `across ${splits} vault slots from ${shortAddr(account?.address ?? "")}. ` +
          `Send ZEC to the assigned vault address.`
        );
      } else {
        setResult(
          `Redeem request submitted for ${formatZec(BigInt(zatoshi))} ` +
          `from ${shortAddr(account?.address ?? "")}. ` +
          `ZEC will be sent to ${zcashAddress.slice(0, 12)}...`
        );
      }
    } catch (err: unknown) {
      setResult(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-2">Bridge</h1>
        <p className="text-gray-400">
          Transfer between Zcash and Starknet with privacy-preserving splitting
        </p>
      </div>

      <div className="max-w-lg mx-auto">
        {/* Tab Selector */}
        <div className="flex bg-brand-card border border-brand-border rounded-xl p-1 mb-6">
          <button
            onClick={() => { setTab("issue"); setResult(null); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === "issue"
                ? "bg-brand-primary/10 text-brand-primary border border-brand-primary/30"
                : "text-gray-400 hover:text-foreground"
            }`}
          >
            <Zap className="h-4 w-4" />
            Issue (ZEC → wZEC)
          </button>
          <button
            onClick={() => { setTab("redeem"); setResult(null); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === "redeem"
                ? "bg-brand-blue/10 text-brand-blue border border-brand-blue/30"
                : "text-gray-400 hover:text-foreground"
            }`}
          >
            <ArrowLeftRight className="h-4 w-4" />
            Redeem (wZEC → ZEC)
          </button>
        </div>

        {/* Bridge Form */}
        <form onSubmit={handleSubmit}>
          <div className="card mb-4">
            {/* From */}
            <div className="mb-4">
              <label className="flex items-center justify-between text-sm text-gray-400 mb-2">
                <span>{tab === "issue" ? "From (Zcash)" : "From (Starknet)"}</span>
                {pool && (
                  <span className="text-xs">
                    Pool: {formatZec(pool.capacity)}
                  </span>
                )}
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  step="0.00000001"
                  min="0"
                  placeholder="0.00000000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input-field flex-1 text-xl font-mono"
                />
                <span className="text-sm font-medium text-brand-primary px-3 py-2 bg-brand-primary/10 rounded-lg border border-brand-primary/20">
                  {tab === "issue" ? "ZEC" : "wZEC"}
                </span>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center my-2">
              <div className="h-8 w-8 rounded-full bg-brand-dark border border-brand-border flex items-center justify-center">
                <ArrowDown className="h-4 w-4 text-gray-400" />
              </div>
            </div>

            {/* To */}
            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-2 block">
                {tab === "issue" ? "To (Starknet)" : "To (Zcash)"}
              </label>
              <div className="flex items-center gap-3">
                <div className="input-field flex-1 text-xl font-mono text-gray-300">
                  {receiveAmount > 0
                    ? (receiveAmount / 1e8).toFixed(8)
                    : "0.00000000"}
                </div>
                <span className="text-sm font-medium text-brand-blue px-3 py-2 bg-brand-blue/10 rounded-lg border border-brand-blue/20">
                  {tab === "issue" ? "wZEC" : "ZEC"}
                </span>
              </div>
            </div>

            {/* Zcash address (redeem only) */}
            {tab === "redeem" && (
              <div className="mb-4">
                <label className="text-sm text-gray-400 mb-2 block">
                  Zcash Shielded Address
                </label>
                <input
                  type="text"
                  placeholder="zs1..."
                  value={zcashAddress}
                  onChange={(e) => setZcashAddress(e.target.value)}
                  className="input-field w-full font-mono text-sm"
                />
              </div>
            )}

            {/* Privacy splits */}
            <div className="mb-4">
              <label className="flex items-center gap-1 text-sm text-gray-400 mb-2">
                <Shield className="h-3.5 w-3.5" />
                Privacy Splits
              </label>
              <select
                value={splits}
                onChange={(e) => setSplits(e.target.value)}
                className="input-field w-full"
              >
                <option value="1">1 vault (no splitting)</option>
                <option value="4">4 vaults</option>
                <option value="8">8 vaults</option>
                <option value="16">16 vaults (recommended)</option>
                <option value="32">32 vaults (max privacy)</option>
              </select>
            </div>

            {/* Fee Info */}
            <div className="bg-brand-dark rounded-lg p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Bridge Fee</span>
                <span className="text-foreground">
                  {bridge ? `${(bridge.feeRate / 100).toFixed(2)}%` : "—"}
                  {fee > 0 && (
                    <span className="text-gray-500 ml-1">
                      ({formatZec(BigInt(Math.floor(fee)))})
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Vault Splits</span>
                <span className="text-foreground">{splits} slots</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Finality</span>
                <span className="text-foreground">~6 Zcash blocks</span>
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !amount || zatoshi <= 0 || (tab === "redeem" && !zcashAddress)}
            className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
              tab === "issue"
                ? "btn-primary"
                : "bg-brand-blue text-white hover:bg-brand-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
            }`}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Processing...
              </span>
            ) : tab === "issue" ? (
              "Issue wZEC"
            ) : (
              "Redeem ZEC"
            )}
          </button>
        </form>

        {/* Result */}
        {result && (
          <div className="mt-4 p-4 rounded-xl bg-brand-primary/5 border border-brand-primary/20">
            <div className="flex items-start gap-2">
              <Info className="h-5 w-5 text-brand-primary mt-0.5 shrink-0" />
              <p className="text-sm text-gray-300">{result}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
