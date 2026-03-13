"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export type BridgeTab = "issue" | "redeem";

export interface BridgeResult {
  type: "success" | "error" | "info";
  txHash?: string;
  lines: string[];
}

interface BridgeContextValue {
  /** Current tab (issue or redeem) */
  tab: BridgeTab;
  setTab: (tab: BridgeTab) => void;
  /** Input amount */
  amount: string;
  setAmount: (amount: string) => void;
  /** Privacy splits selection */
  splits: string;
  setSplits: (splits: string) => void;
  /** Zcash address for redeem */
  zcashAddress: string;
  setZcashAddress: (address: string) => void;
  /** Whether a transaction is in progress */
  submitting: boolean;
  setSubmitting: (submitting: boolean) => void;
  /** Status message during transaction */
  statusMsg: string;
  setStatusMsg: (msg: string) => void;
  /** Transaction result */
  result: BridgeResult | null;
  setResult: (result: BridgeResult | null) => void;
  /** Clear form state */
  clearForm: () => void;
}

const BridgeContext = createContext<BridgeContextValue>({
  tab: "issue",
  setTab: () => {},
  amount: "",
  setAmount: () => {},
  splits: "16",
  setSplits: () => {},
  zcashAddress: "",
  setZcashAddress: () => {},
  submitting: false,
  setSubmitting: () => {},
  statusMsg: "",
  setStatusMsg: () => {},
  result: null,
  setResult: () => {},
  clearForm: () => {},
});

// ── Provider ─────────────────────────────────────────────────────────────────

export function BridgeProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<BridgeTab>("issue");
  const [amount, setAmount] = useState("");
  const [splits, setSplits] = useState("16");
  const [zcashAddress, setZcashAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [result, setResult] = useState<BridgeResult | null>(null);

  const clearForm = useCallback(() => {
    setAmount("");
    setZcashAddress("");
    setResult(null);
    setStatusMsg("");
    // Don't clear submitting - that should be cleared by the transaction handler
  }, []);

  const value = useMemo(
    () => ({
      tab,
      setTab,
      amount,
      setAmount,
      splits,
      setSplits,
      zcashAddress,
      setZcashAddress,
      submitting,
      setSubmitting,
      statusMsg,
      setStatusMsg,
      result,
      setResult,
      clearForm,
    }),
    [tab, amount, splits, zcashAddress, submitting, statusMsg, result, clearForm],
  );

  return (
    <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useBridge() {
  return useContext(BridgeContext);
}
