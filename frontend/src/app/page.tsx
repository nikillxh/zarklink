"use client";

import Link from "next/link";
import {
  ArrowLeftRight,
  Shield,
  Radio,
  Zap,
  Lock,
  TrendingUp,
  Layers,
  Eye,
} from "lucide-react";
import StatCard from "@/components/StatCard";
import { useBridgeStats, useRelayStats, usePoolStats, useWzecBalance, useZcashBalance } from "@/hooks/useStarknet";
import { useAccount } from "@/context/AccountContext";
import { useWallet } from "@/context/WalletContext";
import { useZcashAccount } from "@/context/ZcashAccountContext";
import { formatZec, formatWrappedZec, shortAddr, zcashCoinName, wrappedCoinName } from "@/lib/starknet";

export default function Dashboard() {
  const { stats: bridge, loading: bridgeLoading } = useBridgeStats();
  const { stats: relay, loading: relayLoading } = useRelayStats();
  const { stats: pool, loading: poolLoading } = usePoolStats();
  const { current: account } = useAccount();
  const wallet = useWallet();
  const { getZcashAddress } = useZcashAccount();

  // Resolve the active Starknet address (devnet account or browser wallet)
  const activeAddress = wallet.address ?? account?.address ?? "";

  // Resolve the Zcash address: devnet uses mapped address, testnet/mainnet uses association
  const associatedZcash = activeAddress ? getZcashAddress(activeAddress) : null;
  const zcashAddr = account?.zcash_shielded ?? associatedZcash ?? "";

  const { balance: wzecBalance, loading: wzecLoading } = useWzecBalance(activeAddress, 15000);
  const { balance: zecBalance, loading: zecLoading } = useZcashBalance(zcashAddr, 15000);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      {/* Hero */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center gap-2 bg-brand-primary/10 border border-brand-primary/30 rounded-full px-4 py-1.5 mb-6">
          <Zap className="h-3.5 w-3.5 text-brand-primary" />
          <span className="text-xs font-medium text-brand-primary">
            Privacy-Preserving Bridge Protocol
          </span>
        </div>
        <h1 className="text-5xl font-bold mb-4">
          <span className="text-gradient">Zcash</span>
          <span className="text-gray-500 mx-3">↔</span>
          <span className="text-gradient">Starknet</span>
        </h1>
        <p className="text-gray-400 text-lg max-w-2xl mx-auto">
          Bridge {zcashCoinName()} to {wrappedCoinName()} on Starknet with STARK proof verification,
          vault pool aggregation, and privacy-preserving amount splitting.
        </p>
      </div>

      {/* Account Banner */}
      {(account || wallet.isConnected) && (
        <div className="flex items-center gap-4 mb-6 p-3 rounded-xl bg-brand-card border border-brand-border">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-gradient-to-br from-brand-primary to-brand-blue flex items-center justify-center text-[10px] font-bold text-white">
              {(account?.label ?? wallet.walletKind).charAt(0).toUpperCase()}
            </div>
            <div>
              <span className="text-xs text-gray-400">
                {account?.label ?? (wallet.walletKind !== "unknown" ? wallet.walletKind : "Wallet")}
              </span>
              <span className="font-mono text-xs text-gray-500 ml-2">{shortAddr(activeAddress)}</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-6">
            {/* ZEC / TAZ Balance */}
            <div className="text-right">
              <span className="text-xs text-gray-400">{zcashCoinName()} Balance</span>
              <p className="font-mono text-sm text-foreground">
                {!zcashAddr ? "—" : zecLoading ? "..." : `${zecBalance} ${zcashCoinName()}`}
              </p>
            </div>
            {/* wZEC / wTAZ Balance */}
            <div className="text-right">
              <span className="text-xs text-gray-400">{wrappedCoinName()} Balance</span>
              <p className="font-mono text-sm text-foreground">
                {wzecLoading ? "..." : formatWrappedZec(wzecBalance)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
        <StatCard
          title="Relay Chain Tip"
          value={relay ? `#${relay.chainTip.toLocaleString()}` : "—"}
          subtitle={relay ? `${relay.headerCount} total headers` : undefined}
          icon={Radio}
          loading={relayLoading}
          trend="neutral"
        />
        <StatCard
          title="Finalized Height"
          value={relay ? `#${relay.finalizedHeight.toLocaleString()}` : "—"}
          subtitle="6-block finality"
          icon={Lock}
          loading={relayLoading}
        />
        <StatCard
          title="Vault Pool"
          value={pool ? `${pool.poolSize} vaults` : "—"}
          subtitle={pool ? `Capacity: ${formatZec(pool.capacity)}` : undefined}
          icon={Shield}
          loading={poolLoading}
          trend="up"
        />
        <StatCard
          title="Bridge Fee"
          value={bridge ? `${(bridge.feeRate / 100).toFixed(2)}%` : "—"}
          subtitle={bridge ? `Warranty: ${formatZec(bridge.warrantyAmount)}` : undefined}
          icon={TrendingUp}
          loading={bridgeLoading}
        />
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <Link href="/bridge" className="card-hover group cursor-pointer">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-primary/10 border border-brand-primary/20 group-hover:border-brand-primary/40 transition-colors">
              <ArrowLeftRight className="h-5 w-5 text-brand-primary" />
            </div>
            <h3 className="text-lg font-semibold">Bridge</h3>
          </div>
          <p className="text-gray-400 text-sm leading-relaxed">
            Issue {wrappedCoinName()} by locking {zcashCoinName()} on mainchain, or redeem {zcashCoinName()} by burning
            {wrappedCoinName()}. Privacy-preserving splitting across multiple vaults.
          </p>
          <div className="mt-4 flex items-center gap-2 text-brand-primary text-sm font-medium">
            <span>Start bridging</span>
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </Link>

        <Link href="/vaults" className="card-hover group cursor-pointer">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-blue/10 border border-brand-blue/20 group-hover:border-brand-blue/40 transition-colors">
              <Shield className="h-5 w-5 text-brand-blue" />
            </div>
            <h3 className="text-lg font-semibold">Vaults</h3>
          </div>
          <p className="text-gray-400 text-sm leading-relaxed">
            Register as a vault operator, deposit collateral, and join the
            liquidity pool. Earn fees by processing bridge requests.
          </p>
          <div className="mt-4 flex items-center gap-2 text-brand-blue text-sm font-medium">
            <span>Manage vaults</span>
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </Link>

        <Link href="/relay" className="card-hover group cursor-pointer">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-green/10 border border-brand-green/20 group-hover:border-brand-green/40 transition-colors">
              <Radio className="h-5 w-5 text-brand-green" />
            </div>
            <h3 className="text-lg font-semibold">Relay</h3>
          </div>
          <p className="text-gray-400 text-sm leading-relaxed">
            Monitor the Zcash light client on Starknet. Track block headers,
            finality depth, and relayer synchronization status.
          </p>
          <div className="mt-4 flex items-center gap-2 text-brand-green text-sm font-medium">
            <span>View relay</span>
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </Link>
      </div>

      {/* Architecture Overview */}
      <div className="card">
        <h2 className="text-xl font-bold mb-6">Protocol Architecture</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Eye, title: "STARK Proofs", desc: "Zero-knowledge verification with no trusted setup" },
            { icon: Layers, title: "Vault Pool", desc: "VRF-based vault assignment for privacy" },
            { icon: Lock, title: "Collateral", desc: "Over-collateralized vaults with auto-liquidation" },
            { icon: Zap, title: "Amount Splitting", desc: "Power-of-2 decomposition across k vaults" },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="p-4 rounded-lg bg-brand-dark border border-brand-border">
              <Icon className="h-5 w-5 text-brand-primary mb-2" />
              <h4 className="font-medium text-sm mb-1">{title}</h4>
              <p className="text-xs text-gray-500">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
