"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import { Account, RpcProvider } from "starknet";
import { getProvider, shortAddr, isDevnet, isTestnet } from "@/lib/starknet";
import { useAccount, type DevnetAccount } from "@/context/AccountContext";

// ── Types ────────────────────────────────────────────────────────────────────

export type WalletMode = "devnet" | "browser";

/** Wallet kind detected by starknetkit (or manual detection) */
export type WalletKind = "argentX" | "braavos" | "metamask" | "unknown";

interface WalletContextValue {
  /** Current active mode */
  mode: WalletMode;
  /** Connected address (devnet or browser wallet) */
  address: string | null;
  /** Short display address */
  displayAddress: string;
  /** Whether a wallet is connected */
  isConnected: boolean;
  /** Which wallet is connected (for display) */
  walletKind: WalletKind;
  /** Get a starknet.js Account instance for the active wallet */
  getSigner: () => Account | null;
  /** Connect a browser wallet (ArgentX / Braavos / MetaMask Snap) */
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
  walletKind: "unknown",
  getSigner: () => null,
  connectBrowserWallet: async () => {},
  disconnectBrowserWallet: () => {},
  setMode: () => {},
  error: null,
});

// ── Starknet window wallet detection (fallback for when starknetkit is unavailable) ──

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

function detectWalletKind(id: string): WalletKind {
  if (id.includes("argent")) return "argentX";
  if (id.includes("braavos")) return "braavos";
  if (id.includes("metamask")) return "metamask";
  return "unknown";
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const devnetAccount = useAccount();
  const [mode, setMode] = useState<WalletMode>(isDevnet ? "devnet" : "browser");
  const [browserAddress, setBrowserAddress] = useState<string | null>(null);
  const [browserWallet, setBrowserWallet] = useState<StarknetWindowObject | null>(null);
  const [walletKind, setWalletKind] = useState<WalletKind>("unknown");
  const [error, setError] = useState<string | null>(null);

  const connectBrowserWallet = useCallback(async () => {
    setError(null);
    try {
      // Try starknetkit first — it supports MetaMask Snap, ArgentX, Braavos,
      // and shows a nice connection modal.
      // NOTE: starknetkit has peerDep starknet ^8, we use ^9.
      // We only use it for wallet discovery + address; we create our own
      // starknet.js Account for signing.
      const starknetkit = await import("starknetkit").catch(() => null);

      if (starknetkit) {
        const result = await starknetkit.connect({
          modalMode: "alwaysAsk",
          modalTheme: "dark",
          dappName: "Zarklink Bridge",
        } as Parameters<typeof starknetkit.connect>[0]);

        const connectorData = result?.connectorData;
        const connector = result?.connector;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const walletObj = result?.wallet as any;

        const addr = connectorData?.account
          ?? walletObj?.selectedAddress
          ?? walletObj?.account?.address;

        if (!addr) {
          setError("Wallet connected but no address returned. Try again.");
          return;
        }

        // Determine wallet kind from connector id or wallet id
        const connId = (connector as { id?: string })?.id
          ?? walletObj?.id
          ?? "";
        setWalletKind(detectWalletKind(connId));

        // Store the wallet object for signing
        if (walletObj) {
          setBrowserWallet(walletObj as StarknetWindowObject);
        }

        setBrowserAddress(addr);
        setMode("browser");
        return;
      }

      // Fallback: manual wallet detection (no starknetkit available)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any;
      const wallets: StarknetWindowObject[] = [];
      if (win.starknet_argentX) wallets.push(win.starknet_argentX);
      if (win.starknet_braavos) wallets.push(win.starknet_braavos);
      if (win.starknet_metamask) wallets.push(win.starknet_metamask);
      if (win.starknet && !wallets.find((w) => w.id === win.starknet?.id)) {
        wallets.push(win.starknet);
      }

      if (wallets.length === 0) {
        setError(
          "No Starknet wallet found. Install ArgentX, Braavos, or MetaMask (with Starknet Snap).\n" +
          "For local devnet, use the devnet accounts instead."
        );
        return;
      }

      const wallet = wallets[0];
      const addresses = await wallet.enable({ starknetVersion: "v5" });
      const addr = addresses[0] ?? wallet.selectedAddress ?? wallet.account?.address;

      if (!addr) {
        setError("Wallet connected but no address returned");
        return;
      }

      setWalletKind(detectWalletKind(wallet.id));
      setBrowserWallet(wallet);
      setBrowserAddress(addr);
      setMode("browser");
    } catch (err) {
      // User rejection is not an error
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User rejected") || msg.includes("user rejected") || msg.includes("UserRejected")) {
        return;
      }
      setError(msg || "Failed to connect wallet");
    }
  }, []);

  const disconnectBrowserWallet = useCallback(async () => {
    try {
      const starknetkit = await import("starknetkit").catch(() => null);
      if (starknetkit?.disconnect) {
        await starknetkit.disconnect({ clearLastWallet: true });
      }
    } catch { /* ignore */ }

    setBrowserWallet(null);
    setBrowserAddress(null);
    setWalletKind("unknown");
    setMode(isDevnet ? "devnet" : "browser");
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

    // For browser wallets, use the wallet's native account object for signing
    if (browserWallet && browserAddress) {
      // The wallet extension manages signing internally via its request() API.
      // We wrap it in an Account that delegates execute calls to the wallet.
      const provider = getProvider();
      const account = new Account({
        provider,
        address: browserAddress,
        signer: browserWallet as any, // wallet implements Signer interface
      });
      // Override execute to use wallet's request method for proper signing
      const originalExecute = account.execute.bind(account);
      account.execute = async function(calls: any, details?: any) {
        try {
          // Try native wallet signing via starknet window object
          const result = await browserWallet!.request({
            type: "starknet_addInvokeTransaction",
            params: {
              calls: Array.isArray(calls) ? calls : [calls],
            },
          }) as any;
          return { transaction_hash: result.transaction_hash ?? result };
        } catch {
          // Fallback to standard execute
          return originalExecute(calls, details);
        }
      } as any;
      return account;
    }

    return null;
  }, [mode, devnetAccount, browserWallet, browserAddress]);

  const value = useMemo(
    () => ({
      mode,
      address,
      displayAddress,
      isConnected,
      walletKind,
      getSigner,
      connectBrowserWallet,
      disconnectBrowserWallet,
      setMode,
      error,
    }),
    [mode, address, displayAddress, isConnected, walletKind, getSigner, connectBrowserWallet, disconnectBrowserWallet, error],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWallet() {
  return useContext(WalletContext);
}
