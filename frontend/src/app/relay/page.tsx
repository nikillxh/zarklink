"use client";

import {
  Radio,
  Lock,
  Layers,
  Clock,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import StatCard from "@/components/StatCard";
import { useRelayStats } from "@/hooks/useStarknet";

export default function RelayPage() {
  const { stats, loading, refetch } = useRelayStats(5000);

  const lag = stats ? stats.chainTip - stats.finalizedHeight : 0;
  const lagStatus = lag <= 6 ? "synced" : lag <= 12 ? "behind" : "critical";

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold mb-2">Zcash Relay</h1>
          <p className="text-gray-400">
            Zcash light client on Starknet — block header synchronization
          </p>
        </div>
        <button
          onClick={refetch}
          className="btn-secondary flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Chain Tip"
          value={stats ? `#${stats.chainTip.toLocaleString()}` : "—"}
          subtitle="Latest relayed block"
          icon={Radio}
          loading={loading}
        />
        <StatCard
          title="Finalized Height"
          value={stats ? `#${stats.finalizedHeight.toLocaleString()}` : "—"}
          subtitle="6-block finality depth"
          icon={Lock}
          loading={loading}
        />
        <StatCard
          title="Total Headers"
          value={stats ? stats.headerCount.toLocaleString() : "—"}
          subtitle="Headers relayed"
          icon={Layers}
          loading={loading}
        />
        <StatCard
          title="Finality Lag"
          value={stats ? `${lag} blocks` : "—"}
          subtitle="Tip − Finalized"
          icon={Clock}
          loading={loading}
          trend={lag <= 6 ? "neutral" : "down"}
        />
      </div>

      {/* Sync Status */}
      <div className="card mb-8">
        <h2 className="text-lg font-semibold mb-4">Sync Status</h2>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
          </div>
        ) : stats ? (
          <div className="space-y-6">
            {/* Status Bar */}
            <div className="flex items-center gap-3">
              {lagStatus === "synced" ? (
                <CheckCircle className="h-5 w-5 text-green-400" />
              ) : (
                <AlertTriangle className={`h-5 w-5 ${lagStatus === "behind" ? "text-yellow-400" : "text-red-400"}`} />
              )}
              <span className={`font-medium ${
                lagStatus === "synced" ? "text-green-400" :
                lagStatus === "behind" ? "text-yellow-400" : "text-red-400"
              }`}>
                {lagStatus === "synced"
                  ? "Relay is synced and healthy"
                  : lagStatus === "behind"
                    ? "Relay is slightly behind"
                    : "Relay needs attention — significant lag"}
              </span>
            </div>

            {/* Progress Bar */}
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400">Finalized</span>
                <span className="text-gray-400">Chain Tip</span>
              </div>
              <div className="h-3 bg-brand-dark rounded-full border border-brand-border overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    lagStatus === "synced" ? "bg-green-500" :
                    lagStatus === "behind" ? "bg-yellow-500" : "bg-red-500"
                  }`}
                  style={{
                    width: stats.chainTip > 0
                      ? `${Math.min(100, (stats.finalizedHeight / stats.chainTip) * 100)}%`
                      : "0%",
                  }}
                />
              </div>
              <div className="flex justify-between text-xs mt-1">
                <span className="text-gray-500 font-mono">
                  #{stats.finalizedHeight.toLocaleString()}
                </span>
                <span className="text-gray-500 font-mono">
                  #{stats.chainTip.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-brand-dark rounded-lg p-4 border border-brand-border">
                <p className="text-xs text-gray-400 mb-1">Finality Depth</p>
                <p className="text-lg font-bold">6 blocks</p>
                <p className="text-xs text-gray-500">~75 minutes</p>
              </div>
              <div className="bg-brand-dark rounded-lg p-4 border border-brand-border">
                <p className="text-xs text-gray-400 mb-1">Header Size</p>
                <p className="text-lg font-bold">1487 bytes</p>
                <p className="text-xs text-gray-500">Zcash Equihash</p>
              </div>
              <div className="bg-brand-dark rounded-lg p-4 border border-brand-border">
                <p className="text-xs text-gray-400 mb-1">Max Reorg Depth</p>
                <p className="text-lg font-bold">24 blocks</p>
                <p className="text-xs text-gray-500">Safety parameter</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <Radio className="h-12 w-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">Relay not deployed yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Deploy contracts and start the relayer service
            </p>
          </div>
        )}
      </div>

      {/* How it Works */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">How the Relay Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-brand-primary font-medium">
              <span className="h-6 w-6 rounded-full bg-brand-primary/10 border border-brand-primary/30 flex items-center justify-center text-xs">1</span>
              Header Submission
            </div>
            <p className="text-sm text-gray-400">
              Authorized relayers submit Zcash block headers to the on-chain
              relay contract. Chain continuity is verified.
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-brand-blue font-medium">
              <span className="h-6 w-6 rounded-full bg-brand-blue/10 border border-brand-blue/30 flex items-center justify-center text-xs">2</span>
              Verification
            </div>
            <p className="text-sm text-gray-400">
              Each header&apos;s prev_block_hash is checked against the stored
              chain. Reorgs up to 24 blocks are supported.
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-brand-green font-medium">
              <span className="h-6 w-6 rounded-full bg-brand-green/10 border border-brand-green/30 flex items-center justify-center text-xs">3</span>
              Finalization
            </div>
            <p className="text-sm text-gray-400">
              After 6 confirmations, blocks are considered finalized. Bridge
              operations can then verify transaction inclusion.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
