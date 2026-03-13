"use client";

import { useState } from "react";
import {
  Shield,
  Plus,
  ArrowUpCircle,
  ArrowDownCircle,
  Loader2,
  Users,
} from "lucide-react";
import StatCard from "@/components/StatCard";
import { useVaultList, usePoolStats } from "@/hooks/useStarknet";
import { useAccount } from "@/context/AccountContext";
import { formatZec, shortAddr, vaultStatusLabel, zcashCoinName } from "@/lib/starknet";

export default function VaultsPage() {
  const { vaults, loading: vaultsLoading, refetch: refetchVaults } = useVaultList(15000);
  const { stats: pool } = usePoolStats(15000);
  const { current: account, getAccount } = useAccount();
  const [showRegister, setShowRegister] = useState(false);
  const [collateral, setCollateral] = useState("");
  const [zcashAddr, setZcashAddr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const totalCollateral = vaults.reduce((sum, v) => sum + v.collateral, 0n);
  // Cairo enum: 0=Inactive, 1=Active, 2=Locked, 3=Suspended, 4=Liquidated
  const activeVaults = vaults.filter((v) => v.status === 1);

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const signer = getAccount();
      if (!signer) {
        alert("No wallet connected. Connect your wallet from the navbar.");
        return;
      }
      // Simulated — would call vault_registry.register_vault with selected account
      await new Promise((r) => setTimeout(r, 2000));
      setShowRegister(false);
      setCollateral("");
      setZcashAddr("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-3xl font-bold mb-2">Vaults</h1>
          <p className="text-gray-400">
            Register, manage collateral, and join the vault liquidity pool
          </p>
        </div>
        <button
          onClick={() => setShowRegister(!showRegister)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Register Vault
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total Vaults"
          value={vaultsLoading ? "—" : String(vaults.length)}
          subtitle={`${activeVaults.length} active`}
          icon={Shield}
          loading={vaultsLoading}
        />
        <StatCard
          title="Total Collateral"
          value={vaultsLoading ? "—" : formatZec(totalCollateral)}
          icon={ArrowUpCircle}
          loading={vaultsLoading}
        />
        <StatCard
          title="Pool Size"
          value={pool ? `${pool.poolSize} vaults` : "—"}
          icon={Users}
        />
        <StatCard
          title="Total Deposited"
          value={pool ? formatZec(pool.totalDeposited) : "—"}
          subtitle={pool ? `${formatZec(pool.capacity)} available` : ""}
          icon={ArrowDownCircle}
        />
      </div>

      {/* Register Form */}
      {showRegister && (
        <div className="card mb-8">
          <h2 className="text-lg font-semibold mb-4">Register New Vault</h2>
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="text-sm text-gray-400 mb-1 block">
                Collateral Amount ({zcashCoinName()})
              </label>
              <input
                type="number"
                step="0.00000001"
                min="1"
                placeholder="1.00000000"
                value={collateral}
                onChange={(e) => setCollateral(e.target.value)}
                className="input-field w-full font-mono"
              />
              <p className="text-xs text-gray-500 mt-1">
                Minimum 1 {zcashCoinName()}. Collateral ratio: 150%
              </p>
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-1 block">
                Zcash Address
              </label>
              <input
                type="text"
                placeholder="t1... or zs1..."
                value={zcashAddr}
                onChange={(e) => setZcashAddr(e.target.value)}
                className="input-field w-full font-mono text-sm"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={submitting || !collateral || !zcashAddr}
                className="btn-primary flex items-center gap-2"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Register
              </button>
              <button
                type="button"
                onClick={() => setShowRegister(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Vault List */}
      <div className="card">
        <h2 className="text-lg font-semibold mb-4">Registered Vaults</h2>
        {vaultsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-brand-primary" />
          </div>
        ) : vaults.length === 0 ? (
          <div className="text-center py-12">
            <Shield className="h-12 w-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">No vaults registered yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Be the first to register a vault and earn bridge fees
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-border">
                  <th className="text-left py-3 px-2 text-gray-400 font-medium">ID</th>
                  <th className="text-left py-3 px-2 text-gray-400 font-medium">Owner</th>
                  <th className="text-left py-3 px-2 text-gray-400 font-medium">Status</th>
                  <th className="text-right py-3 px-2 text-gray-400 font-medium">Collateral</th>
                  <th className="text-right py-3 px-2 text-gray-400 font-medium">Pool %</th>
                  <th className="text-right py-3 px-2 text-gray-400 font-medium">Issued</th>
                  <th className="text-right py-3 px-2 text-gray-400 font-medium">Redeemed</th>
                </tr>
              </thead>
              <tbody>
                {vaults.map((v) => {
                  const { label, color } = vaultStatusLabel(v.status);
                  return (
                    <tr
                      key={v.id}
                      className="border-b border-brand-border/50 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="py-3 px-2 font-mono text-brand-primary">
                        #{v.id}
                      </td>
                      <td className="py-3 px-2 font-mono text-gray-300">
                        {shortAddr(v.owner)}
                      </td>
                      <td className="py-3 px-2">
                        <span className={color}>{label}</span>
                      </td>
                      <td className="py-3 px-2 text-right font-mono">
                        {formatZec(v.collateral)}
                      </td>
                      <td className="py-3 px-2 text-right">
                        {v.poolShare > 0 
                          ? `${v.poolShare.toFixed(2)}%` 
                          : "—"}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-gray-400">
                        {formatZec(v.totalIssued)}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-gray-400">
                        {formatZec(v.totalRedeemed)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
