"use client";

import { useState, useCallback } from "react";
import {
  ArrowLeftRight,
  ArrowDown,
  Zap,
  Shield,
  Info,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  Wallet,
  RefreshCw,
  Send,
} from "lucide-react";
import { CallData, Contract, Account } from "starknet";
import { useBridgeStats, usePoolStats, useWzecBalance, useZcashBalance } from "@/hooks/useStarknet";
import { useAccount } from "@/context/AccountContext";
import { useWallet } from "@/context/WalletContext";
import { useZcashAccount } from "@/context/ZcashAccountContext";
import { useBridge } from "@/context/BridgeContext";
import {
  config as starknetConfig,
  formatZec,
  formatWrappedZec,
  shortAddr,
  friendlyTxError,
  getProvider,
  isDevnet,
  isTestnet,
  explorerUrl,
  zcashCoinName,
  wrappedCoinName,
  BRIDGE_ABI,
  RELAY_ABI,
  REGISTRY_ABI,
} from "@/lib/starknet";

// ── Clipboard copy button ────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-white/5 hover:bg-white/10 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-gray-400" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Devnet auto-completion helpers ───────────────────────────────────────────

/**
 * Find a finalized block height and its commitment_root from the relay.
 */
async function findFinalizedBlock(): Promise<{ height: number; commitmentRoot: string } | null> {
  if (!starknetConfig.relayAddress) return null;
  const provider = getProvider();
  const relay = new Contract({
    abi: RELAY_ABI,
    address: starknetConfig.relayAddress,
    providerOrAccount: provider,
  });
  const finalizedHeight = Number(await relay.call("get_finalized_height", []));
  if (finalizedHeight <= 0) return null;

  for (let h = finalizedHeight; h >= 1 && h > finalizedHeight - 10; h--) {
    const root = await relay.call("get_commitment_root", [h]);
    const rootStr = String(root);
    if (rootStr !== "0" && rootStr !== "0x0") {
      return { height: h, commitmentRoot: rootStr };
    }
  }
  return null;
}

/**
 * Get the vault operator Account for a given vault_id (0-indexed on-chain).
 * Vault operators are accounts[1..N] in the devnet accounts list.
 */
function getVaultOperatorAccount(
  vaultId: number,
  allAccounts: { address: string; private_key: string }[],
): Account | null {
  const acct = allAccounts[vaultId + 1];
  if (!acct) return null;
  return new Account({
    provider: getProvider(),
    address: acct.address,
    signer: acct.private_key,
  });
}

/**
 * Fetch the Zcash address for a vault from the on-chain VaultRegistry.
 */
async function getVaultZcashAddress(vaultId: number): Promise<string | null> {
  if (!starknetConfig.registryAddress) return null;
  const provider = getProvider();
  const registry = new Contract({
    abi: REGISTRY_ABI,
    address: starknetConfig.registryAddress,
    providerOrAccount: provider,
  });
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info: any = await registry.call("get_vault", [vaultId]);
    const addr = String(info[1] ?? "");
    return addr && addr !== "0" && addr !== "0x0" ? addr : null;
  } catch {
    return null;
  }
}

/**
 * Devnet: send ZEC from one address to another via the dev API, mine blocks, wait for completion.
 * Returns the operation ID on success, or throws on failure.
 */
async function devnetSendZec(
  fromAddress: string,
  toAddress: string,
  amount: number,
  setStatusMsg: (msg: string) => void,
): Promise<string> {
  // 1. Send ZEC
  setStatusMsg(`Sending ${amount.toFixed(8)} ${zcashCoinName()} to vault...`);
  const sendRes = await fetch("/api/dev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "send_zec", from_address: fromAddress, to_address: toAddress, amount: String(amount) }),
  });
  const sendData = await sendRes.json();
  if (!sendData.ok) throw new Error(`ZEC send failed: ${sendData.error}`);
  const opid = sendData.operation_id;

  // 2. Mine a block so the transaction confirms
  setStatusMsg("Mining block to confirm ZEC transfer...");
  await fetch("/api/dev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "mine_blocks", count: 1 }),
  });

  // 3. Poll operation status (up to 30s)
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const statusRes = await fetch("/api/dev", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check_operation", opid }),
    });
    const statusData = await statusRes.json();
    if (statusData.ok && Array.isArray(statusData.status) && statusData.status.length > 0) {
      const op = statusData.status[0];
      if (op.status === "success") return opid;
      if (op.status === "failed") throw new Error(`ZEC send failed: ${op.error?.message ?? "unknown"}`);
    }
    // Mine another block if still executing
    if (i % 3 === 2) {
      await fetch("/api/dev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mine_blocks", count: 1 }),
      });
    }
  }
  throw new Error("ZEC send timed out after 30s");
}

