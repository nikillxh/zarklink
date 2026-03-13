"use client";

import { useState, useEffect, useCallback } from "react";
import { Contract } from "starknet";
import {
  config as starknetConfig,
  getProvider,
  BRIDGE_ABI,
  REGISTRY_ABI,
  RELAY_ABI,
  POOL_ABI,
  WZEC_ABI,
} from "@/lib/starknet";

// ── Generic contract call hook ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AbiEntry = Record<string, unknown>;

export function useContractCall<T>(
  address: string,
  abi: AbiEntry[],
  method: string,
  args: (string | number | bigint)[] = [],
  refreshInterval = 0,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!address) {
      setLoading(false);
      return;
    }
    try {
      const provider = getProvider();
      const contract = new Contract({ abi: abi, address: address, providerOrAccount: provider });
      const result = await contract.call(method, args);
      setData(result as T);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Contract call failed");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, method, JSON.stringify(args)]);

  useEffect(() => {
    fetch();
    if (refreshInterval > 0) {
      const id = setInterval(fetch, refreshInterval);
      return () => clearInterval(id);
    }
  }, [fetch, refreshInterval]);

  return { data, loading, error, refetch: fetch };
}

// ── Bridge stats hook ────────────────────────────────────────────────────────

export interface BridgeStats {
  feeRate: number;
  warrantyAmount: bigint;
}

export function useBridgeStats() {
  const [stats, setStats] = useState<BridgeStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const provider = getProvider();
        if (!starknetConfig.bridgeAddress) {
          setLoading(false);
          return;
        }
        const bridge = new Contract({ abi: BRIDGE_ABI, address: starknetConfig.bridgeAddress, providerOrAccount: provider });
        const [feeRate, warranty] = await Promise.all([
          bridge.call("get_fee_rate", []),
          bridge.call("get_warranty_amount", []),
        ]);
        setStats({
          feeRate: Number(feeRate),
          warrantyAmount: BigInt(String(warranty ?? 0)),
        });
      } catch {
        // Contract not deployed yet
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { stats, loading };
}

// ── Relay stats hook ─────────────────────────────────────────────────────────

export interface RelayStats {
  chainTip: number;
  finalizedHeight: number;
  headerCount: number;
}

export function useRelayStats(refreshMs = 10000) {
  const [stats, setStats] = useState<RelayStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const provider = getProvider();
      if (!starknetConfig.relayAddress) return;
      const relay = new Contract({ abi: RELAY_ABI, address: starknetConfig.relayAddress, providerOrAccount: provider });
      const [tip, fin, count] = await Promise.all([
        relay.call("get_chain_tip", []),
        relay.call("get_finalized_height", []),
        relay.call("get_header_count", []),
      ]);
      setStats({
        chainTip: Number(tip),
        finalizedHeight: Number(fin),
        headerCount: Number(count),
      });
    } catch {
      // Not deployed
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, refreshMs);
    return () => clearInterval(id);
  }, [fetch, refreshMs]);

  return { stats, loading, refetch: fetch };
}

// ── Pool stats hook ──────────────────────────────────────────────────────────

export interface PoolStats {
  poolSize: number;
  capacity: bigint;
  totalDeposited: bigint;
}

export function usePoolStats(refreshMs = 0) {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const provider = getProvider();
      if (!starknetConfig.poolAddress) return;
      const pool = new Contract({ abi: POOL_ABI, address: starknetConfig.poolAddress, providerOrAccount: provider });
      const [size, cap, deposited] = await Promise.all([
        pool.call("get_active_vault_count", []),
        pool.call("get_pool_capacity", []),
        pool.call("get_total_deposited", []),
      ]);
      setStats({
        poolSize: Number(size),
        capacity: BigInt(String(cap ?? 0)),
        totalDeposited: BigInt(String(deposited ?? 0)),
      });
    } catch {
      // Not deployed
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    if (refreshMs > 0) {
      const id = setInterval(fetchStats, refreshMs);
      return () => clearInterval(id);
    }
  }, [fetchStats, refreshMs]);

  return { stats, loading, refetch: fetchStats };
}

// ── Vault list hook ──────────────────────────────────────────────────────────

export interface VaultInfo {
  id: number;
  owner: string;
  collateral: bigint;
  status: number;
  zcashAddress: string;
  /** Pool share: this vault's collateral as a percentage of total collateral (0-100, 2 decimal precision) */
  poolShare: number;
  totalIssued: bigint;
  totalRedeemed: bigint;
}

