"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { Account } from "starknet";
import { getProvider, shortAddr } from "@/lib/starknet";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DevnetAccount {
  address: string;
  private_key: string;
  label: string;
  /** Zcash Sapling shielded address (mapped by start-devnet.sh) */
  zcash_shielded?: string;
}

interface AccountContextValue {
  /** All available devnet accounts */
  accounts: DevnetAccount[];
  /** Currently selected account index */
  selectedIndex: number;
  /** Currently selected account (or null if none) */
  current: DevnetAccount | null;
  /** Switch to a different account by index */
  select: (index: number) => void;
  /** Get a starknet.js Account instance for the current selection */
  getAccount: () => Account | null;
  /** Short display address */
  displayAddress: string;
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  selectedIndex: 0,
  current: null,
  select: () => {},
  getAccount: () => null,
  displayAddress: "",
});

// ── Parse accounts from env var ──────────────────────────────────────────────

function loadAccountsFromEnv(): DevnetAccount[] {
  try {
    const raw = process.env.NEXT_PUBLIC_DEVNET_ACCOUNTS;
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<DevnetAccount[]>(() => loadAccountsFromEnv());
  const [selectedIndex, setSelectedIndex] = useState(0);

  // If env var parsing failed (empty), try loading from the static JSON file
  // that start-devnet.sh writes to frontend/public/devnet-accounts.json
  React.useEffect(() => {
    if (accounts.length > 0) return;
    fetch("/devnet-accounts.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setAccounts(data);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const current = accounts[selectedIndex] ?? null;

  const select = useCallback(
    (index: number) => {
      if (index >= 0 && index < accounts.length) {
        setSelectedIndex(index);
      }
    },
    [accounts.length],
  );

  const getAccount = useCallback(() => {
    if (!current) return null;
    return new Account({
      provider: getProvider(),
      address: current.address,
      signer: current.private_key,
    });
  }, [current]);

  const displayAddress = current ? shortAddr(current.address) : "No account";

  const value = useMemo(
    () => ({
      accounts,
      selectedIndex,
      current,
      select,
      getAccount,
      displayAddress,
    }),
    [accounts, selectedIndex, current, select, getAccount, displayAddress],
  );

  return (
    <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAccount() {
  return useContext(AccountContext);
}
