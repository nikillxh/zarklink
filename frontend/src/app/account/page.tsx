"use client";

import { useState, useEffect } from "react";
import {
  UserCircle,
  Plus,
  Trash2,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Info,
  Link as LinkIcon,
} from "lucide-react";
import { useWallet } from "@/context/WalletContext";
import { useAccount } from "@/context/AccountContext";
import { useZcashAccount, type ZcashAssociation } from "@/context/ZcashAccountContext";
import {
  shortAddr,
  isTestnet,
  isDevnet,
  zcashCoinName,
  wrappedCoinName,
} from "@/lib/starknet";

// ── Clipboard helper ─────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-white/5 hover:bg-white/10 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-gray-400" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Zcash address validation ────────────────────────────────────────────────

function isValidZcashAddress(addr: string): boolean {
  // Shielded (Sapling): starts with "zs1" and is ~78 chars
  // Transparent: starts with "t1" (mainnet) or "tm" (testnet) and is 34-35 chars
  // Testnet shielded: starts with "ztestsapling1" and is ~78 chars
  if (!addr) return false;
  if (isTestnet) {
    return (
      addr.startsWith("ztestsapling1") ||
      addr.startsWith("zs1") ||
      addr.startsWith("tm") ||
      addr.startsWith("t1")
    );
  }
  return addr.startsWith("zs1") || addr.startsWith("t1") || addr.startsWith("t3");
}

// ── Account Page ─────────────────────────────────────────────────────────────