// ── Bridge Page ──────────────────────────────────────────────────────────────

export default function BridgePage() {
  // Use global bridge state for persistence across page navigation
  const {
    tab, setTab,
    amount, setAmount,
    splits, setSplits,
    zcashAddress, setZcashAddress,
    submitting, setSubmitting,
    statusMsg, setStatusMsg,
    result, setResult,
  } = useBridge();

  const { stats: bridge } = useBridgeStats();
  const { stats: pool } = usePoolStats(10000);
  const { current: account, accounts, getAccount } = useAccount();
  const wallet = useWallet();
  const { getZcashAddress } = useZcashAccount();

  // Balances with auto-refresh (use wallet address if browser-connected)
  const activeAddress = wallet.address ?? account?.address ?? "";
  const associatedZcash = activeAddress ? getZcashAddress(activeAddress) : null;
  const { balance: wzecBalance, refetch: refetchWzec } = useWzecBalance(activeAddress, 8000);
  const { balance: zcashBal } = useZcashBalance(
    isDevnet ? (account?.zcash_shielded ?? "") : (associatedZcash ?? ""),
    isDevnet ? 15000 : 0,
  );

  const zatoshi = Math.floor(parseFloat(amount || "0") * 1e8);
  const fee = bridge ? (zatoshi * bridge.feeRate) / 10000 : 0;
  const receiveAmount = zatoshi - fee;

  // Zcash address: devnet uses mapped address, testnet uses association
  const accountZcash = account?.zcash_shielded ?? associatedZcash ?? "";

  // ── Testnet manual send state ──────────────────────────────────────────
  // When issuing on testnet, the user must manually send TAZ to the vault.
  // We pause after request_lock and show the vault address/amount.
  const [pendingManualSend, setPendingManualSend] = useState<{
    requestId: string;
    vaultId: number;
    vaultZcashAddr: string;
    amountZec: number;
    lockTxHash: string;
  } | null>(null);

  // ── Issue (ZEC → wZEC) with real ZEC transfer ────────────────────────────

  async function handleIssue() {
    const signer = wallet.getSigner() ?? getAccount();
    if (!signer) {
      setResult({ type: "error", lines: ["No wallet connected. Connect your wallet from the navbar."] });
      return;
    }
    if (!starknetConfig.bridgeAddress) {
      setResult({ type: "error", lines: ["Bridge contract not configured. Check environment setup."] });
      return;
    }

    // Validate against pool capacity to prevent unlimited minting
    if (pool && BigInt(zatoshi) > pool.capacity) {
      setResult({
        type: "error",
        lines: [
          `Issue amount exceeds pool capacity.`,
          `Requested: ${formatZec(BigInt(zatoshi))}`,
          `Available capacity: ${formatZec(pool.capacity)}`,
          ``,
          `The pool capacity is based on total vault collateral.`,
          `Try a smaller amount or wait for more vaults to join.`,
        ],
      });
      return;
    }

    // Validate ZEC balance (devnet only — testnet balance is "—")
    if (zcashBal && zcashBal !== "—") {
      const zcashBalance = parseFloat(zcashBal);
      const requestedZec = parseFloat(amount || "0");
      if (!isNaN(zcashBalance) && !isNaN(requestedZec) && zcashBalance < requestedZec) {
        setResult({
          type: "error",
          lines: [
            `Insufficient ${zcashCoinName()} balance.`,
            `Your balance: ${zcashBalance.toFixed(8)} ${zcashCoinName()}`,
            `Required: ${requestedZec.toFixed(8)} ${zcashCoinName()}`,
            ``,
            `You need ${zcashCoinName()} in your Zcash shielded address to issue ${wrappedCoinName()}.`,
            `Current account: ${account?.label ?? "Unknown"} (${shortAddr(account?.address ?? "")})`,
          ],
        });
        return;
      }
    }

    // On testnet, require a Zcash address association
    if (isTestnet && !accountZcash) {
      setResult({
        type: "error",
        lines: [
          `No ${zcashCoinName()} address associated with this account.`,
          ``,
          `Go to the Account page to associate your Zcash testnet address first.`,
          `You need a funded ${zcashCoinName()} address to send to the vault.`,
        ],
      });
      return;
    }

    // On devnet, require a mapped Zcash address (pre-funded accounts)
    if (isDevnet && !accountZcash) {
      setResult({
        type: "error",
        lines: [
          `No Zcash shielded address linked to this account.`,
          ``,
          `To issue ${wrappedCoinName()}, use the pre-funded accounts (Issuer/Redeemer) from the account selector.`,
        ],
      });
      return;
    }

    const warranty = bridge?.warrantyAmount ?? BigInt(10000000);

    // Step 1: request_lock on Starknet
    setStatusMsg("Step 1: Requesting lock permit on Starknet...");
    const txResult = await signer.execute({
      contractAddress: starknetConfig.bridgeAddress,
      entrypoint: "request_lock",
      calldata: CallData.compile({
        mint_amount: { low: String(zatoshi), high: "0" },
        warranty_collateral: { low: String(warranty), high: "0" },
      }),
    });
    await signer.waitForTransaction(txResult.transaction_hash);

    // Read request_id from TX events
    const provider = getProvider();
    const receipt = await provider.getTransactionReceipt(txResult.transaction_hash);
    let requestId = "0x0";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (receipt as any)?.events ?? [];
    if (events.length > 0) {
      const ev = events[0];
      if (ev.keys && ev.keys.length > 1) {
        requestId = ev.keys[1];
      } else if (ev.data && ev.data.length > 0) {
        requestId = ev.data[0];
      }
    }

    if (requestId === "0x0") {
      const issueCount = await (async () => {
        try {
          const bc = new Contract({ abi: BRIDGE_ABI, address: starknetConfig.bridgeAddress, providerOrAccount: provider });
          return Number(await bc.call("get_issue_count", []));
        } catch { return 0; }
      })();
      setResult({
        type: "info",
        txHash: txResult.transaction_hash,
        lines: [
          `Issue request submitted (Step 1 complete)!`,
          `Amount: ${formatZec(BigInt(zatoshi))} → Receive: ~${formatWrappedZec(BigInt(Math.floor(receiveAmount)))}`,
          `Issue count: ${issueCount}`,
          ``,
          `Could not auto-complete: request_id not found in TX events.`,
          `The vault daemon will process this request if running.`,
        ],
      });
      return;
    }

    // Read issue request to get vault_id
    const bridgeContract = new Contract({ abi: BRIDGE_ABI, address: starknetConfig.bridgeAddress, providerOrAccount: provider });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reqData: any = await bridgeContract.call("get_issue_request", [requestId]);
    const vaultId = Number(reqData[2] ?? 0);

    // Look up vault's Zcash address from the registry
    const vaultZcashAddr = await getVaultZcashAddress(vaultId);

    // ── Testnet: manual send flow ──────────────────────────────────────
    if (isTestnet) {
      if (!vaultZcashAddr) {
        setResult({
          type: "info",
          txHash: txResult.transaction_hash,
          lines: [
            `Issue request submitted! Assigned to Vault #${vaultId + 1}`,
            `Request ID: ${requestId.slice(0, 18)}...`,
            ``,
            `Could not look up vault's Zcash address.`,
            `Ask the vault operator for their address to complete the transfer.`,
          ],
        });
        return;
      }

      // Pause and show manual send instructions
      const amountZec = parseFloat(amount || "0");
      setPendingManualSend({
        requestId,
        vaultId,
        vaultZcashAddr,
        amountZec,
        lockTxHash: txResult.transaction_hash,
      });
      setResult({
        type: "info",
        txHash: txResult.transaction_hash,
        lines: [
          `Lock request submitted! Now send ${zcashCoinName()} to the vault.`,
          ``,
          `Send exactly ${amountZec.toFixed(8)} ${zcashCoinName()} to:`,
          vaultZcashAddr,
          ``,
          `Vault: #${vaultId + 1}`,
          `After sending, click "I've Sent the ${zcashCoinName()}" below to complete the issue.`,
        ],
      });
      setSubmitting(false);
      return;
    }

    // ── Devnet: automatic ZEC transfer ─────────────────────────────────
    if (isDevnet && vaultZcashAddr && accountZcash) {
      const sendAmount = parseFloat(amount || "0");
      try {
        await devnetSendZec(accountZcash, vaultZcashAddr, sendAmount, setStatusMsg);
      } catch (err) {
        setResult({
          type: "info",
          txHash: txResult.transaction_hash,
          lines: [
            `Lock request submitted, but ZEC transfer failed:`,
            err instanceof Error ? err.message : "Unknown error",
            ``,
            `Request ID: ${requestId.slice(0, 18)}...`,
            `Vault: #${vaultId + 1} (${vaultZcashAddr.slice(0, 16)}...)`,
            ``,
            `You can retry or the vault daemon will handle this.`,
          ],
        });
        return;
      }
    }

    // ── Steps 2-3: submit_mint + confirm_issue (same for devnet) ───────
    await completeIssue(signer, provider, requestId, vaultId, txResult.transaction_hash);
  }

  /**
   * Complete the issue flow: submit_mint + confirm_issue.
   * Called automatically on devnet, or after user confirms manual send on testnet.
   */
  async function completeIssue(
    signer: Account,
    provider: ReturnType<typeof getProvider>,
    requestId: string,
    vaultId: number,
    lockTxHash: string,
  ) {
    // Find a finalized block for submit_mint
    setStatusMsg("Finding finalized block for mint proof...");
    const finalized = await findFinalizedBlock();
    if (!finalized) {
      setResult({
        type: "info",
        txHash: lockTxHash,
        lines: [
          `Issue request submitted (Step 1 complete)!`,
          `Request ID: ${requestId.slice(0, 18)}...`,
          `Assigned Vault: #${vaultId + 1}`,
          ``,
          `No finalized blocks in relay — cannot submit mint proof.`,
          `Start the relayer service to relay Zcash headers.`,
        ],
      });
      return;
    }

    // Step 2: submit_mint as the issuer
    setStatusMsg("Submitting mint proof...");
    const submitMintTx = await signer.execute({
      contractAddress: starknetConfig.bridgeAddress!,
      entrypoint: "submit_mint",
      calldata: CallData.compile({
        request_id: requestId,
        note_commitment: finalized.commitmentRoot,
        inclusion_proof: [],
        block_height: finalized.height,
        note_ciphertext_hash: "0x" + BigInt(Date.now()).toString(16),
        zk_proof: ["0x1", "0x2"],
      }),
    });
    await signer.waitForTransaction(submitMintTx.transaction_hash);

    // Step 3: confirm_issue as the vault operator
    setStatusMsg(`Vault confirming issue (minting ${wrappedCoinName()})...`);
    const vaultOperator = getVaultOperatorAccount(vaultId, accounts);
    if (!vaultOperator) {
      setResult({
        type: "info",
        txHash: submitMintTx.transaction_hash,
        lines: [
          `Issue Steps 1-2 complete!`,
          `Request ID: ${requestId.slice(0, 18)}...`,
          `Mint proof submitted at block ${finalized.height}`,
          ``,
          `Vault operator account not found for vault #${vaultId + 1}.`,
          `The vault daemon will auto-confirm if running.`,
        ],
      });
      return;
    }

    const confirmTx = await vaultOperator.execute({
      contractAddress: starknetConfig.bridgeAddress!,
      entrypoint: "confirm_issue",
      calldata: CallData.compile({ request_id: requestId }),
    });
    await vaultOperator.waitForTransaction(confirmTx.transaction_hash);

    refetchWzec();

    const feeAmount = BigInt(Math.floor(fee));
    const minted = BigInt(zatoshi) - feeAmount;
    setResult({
      type: "success",
      txHash: confirmTx.transaction_hash,
      lines: [
        `Issue complete!`,
        `Amount: ${formatZec(BigInt(zatoshi))} → ${formatWrappedZec(minted)} minted`,
        `Fee: ${formatZec(feeAmount)} (${bridge ? (bridge.feeRate / 100).toFixed(2) : "?"}%)`,
        `Vault: #${vaultId + 1}`,
        ``,
        `All steps completed${isDevnet ? ' automatically (devnet mode)' : ''}:`,
        `• Lock request → TX: ${shortAddr(lockTxHash, 8)}`,
        isDevnet ? `• ${zcashCoinName()} transferred to vault` : `• ${zcashCoinName()} sent manually to vault`,
        `• Mint proof submitted → TX: ${shortAddr(submitMintTx.transaction_hash, 8)}`,
        `• Vault confirmed → TX: ${shortAddr(confirmTx.transaction_hash, 8)}`,
      ],
    });
    setPendingManualSend(null);
  }

  /**
   * Testnet: user confirms they've sent the TAZ manually.
   * Resume the issue flow with submit_mint + confirm_issue.
   */
  async function handleConfirmManualSend() {
    if (!pendingManualSend) return;

    const signer = wallet.getSigner() ?? getAccount();
    if (!signer) {
      setResult({ type: "error", lines: ["Wallet disconnected. Reconnect and try again."] });
      return;
    }

    setSubmitting(true);
    setResult(null);
    setStatusMsg("Continuing issue after manual send...");

    try {
      const provider = getProvider();
      await completeIssue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        signer as any,
        provider,
        pendingManualSend.requestId,
        pendingManualSend.vaultId,
        pendingManualSend.lockTxHash,
      );
    } catch (err) {
      const { message, hints } = friendlyTxError(err);
      setResult({ type: "error", lines: [message, ...hints] });
    } finally {
      setSubmitting(false);
      setStatusMsg("");
    }
  }

  // ── Redeem (wZEC → ZEC) with devnet auto-completion ──────────────────────

  async function handleRedeem() {
    const signer = wallet.getSigner() ?? getAccount();
    if (!signer) {
      setResult({ type: "error", lines: ["No wallet connected. Connect your wallet from the navbar."] });
      return;
    }
    if (!starknetConfig.bridgeAddress) {
      setResult({ type: "error", lines: ["Bridge contract not configured. Check environment setup."] });
      return;
    }

    // Pre-submit balance validation
    if (wzecBalance < BigInt(zatoshi)) {
      setResult({
        type: "error",
        lines: [
          `Insufficient ${wrappedCoinName()} balance.`,
          `Your balance: ${formatWrappedZec(wzecBalance)}`,
          `Required: ${formatWrappedZec(BigInt(zatoshi))}`,
          ``,
          `Make sure you're using the account that received ${wrappedCoinName()} from an Issue.`,
          `Current account: ${account?.label ?? "Unknown"} (${shortAddr(account?.address ?? "")})`,
        ],
      });
      return;
    }

    const warranty = bridge?.warrantyAmount ?? BigInt(10000000);

    // Use commitment root from finalized block so confirm_redeem can verify
    const finalized = await findFinalizedBlock();
    const noteCommitment = finalized ? finalized.commitmentRoot : ("0x" + BigInt(Date.now()).toString(16));
    const noteCiphertextHash = "0x" + BigInt(Date.now() + 1).toString(16);

    // Step 1: submit_burn (burns wZEC from caller)
    setStatusMsg(`Step 1/2: Burning ${wrappedCoinName()}...`);
    const txResult = await signer.execute({
      contractAddress: starknetConfig.bridgeAddress,
      entrypoint: "submit_burn",
      calldata: CallData.compile({
        note_commitment: noteCommitment,
        note_ciphertext_hash: noteCiphertextHash,
        burn_amount: { low: String(zatoshi), high: "0" },
        warranty_collateral: { low: String(warranty), high: "0" },
        zk_proof: ["0x1", "0x2"],
      }),
    });
    await signer.waitForTransaction(txResult.transaction_hash);

    // Extract request_id from events
    const provider = getProvider();
    const receipt = await provider.getTransactionReceipt(txResult.transaction_hash);
    let requestId = "0x0";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events = (receipt as any)?.events ?? [];
    if (events.length > 0) {
      const ev = events[0];
      if (ev.keys && ev.keys.length > 1) {
        requestId = ev.keys[1];
      } else if (ev.data && ev.data.length > 0) {
        requestId = ev.data[0];
      }
    }

    refetchWzec();

    const dest = zcashAddress || accountZcash || "(your Zcash address)";

    if (requestId === "0x0" || !finalized) {
      setResult({
        type: "info",
        txHash: txResult.transaction_hash,
        lines: [
          `Redeem Step 1 complete — ${wrappedCoinName()} burned!`,
          `Burn amount: ${formatWrappedZec(BigInt(zatoshi))}`,
          `Destination: ${dest}`,
          ``,
          requestId === "0x0"
            ? `Could not extract request_id from TX events.`
            : `No finalized blocks — cannot auto-confirm.`,
          `The vault daemon will complete this redeem if running.`,
        ],
      });
      return;
    }

    // Step 2: confirm_redeem as vault operator
    setStatusMsg("Step 2/2: Vault confirming redeem...");
    const bridgeContract = new Contract({ abi: BRIDGE_ABI, address: starknetConfig.bridgeAddress, providerOrAccount: provider });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reqData: any = await bridgeContract.call("get_redeem_request", [requestId]);
    const vaultId = Number(reqData[2] ?? 0);

    const vaultOperator = getVaultOperatorAccount(vaultId, accounts);
    if (!vaultOperator) {
      setResult({
        type: "info",
        txHash: txResult.transaction_hash,
        lines: [
          `Redeem Step 1 complete — ${wrappedCoinName()} burned!`,
          `Burn amount: ${formatWrappedZec(BigInt(zatoshi))}`,
          `Destination: ${dest}`,
          `Assigned Vault: #${vaultId + 1}`,
          ``,
          `Vault operator account not found — vault daemon will complete.`,
        ],
      });
      return;
    }

    const confirmTx = await vaultOperator.execute({
      contractAddress: starknetConfig.bridgeAddress,
      entrypoint: "confirm_redeem",
      calldata: CallData.compile({
        request_id: requestId,
        inclusion_proof: [],
        block_height: finalized.height,
      }),
    });
    await vaultOperator.waitForTransaction(confirmTx.transaction_hash);

    setResult({
      type: "success",
      txHash: confirmTx.transaction_hash,
      lines: [
        `Redeem complete!`,
        `Burned: ${formatWrappedZec(BigInt(zatoshi))}`,
        `Destination: ${dest}`,
        `Vault: #${vaultId + 1}`,
        ``,
        `All steps completed automatically${isDevnet ? ' (devnet mode)' : ''}:`,
        `• Step 1: ${wrappedCoinName()} burned → TX: ${shortAddr(txResult.transaction_hash, 8)}`,
        `• Step 2: Vault confirmed → TX: ${shortAddr(confirmTx.transaction_hash, 8)}`,
      ],
    });
  }

  // ── Submit handler ───────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || zatoshi <= 0) return;

    setSubmitting(true);
    setResult(null);
    setStatusMsg("");

    try {
      if (tab === "issue") {
        await handleIssue();
      } else {
        await handleRedeem();
      }
    } catch (err: unknown) {
      const { message, hints } = friendlyTxError(err);
      setResult({ type: "error", lines: [message, ...hints] });
    } finally {
      setSubmitting(false);
      setStatusMsg("");
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold mb-2">Bridge</h1>
        <p className="text-gray-400">
          Transfer between Zcash and Starknet with privacy-preserving splitting
        </p>
      </div>

      <div className="max-w-lg mx-auto">

        {/* Balance Display */}
        {account && (
          <div className="card mb-6 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="h-4 w-4 text-brand-primary" />
              <span className="text-sm font-medium">{account.label}</span>
              <span className="text-xs text-gray-500 font-mono">{shortAddr(account.address)}</span>
              <button
                onClick={() => refetchWzec()}
                className="ml-auto text-gray-500 hover:text-gray-300 transition-colors"
                title="Refresh balances"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-brand-dark rounded-lg p-3 border border-brand-border">
                <p className="text-xs text-gray-400 mb-1">{wrappedCoinName()} Balance (Starknet)</p>
                <p className="text-lg font-bold font-mono text-brand-primary">
                  {formatWrappedZec(wzecBalance)}
                </p>
              </div>
              <div className="bg-brand-dark rounded-lg p-3 border border-brand-border">
                <p className="text-xs text-gray-400 mb-1">{zcashCoinName()} Balance (Zcash)</p>
                <p className="text-lg font-bold font-mono text-brand-blue">
                  {zcashBal === "—" ? "—" : `${parseFloat(zcashBal).toFixed(8)} ${zcashCoinName()}`}
                </p>
                {!accountZcash && (
                  <p className="text-[10px] text-gray-500 mt-0.5">No Zcash address mapped</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab Selector */}
        <div className="flex bg-brand-card border border-brand-border rounded-xl p-1 mb-6">
          <button
            onClick={() => { setTab("issue"); setResult(null); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === "issue"
                ? "bg-brand-primary/10 text-brand-primary border border-brand-primary/30"
                : "text-gray-400 hover:text-foreground"
            }`}
          >
            <Zap className="h-4 w-4" />
            Issue ({zcashCoinName()} → {wrappedCoinName()})
          </button>
          <button
            onClick={() => { setTab("redeem"); setResult(null); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === "redeem"
                ? "bg-brand-blue/10 text-brand-blue border border-brand-blue/30"
                : "text-gray-400 hover:text-foreground"
            }`}
          >
            <ArrowLeftRight className="h-4 w-4" />
            Redeem ({wrappedCoinName()} → {zcashCoinName()})
          </button>
        </div>

        {/* Bridge Form */}
        <form onSubmit={handleSubmit}>
          <div className="card mb-4">
            {/* From */}
            <div className="mb-4">
              <label className="flex items-center justify-between text-sm text-gray-400 mb-2">
                <span>{tab === "issue" ? "From (Zcash)" : "From (Starknet)"}</span>
                {tab === "redeem" && wzecBalance > 0n && (
                  <button
                    type="button"
                    onClick={() => setAmount((Number(wzecBalance) / 1e8).toFixed(8))}
                    className="text-xs text-brand-blue hover:text-brand-blue/80 transition-colors"
                  >
                    Max: {formatWrappedZec(wzecBalance)}
                  </button>
                )}
                {tab === "issue" && pool && (
                  <span className="text-xs flex items-center gap-2">
                    {zcashBal && zcashBal !== "—" && parseFloat(zcashBal) > 0 && (
                      <button
                        type="button"
                        onClick={() => setAmount(parseFloat(zcashBal).toFixed(8))}
                        className="text-brand-primary hover:text-brand-primary/80 transition-colors"
                      >
                        Max: {parseFloat(zcashBal).toFixed(4)} {zcashCoinName()}
                      </button>
                    )}
                    <span className="text-gray-400">Pool: {formatZec(pool.capacity)}</span>
                  </span>
                )}
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  step="0.00000001"
                  min="0"
                  placeholder="0.00000000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="input-field flex-1 text-xl font-mono"
                />
                <span className="text-sm font-medium text-brand-primary px-3 py-2 bg-brand-primary/10 rounded-lg border border-brand-primary/20">
                  {tab === "issue" ? zcashCoinName() : wrappedCoinName()}
                </span>
              </div>
              {/* Balance warning for redeem - don't show during transaction */}
              {tab === "redeem" && zatoshi > 0 && !submitting && wzecBalance < BigInt(zatoshi) && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Insufficient {wrappedCoinName()} balance ({formatWrappedZec(wzecBalance)} available)
                </p>
              )}
              {/* Capacity warning for issue - don't show during transaction */}
              {tab === "issue" && zatoshi > 0 && !submitting && pool && BigInt(zatoshi) > pool.capacity && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Exceeds pool capacity ({formatZec(pool.capacity)} available)
                </p>
              )}
              {/* ZEC balance warning for issue - don't show during transaction */}
              {tab === "issue" && zatoshi > 0 && !submitting && zcashBal && zcashBal !== "—" && parseFloat(amount || "0") > parseFloat(zcashBal) && (
                <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Insufficient {zcashCoinName()} balance ({parseFloat(zcashBal).toFixed(8)} {zcashCoinName()} available)
                </p>
              )}
            </div>

            {/* Arrow */}
            <div className="flex justify-center my-2">
              <div className="h-8 w-8 rounded-full bg-brand-dark border border-brand-border flex items-center justify-center">
                <ArrowDown className="h-4 w-4 text-gray-400" />
              </div>
            </div>

            {/* To */}
            <div className="mb-4">
              <label className="text-sm text-gray-400 mb-2 block">
                {tab === "issue" ? "To (Starknet)" : "To (Zcash)"}
              </label>
              <div className="flex items-center gap-3">
                <div className="input-field flex-1 text-xl font-mono text-gray-300">
                  {receiveAmount > 0
                    ? (receiveAmount / 1e8).toFixed(8)
                    : "0.00000000"}
                </div>
                <span className="text-sm font-medium text-brand-blue px-3 py-2 bg-brand-blue/10 rounded-lg border border-brand-blue/20">
                  {tab === "issue" ? wrappedCoinName() : zcashCoinName()}
                </span>
              </div>
            </div>

            {/* Zcash address (redeem only) */}
            {tab === "redeem" && (
              <div className="mb-4">
                <label className="text-sm text-gray-400 mb-1 block">
                  Destination Zcash Address
                </label>
                <input
                  type="text"
                  placeholder={accountZcash || "zs1..."}
                  value={zcashAddress}
                  onChange={(e) => setZcashAddress(e.target.value)}
                  className="input-field w-full font-mono text-sm"
                />
                {accountZcash && !zcashAddress && (
                  <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    Auto-using your mapped Zcash address. Type to override.
                  </p>
                )}
                {!accountZcash && !zcashAddress && (
                  <p className="text-xs text-yellow-500/70 mt-1 flex items-center gap-1">
                    <Info className="h-3 w-3" />
                    No Zcash address mapped for this account. Check &quot;Account Details&quot; in the wallet menu, or enter one manually.
                  </p>
                )}
              </div>
            )}

            {/* Privacy splits */}
            <div className="mb-4">
              <label className="flex items-center gap-1 text-sm text-gray-400 mb-2">
                <Shield className="h-3.5 w-3.5" />
                Privacy Splits
              </label>
              <select
                value={splits}
                onChange={(e) => setSplits(e.target.value)}
                className="input-field w-full"
              >
                <option value="1">1 vault (no splitting)</option>
                <option value="4">4 vaults</option>
                <option value="8">8 vaults</option>
                <option value="16">16 vaults (recommended)</option>
                <option value="32">32 vaults (max privacy)</option>
              </select>
            </div>

            {/* Fee Info */}
            <div className="bg-brand-dark rounded-lg p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Bridge Fee</span>
                <span className="text-foreground">
                  {bridge ? `${(bridge.feeRate / 100).toFixed(2)}%` : "—"}
                  {fee > 0 && (
                    <span className="text-gray-500 ml-1">
                      ({formatZec(BigInt(Math.floor(fee)))})
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Vault Splits</span>
                <span className="text-foreground">{splits} slots</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Finality</span>
                <span className="text-foreground">~6 Zcash blocks</span>
              </div>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={
              submitting || 
              !amount || 
              zatoshi <= 0 || 
              (tab === "redeem" && wzecBalance < BigInt(zatoshi)) ||
              (tab === "issue" && pool !== null && BigInt(zatoshi) > pool.capacity)
            }
            className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
              tab === "issue"
                ? "btn-primary"
                : "bg-brand-blue text-white hover:bg-brand-blue/90 disabled:opacity-50 disabled:cursor-not-allowed"
            }`}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                {statusMsg || "Processing..."}
              </span>
            ) : tab === "issue" ? (
              `Issue ${wrappedCoinName()}`
            ) : (
              `Redeem ${zcashCoinName()}`
            )}
          </button>
        </form>

        {/* Result */}
        {result && (
          <div className={`mt-4 p-4 rounded-xl border ${
            result.type === "error"
              ? "bg-red-500/5 border-red-500/20"
              : result.type === "success"
              ? "bg-green-500/5 border-green-500/20"
              : "bg-brand-primary/5 border-brand-primary/20"
          }`}>
            <div className="flex items-start gap-2">
              {result.type === "error" ? (
                <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
              ) : (
                <Info className="h-5 w-5 text-brand-primary mt-0.5 shrink-0" />
              )}
              <div className="text-sm text-gray-300 space-y-1 min-w-0 overflow-hidden">
                {result.txHash && (
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-gray-400">TX:</span>
                    <code className="font-mono text-xs text-gray-200 break-all">{result.txHash}</code>
                    <CopyBtn text={result.txHash} />
                  </div>
                )}
                {result.lines.map((line, i) => (
                  <p key={i} className={`${line === "" ? "h-2" : ""} break-all`}>{line}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Testnet Manual Send Confirmation */}
        {pendingManualSend && !submitting && (
          <div className="mt-4 p-4 rounded-xl border border-brand-blue/30 bg-brand-blue/5">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-brand-blue flex items-center gap-2">
                <Send className="h-4 w-4" />
                Send {zcashCoinName()} to Complete Issue
              </h3>
              <div className="bg-brand-dark rounded-lg p-3 space-y-2">
                <div>
                  <span className="text-xs text-gray-400">Send exactly:</span>
                  <p className="font-mono text-lg font-bold text-brand-primary">
                    {pendingManualSend.amountZec.toFixed(8)} {zcashCoinName()}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-gray-400">To vault #{pendingManualSend.vaultId + 1} address:</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <code className="font-mono text-xs text-brand-blue break-all">{pendingManualSend.vaultZcashAddr}</code>
                    <CopyBtn text={pendingManualSend.vaultZcashAddr} />
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                Send the {zcashCoinName()} from your Zcash testnet wallet, then click below to finish the issue.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleConfirmManualSend}
                  disabled={submitting}
                  className="btn-primary flex items-center gap-2"
                >
                  <Check className="h-4 w-4" />
                  I&apos;ve Sent the {zcashCoinName()}
                </button>
                <button
                  onClick={() => { setPendingManualSend(null); setResult(null); }}
                  className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-200 bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
