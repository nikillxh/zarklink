"use client";

import { useState, useCallback } from "react";
import { Wallet, ChevronDown, Unplug, Monitor, Globe, Copy, Check, Eye, EyeOff } from "lucide-react";
import { useWallet, type WalletMode } from "@/context/WalletContext";
import { useAccount } from "@/context/AccountContext";
import { shortAddr } from "@/lib/starknet";

// ── Clipboard copy button ────────────────────────────────────────────────────

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement("textarea");
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [value]);

  if (!value) return null;

  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
        <p className="font-mono text-[11px] text-gray-300 break-all leading-tight mt-0.5">{value}</p>
      </div>
      <button
        onClick={copy}
        className="shrink-0 mt-3 p-1 rounded hover:bg-white/10 transition-colors"
        title="Copy"
      >
        {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-gray-500" />}
      </button>
    </div>
  );
}

export default function WalletConnector() {
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const wallet = useWallet();
  const { accounts, selectedIndex, select, current: devnetAccount } = useAccount();

  return (
    <div className="relative">
      {/* Main button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-card border border-brand-border hover:border-brand-primary/40 transition-all text-sm"
      >
        <Wallet className="h-4 w-4 text-brand-primary" />
        <span className="font-mono text-xs">
          {wallet.isConnected ? wallet.displayAddress : "Connect"}
        </span>
        {wallet.isConnected && (
          <span className={`w-2 h-2 rounded-full ${
            wallet.mode === "devnet" ? "bg-yellow-400" : "bg-green-400"
          }`} />
        )}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-brand-card border border-brand-border rounded-xl shadow-xl z-50">
          {/* Mode tabs */}
          <div className="p-3 border-b border-brand-border">
            <p className="text-xs text-gray-400 mb-2">Connection Mode</p>
            <div className="flex gap-2">
              <button
                onClick={() => wallet.setMode("devnet")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  wallet.mode === "devnet"
                    ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
                    : "text-gray-400 hover:text-foreground border border-transparent"
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
                Devnet
              </button>
              <button
                onClick={() => {
                  wallet.setMode("browser");
                  if (!wallet.address) wallet.connectBrowserWallet();
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  wallet.mode === "browser"
                    ? "bg-green-500/10 text-green-400 border border-green-500/30"
                    : "text-gray-400 hover:text-foreground border border-transparent"
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                Browser
              </button>
            </div>
          </div>

          {/* Devnet accounts */}
          {wallet.mode === "devnet" && (
            <div className="p-3 max-h-60 overflow-y-auto">
              <p className="text-xs text-gray-400 mb-2">Devnet Accounts</p>
              {accounts.length === 0 ? (
                <p className="text-xs text-gray-500">
                  No devnet accounts. Run start-devnet.sh first.
                </p>
              ) : (
                <div className="space-y-1">
                  {accounts.map((acc, i) => (
                    <button
                      key={acc.address}
                      onClick={() => { select(i); setShowDetails(false); setOpen(false); }}
                      className={`w-full text-left px-2 py-1.5 rounded-lg text-xs transition-all ${
                        selectedIndex === i
                          ? "bg-brand-primary/10 text-brand-primary border border-brand-primary/20"
                          : "text-gray-300 hover:bg-brand-dark"
                      }`}
                    >
                      <span className="font-medium">{acc.label}</span>
                      <span className="ml-2 font-mono text-gray-500">
                        {shortAddr(acc.address, 4)}
                      </span>
                      {acc.zcash_shielded && (
                        <span className="ml-1 text-[10px] text-brand-blue">ZEC</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Browser wallet */}
          {wallet.mode === "browser" && (
            <div className="p-3">
              {wallet.address ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-400">Connected</span>
                    <span className="text-xs font-mono text-green-400">
                      {shortAddr(wallet.address)}
                    </span>
                  </div>
                  <button
                    onClick={() => { wallet.disconnectBrowserWallet(); setOpen(false); }}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs text-red-400 hover:bg-red-500/10 border border-red-500/20"
                  >
                    <Unplug className="h-3.5 w-3.5" />
                    Disconnect
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    onClick={() => wallet.connectBrowserWallet()}
                    className="w-full py-2 rounded-lg text-xs font-medium bg-brand-primary/10 text-brand-primary border border-brand-primary/30 hover:bg-brand-primary/20"
                  >
                    Connect Wallet
                  </button>
                  <p className="text-xs text-gray-500 text-center">
                    ArgentX or Braavos required
                  </p>
                  {wallet.error && (
                    <p className="text-xs text-red-400 text-center">{wallet.error}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Account Details (always visible when connected) ───── */}
          {wallet.isConnected && (
            <div className="border-t border-brand-border px-3 py-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-300">
                  {wallet.mode === "devnet" && devnetAccount ? devnetAccount.label : "Account"}
                </p>
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showDetails ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {showDetails ? "Less" : "More"}
                </button>
              </div>

              <CopyField label="Starknet Address" value={wallet.address ?? ""} />

              {wallet.mode === "devnet" && devnetAccount && (
                <>
                  {devnetAccount.zcash_shielded && (
                    <CopyField label="Zcash Shielded Address" value={devnetAccount.zcash_shielded} />
                  )}
                  {!devnetAccount.zcash_shielded && (
                    <div>
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Zcash Address</span>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        No Zcash address mapped for &quot;{devnetAccount.label}&quot;.
                        Only vault operators, issuer, and redeemer have mapped addresses.
                      </p>
                    </div>
                  )}
                  {showDetails && (
                    <CopyField label="Private Key (devnet only)" value={devnetAccount.private_key} />
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