export function useVaultList(refreshMs = 0) {
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchVaults = useCallback(async () => {
    try {
      const provider = getProvider();
      if (!starknetConfig.registryAddress) {
        setLoading(false);
        return;
      }
      const registry = new Contract({ abi: REGISTRY_ABI, address: starknetConfig.registryAddress, providerOrAccount: provider });
      const count = Number(await registry.call("get_vault_count", []));
      const list: VaultInfo[] = [];

      // Vault IDs are 0-indexed on-chain (0 .. count-1)
      for (let i = 0; i < count; i++) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const info: any = await registry.call("get_vault", [i]);
          const collateral = BigInt(String(info[3] ?? 0));
          const totalIssued = BigInt(String(info[8] ?? 0));
          const totalRedeemed = BigInt(String(info[9] ?? 0));
          
          list.push({
            id: i + 1, // Display as 1-based (on-chain vault_id is 0-based)
            owner: String(info[0] ?? ""),
            collateral,
            status: Number(info[4] ?? 0),
            zcashAddress: String(info[1] ?? ""),
            poolShare: 0, // Computed below after all vaults are loaded
            totalIssued,
            totalRedeemed,
          });
        } catch {
          // Skip errored vaults
        }
      }

      // Compute pool share percentages: each vault's collateral / total collateral * 100
      // Uses precise rounding so that all percentages sum to exactly 100.00%
      const totalCollateral = list.reduce((sum, v) => sum + v.collateral, 0n);
      if (totalCollateral > 0n) {
        // Step 1: Compute raw percentages
        const rawShares = list.map(v => 
          Number(v.collateral) / Number(totalCollateral) * 100
        );
        // Step 2: Floor to 2 decimals, track remainders
        const floored = rawShares.map(s => Math.floor(s * 100) / 100);
        const remainders = rawShares.map((s, i) => ({
          index: i,
          remainder: s - floored[i],
        }));
        // Step 3: Distribute the rounding gap to reach exactly 100.00%
        const flooredSum = floored.reduce((a, b) => a + b, 0);
        // Gap in units of 0.01 (cents of a percent)
        let gap = Math.round((100 - flooredSum) * 100);
        // Sort by largest remainder first — give extra 0.01% to those
        remainders.sort((a, b) => b.remainder - a.remainder);
        for (const r of remainders) {
          if (gap <= 0) break;
          floored[r.index] = Math.round((floored[r.index] + 0.01) * 100) / 100;
          gap--;
        }
        // Step 4: Assign final percentages
        list.forEach((v, i) => { v.poolShare = floored[i]; });
      }

      setVaults(list);
    } catch {
      // Not deployed
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVaults();
    if (refreshMs > 0) {
      const id = setInterval(fetchVaults, refreshMs);
      return () => clearInterval(id);
    }
  }, [fetchVaults, refreshMs]);

  return { vaults, loading, refetch: fetchVaults };
}

// ── wZEC balance hook ────────────────────────────────────────────────────────

export function useWzecBalance(address: string, refreshMs = 0) {
  const [balance, setBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  const fetchBalance = useCallback(async () => {
    if (!address || !starknetConfig.wzecAddress) {
      setLoading(false);
      return;
    }
    try {
      const provider = getProvider();
      const wzec = new Contract({ abi: WZEC_ABI, address: starknetConfig.wzecAddress, providerOrAccount: provider });
      const bal = await wzec.call("balance_of", [address]);
      setBalance(BigInt(String(bal ?? 0)));
    } catch {
      // Not deployed
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchBalance();
    if (refreshMs > 0) {
      const id = setInterval(fetchBalance, refreshMs);
      return () => clearInterval(id);
    }
  }, [fetchBalance, refreshMs]);

  return { balance, loading, refetch: fetchBalance };
}

// ── Zcash balance hook (via API route) ───────────────────────────────────────

export function useZcashBalance(zcashAddress: string, refreshMs = 0) {
  const [balance, setBalance] = useState<string>("—");
  const [loading, setLoading] = useState(true);

  const fetchBalance = useCallback(async () => {
    if (!zcashAddress) {
      setBalance("—");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/zcash-balance?address=${encodeURIComponent(zcashAddress)}`);
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance ?? "—");
      }
    } catch {
      // API not available
    } finally {
      setLoading(false);
    }
  }, [zcashAddress]);

  useEffect(() => {
    fetchBalance();
    if (refreshMs > 0) {
      const id = setInterval(fetchBalance, refreshMs);
      return () => clearInterval(id);
    }
  }, [fetchBalance, refreshMs]);

  return { balance, loading, refetch: fetchBalance };
}
