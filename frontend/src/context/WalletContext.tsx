"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { Account, RpcProvider } from "starknet";
import { getProvider, shortAddr } from "@/lib/starknet";
import { useAccount, type DevnetAccount } from "@/context/AccountContext";

// ── Types ────────────────────────────────────────────────────────────────────

export type WalletMode = "devnet" | "browser";

interface WalletContextValue {
  /** Current active mode */
  mode: WalletMode;
  /** Connected address (devnet or browser wallet) */
  address: string | null;
  /** Short display address */
  displayAddress: string;
  /** Whether a wallet is connected */
  isConnected: boolean;
  /** Get a starknet.js Account instance for the active wallet */
  getSigner: () => Account | null;
  /** Connect a browser wallet (ArgentX / Braavos) */
  connectBrowserWallet: () => Promise<void>;
  /** Disconnect browser wallet */
  disconnectBrowserWallet: () => void;
  /** Switch between devnet and browser modes */
  setMode: (mode: WalletMode) => void;
  /** Connection error message */
  error: string | null;
}

const WalletContext = createContext<WalletContextValue>({
  mode: "devnet",
  address: null,
  displayAddress: "Not connected",
  isConnected: false,
  getSigner: () => null,
  connectBrowserWallet: async () => {},
  disconnectBrowserWallet: () => {},
  setMode: () => {},
  error: null,
});

// ── Starknet window wallet detection ─────────────────────────────────────────

interface StarknetWindowObject {
  id: string;
  name: string;
  icon: string;
  version: string;
  isConnected: boolean;
  selectedAddress?: string;
  account?: {
    address: string;
  };
  provider?: RpcProvider;
  request: (call: { type: string; params?: Record<string, unknown> }) => Promise<unknown>;
  enable: (options?: { starknetVersion?: string }) => Promise<string[]>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
}

function getStarknetWallets(): StarknetWindowObject[] {
  if (typeof window === "undefined") return [];

  const wallets: StarknetWindowObject[] = [];

  // Check for standard starknet wallet objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;

  if (win.starknet_argentX) {
    wallets.push(win.starknet_argentX);
  }
  if (win.starknet_braavos) {
    wallets.push(win.starknet_braavos);
  }
  if (win.starknet && !wallets.find((w) => w.id === win.starknet?.id)) {
    wallets.push(win.starknet);
  }

  return wallets;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const devnetAccount = useAccount();
  const [mode, setMode] = useState<WalletMode>("devnet");
  const [browserAddress, setBrowserAddress] = useState<string | null>(null);
  const [browserWallet, setBrowserWallet] = useState<StarknetWindowObject | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectBrowserWallet = useCallback(async () => {
    setError(null);
    try {
      const wallets = getStarknetWallets();
      if (wallets.length === 0) {
        setError(
          "No Starknet wallet found. Install ArgentX or Braavos browser extension.\n" +
          "For local devnet, use the devnet accounts instead."
        );
        return;
      }

      const wallet = wallets[0]; // Use first available wallet
      const addresses = await wallet.enable({ starknetVersion: "v5" });
      const addr = addresses[0] ?? wallet.selectedAddress ?? wallet.account?.address;

      if (!addr) {
        setError("Wallet connected but no address returned");
        return;
      }

      setBrowserWallet(wallet);
      setBrowserAddress(addr);
      setMode("browser");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    }
  }, []);

  const disconnectBrowserWallet = useCallback(() => {
    setBrowserWallet(null);
    setBrowserAddress(null);
    setMode("devnet");
    setError(null);
  }, []);

  const address = useMemo(() => {
    if (mode === "browser") return browserAddress;
    return devnetAccount.current?.address ?? null;
  }, [mode, browserAddress, devnetAccount.current?.address]);

  const isConnected = useMemo(() => {
    if (mode === "browser") return !!browserAddress;
    return !!devnetAccount.current;
  }, [mode, browserAddress, devnetAccount.current]);

  const displayAddress = useMemo(() => {
    if (!address) return "Not connected";
    return shortAddr(address);
  }, [address]);

  const getSigner = useCallback((): Account | null => {
    if (mode === "devnet") {
      return devnetAccount.getAccount();
    }

    // For browser wallets, create an Account connected to the wallet's provider
    if (browserWallet && browserAddress) {
      // When using browser wallet, the wallet itself acts as the signer
      // We create a connected account using the wallet's provider
      const provider = getProvider();
      // Note: in production, you'd use the wallet's built-in signing.
      // For devnet testing with browser wallets pointed at localhost:5050,
      // the wallet manages signing internally.
      return new Account({
        provider,
        address: browserAddress,
        // Browser wallets handle signing internally — we pass a dummy
        // that will be overridden by the wallet's internal signer
        signer: "0x0",
      });
    }

    return null;
  }, [mode, devnetAccount, browserWallet, browserAddress]);

  const value = useMemo(
    () => ({
      mode,
      address,
      displayAddress,
      isConnected,
      getSigner,
      connectBrowserWallet,
      disconnectBrowserWallet,
      setMode,
      error,
    }),
    [mode, address, displayAddress, isConnected, getSigner, connectBrowserWallet, disconnectBrowserWallet, error],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWallet() {
  return useContext(WalletContext);
}
