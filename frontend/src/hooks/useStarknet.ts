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
}

export function usePoolStats() {
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const provider = getProvider();
        if (!starknetConfig.poolAddress) return;
        const pool = new Contract({ abi: POOL_ABI, address: starknetConfig.poolAddress, providerOrAccount: provider });
        const [size, cap] = await Promise.all([
          pool.call("get_pool_size", []),
          pool.call("get_pool_capacity", []),
        ]);
        setStats({
          poolSize: Number(size),
          capacity: BigInt(String(cap ?? 0)),
        });
      } catch {
        // Not deployed
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { stats, loading };
}

// ── Vault list hook ──────────────────────────────────────────────────────────

export interface VaultInfo {
  id: number;
  owner: string;
  collateral: bigint;
  status: number;
  zcashAddress: string;
  collateralRatio: number;
  totalIssued: bigint;
  totalRedeemed: bigint;
}

export function useVaultList() {
  const [vaults, setVaults] = useState<VaultInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const provider = getProvider();
        if (!starknetConfig.registryAddress) {
          setLoading(false);
          return;
        }
        const registry = new Contract({ abi: REGISTRY_ABI, address: starknetConfig.registryAddress, providerOrAccount: provider });
        const count = Number(await registry.call("get_vault_count", []));
        const list: VaultInfo[] = [];

        for (let i = 1; i <= count; i++) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const info: any = await registry.call("get_vault_info", [i]);
            list.push({
              id: i,
              owner: String(info[0] ?? ""),
              collateral: BigInt(String(info[1] ?? 0)),
              status: Number(info[2] ?? 0),
              zcashAddress: String(info[3] ?? ""),
              collateralRatio: Number(info[4] ?? 0),
              totalIssued: BigInt(String(info[5] ?? 0)),
              totalRedeemed: BigInt(String(info[6] ?? 0)),
            });
          } catch {
            // Skip errored vaults
          }
        }
        setVaults(list);
      } catch {
        // Not deployed
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return { vaults, loading };
}

// ── wZEC balance hook ────────────────────────────────────────────────────────

export function useWzecBalance(address: string) {
  const [balance, setBalance] = useState<bigint>(0n);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
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
    }
    load();
  }, [address]);

  return { balance, loading };
}
