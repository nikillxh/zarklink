"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import { isTestnet, isDevnet } from "@/lib/starknet";

// ============================================================================
// Zcash Account Association — Client-side (localStorage)
// ============================================================================
//
// Maps Starknet addresses → Zcash shielded addresses.
// On devnet, the mapping comes from start-devnet.sh (DevnetAccount.zcash_shielded).
// On testnet, users manually associate their own Zcash testnet address.
// On mainnet, same as testnet but with mainnet z-addresses.

// ── Types ────────────────────────────────────────────────────────────────────

export interface ZcashAssociation {
  /** Starknet address (hex, lowercase) */
  starknetAddress: string;
  /** Zcash shielded address (z-address) */
  zcashAddress: string;
  /** Optional label/alias */
  label?: string;
  /** When this association was created */
  createdAt: number;
}

interface ZcashAccountContextValue {
  /** All associations for the current network */
  associations: ZcashAssociation[];
  /** Get the Zcash address for a given Starknet address */
  getZcashAddress: (starknetAddress: string) => string | null;
  /** Associate a Zcash address with a Starknet address */
  associate: (starknetAddress: string, zcashAddress: string, label?: string) => void;
  /** Remove an association */
  removeAssociation: (starknetAddress: string) => void;
  /** Clear all associations */
  clearAll: () => void;
}

const ZcashAccountContext = createContext<ZcashAccountContextValue>({
  associations: [],
  getZcashAddress: () => null,
  associate: () => {},
  removeAssociation: () => {},
  clearAll: () => {},
});

// ── localStorage key ─────────────────────────────────────────────────────────

const STORAGE_KEY = "zarklink-zcash-associations";

function storageKey(): string {
  // Separate storage per network to avoid mixing devnet/testnet/mainnet addresses
  const network = isTestnet ? "testnet" : isDevnet ? "devnet" : "mainnet";
  return `${STORAGE_KEY}-${network}`;
}

function loadAssociations(): ZcashAssociation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAssociations(associations: ZcashAssociation[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(), JSON.stringify(associations));
  } catch {
    // Storage full or disabled — silently fail
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function ZcashAccountProvider({ children }: { children: ReactNode }) {
  const [associations, setAssociations] = useState<ZcashAssociation[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    setAssociations(loadAssociations());
  }, []);

  const getZcashAddress = useCallback(
    (starknetAddress: string): string | null => {
      const normalized = starknetAddress.toLowerCase();
      const found = associations.find(
        (a) => a.starknetAddress.toLowerCase() === normalized,
      );
      return found?.zcashAddress ?? null;
    },
    [associations],
  );

  const associate = useCallback(
    (starknetAddress: string, zcashAddress: string, label?: string) => {
      const normalized = starknetAddress.toLowerCase();
      setAssociations((prev) => {
        // Replace existing or add new
        const filtered = prev.filter(
          (a) => a.starknetAddress.toLowerCase() !== normalized,
        );
        const updated = [
          ...filtered,
          {
            starknetAddress: normalized,
            zcashAddress,
            label,
            createdAt: Date.now(),
          },
        ];
        saveAssociations(updated);
        return updated;
      });
    },
    [],
  );

  const removeAssociation = useCallback(
    (starknetAddress: string) => {
      const normalized = starknetAddress.toLowerCase();
      setAssociations((prev) => {
        const updated = prev.filter(
          (a) => a.starknetAddress.toLowerCase() !== normalized,
        );
        saveAssociations(updated);
        return updated;
      });
    },
    [],
  );

  const clearAll = useCallback(() => {
    setAssociations([]);
    saveAssociations([]);
  }, []);

  const value = useMemo(
    () => ({
      associations,
      getZcashAddress,
      associate,
      removeAssociation,
      clearAll,
    }),
    [associations, getZcashAddress, associate, removeAssociation, clearAll],
  );

  return (
    <ZcashAccountContext.Provider value={value}>
      {children}
    </ZcashAccountContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useZcashAccount() {
  return useContext(ZcashAccountContext);
}