export default function AccountPage() {
  const wallet = useWallet();
  const { current: devnetAccount } = useAccount();
  const {
    associations,
    getZcashAddress,
    associate,
    removeAssociation,
  } = useZcashAccount();

  const [newZcashAddr, setNewZcashAddr] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Active Starknet address (browser wallet or devnet account)
  const activeAddress = wallet.address ?? devnetAccount?.address ?? null;

  // Current Zcash association for the active address
  const currentZcash = activeAddress ? getZcashAddress(activeAddress) : null;

  // On devnet, also show the devnet-mapped Zcash address if available
  const devnetZcash = devnetAccount?.zcash_shielded ?? null;

  // Clear messages after timeout
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 4000);
      return () => clearTimeout(t);
    }
  }, [success]);

  function handleAssociate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!activeAddress) {
      setError("Connect your Starknet wallet first.");
      return;
    }

    if (!newZcashAddr.trim()) {
      setError("Enter a Zcash address.");
      return;
    }

    if (!isValidZcashAddress(newZcashAddr.trim())) {
      setError(
        isTestnet
          ? "Invalid Zcash testnet address. Expected ztestsapling1... or tm..."
          : "Invalid Zcash address. Expected zs1... or t1..."
      );
      return;
    }

    associate(activeAddress, newZcashAddr.trim(), newLabel.trim() || undefined);
    setSuccess(`Associated ${shortAddr(newZcashAddr.trim())} with ${shortAddr(activeAddress)}`);
    setNewZcashAddr("");
    setNewLabel("");
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-2">Account</h1>
        <p className="text-gray-400">
          Associate your Zcash address with your Starknet account
        </p>
      </div>

      {/* Active Account Banner */}
      <div className="card mb-6 p-4">
        <div className="flex items-center gap-3 mb-3">
          <UserCircle className="h-5 w-5 text-brand-primary" />
          <span className="text-sm font-medium">Active Account</span>
        </div>
        {activeAddress ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Starknet:</span>
              <code className="text-xs font-mono text-gray-200 break-all">{activeAddress}</code>
              <CopyBtn text={activeAddress} />
            </div>

            {/* Show current Zcash association */}
            {currentZcash ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{zcashCoinName()} Address:</span>
                <code className="text-xs font-mono text-brand-blue break-all">{currentZcash}</code>
                <CopyBtn text={currentZcash} />
              </div>
            ) : devnetZcash ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{zcashCoinName()} (devnet):</span>
                <code className="text-xs font-mono text-brand-blue break-all">{devnetZcash}</code>
                <CopyBtn text={devnetZcash} />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-yellow-500/80">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="text-xs">
                  No {zcashCoinName()} address associated. Add one below to use the bridge.
                </span>
              </div>
            )}

            {/* Mode indicator */}
            <div className="text-[10px] text-gray-500">
              {wallet.mode === "devnet"
                ? `Devnet mode — ${devnetAccount?.label ?? "Unknown account"}`
                : `Browser wallet — ${wallet.walletKind !== "unknown" ? wallet.walletKind : "connected"}`}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            Connect your wallet from the navbar to manage Zcash associations.
          </p>
        )}
      </div>

      {/* TAZ Faucet / Testnet Info */}
      {isTestnet && (
        <div className="card mb-6 p-4 border-brand-blue/30">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-brand-blue mt-0.5 shrink-0" />
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-brand-blue">Zcash Testnet (TAZ)</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                On testnet, the bridge uses TAZ (Zcash testnet coins) instead of ZEC.
                You need a Zcash testnet wallet and some TAZ to use the bridge.
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <a
                  href="https://faucet.zecpages.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand-blue/10 text-brand-blue border border-brand-blue/30 hover:bg-brand-blue/20 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  TAZ Faucet (zecpages)
                </a>
                <a
                  href="https://zcash.readthedocs.io/en/latest/rtd_pages/testnet_guide.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-gray-300 border border-brand-border hover:bg-white/10 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  Zcash Testnet Guide
                </a>
                <a
                  href="https://z.cash/wallets/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 text-gray-300 border border-brand-border hover:bg-white/10 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  Zcash Wallets
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Associate Form */}
      {activeAddress && (
        <div className="card mb-6 p-4">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <LinkIcon className="h-5 w-5 text-brand-primary" />
            Associate {zcashCoinName()} Address
          </h2>
          <form onSubmit={handleAssociate} className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 mb-1 block">
                {zcashCoinName()} Shielded Address
              </label>
              <input
                type="text"
                placeholder={isTestnet ? "ztestsapling1... or tm..." : "zs1... or t1..."}
                value={newZcashAddr}
                onChange={(e) => setNewZcashAddr(e.target.value)}
                className="input-field w-full font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">
                {isTestnet
                  ? "Enter your Zcash testnet address. Get one from a Zcash wallet that supports testnet."
                  : "Enter your Zcash shielded address (zs1...) for maximum privacy, or transparent (t1...)."}
              </p>
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-1 block">
                Label (optional)
              </label>
              <input
                type="text"
                placeholder="e.g. My Zashi wallet"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                className="input-field w-full text-sm"
              />
            </div>

            {error && (
              <p className="text-xs text-red-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {error}
              </p>
            )}
            {success && (
              <p className="text-xs text-green-400 flex items-center gap-1">
                <Check className="h-3 w-3" />
                {success}
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                {currentZcash ? "Update Association" : "Associate Address"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Existing Associations */}
      <div className="card p-4">
        <h2 className="text-lg font-semibold mb-4">Associated Accounts</h2>
        {associations.length === 0 ? (
          <div className="text-center py-8">
            <UserCircle className="h-12 w-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">No associations yet</p>
            <p className="text-gray-500 text-xs mt-1">
              Connect your wallet and associate a {zcashCoinName()} address above
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {associations.map((a) => (
              <AssociationCard
                key={a.starknetAddress}
                association={a}
                isActive={activeAddress?.toLowerCase() === a.starknetAddress.toLowerCase()}
                onRemove={() => removeAssociation(a.starknetAddress)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Storage Info */}
      <div className="mt-4 flex items-start gap-2 text-xs text-gray-500">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <p>
          Associations are stored in your browser&apos;s localStorage and are
          {isTestnet ? " separated by network (testnet)" : isDevnet ? " separated by network (devnet)" : ""}.
          They are not shared across devices or browsers. Clearing browser data will remove associations.
        </p>
      </div>
    </div>
  );
}

// ── Association Card ─────────────────────────────────────────────────────────

function AssociationCard({
  association,
  isActive,
  onRemove,
}: {
  association: ZcashAssociation;
  isActive: boolean;
  onRemove: () => void;
}) {
  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
        isActive
          ? "bg-brand-primary/5 border-brand-primary/30"
          : "bg-brand-dark border-brand-border"
      }`}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        {association.label && (
          <p className="text-xs font-medium text-gray-200">{association.label}</p>
        )}
        <div>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">Starknet</span>
          <p className="font-mono text-[11px] text-gray-300 break-all">{association.starknetAddress}</p>
        </div>
        <div>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider">{zcashCoinName()}</span>
          <p className="font-mono text-[11px] text-brand-blue break-all">{association.zcashAddress}</p>
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <span className="text-[10px] font-medium text-brand-primary bg-brand-primary/10 px-1.5 py-0.5 rounded">
              Active
            </span>
          )}
          <span className="text-[10px] text-gray-600">
            {new Date(association.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
      <button
        onClick={onRemove}
        className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 transition-colors"
        title="Remove association"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
