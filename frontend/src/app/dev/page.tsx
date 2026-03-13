"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Wrench,
  Plus,
  Coins,
  Pickaxe,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Zap,
  ArrowLeftRight,
  Play,
  Terminal,
  Wallet,
  Info,
  AlertTriangle,
} from "lucide-react";
import { CallData, Contract, Account } from "starknet";
import { useAccount } from "@/context/AccountContext";
import { useWallet } from "@/context/WalletContext";
import {
  config as starknetConfig,
  isDevnet,
  getProvider,
  formatZec,
  shortAddr,
  friendlyTxError,
  BRIDGE_ABI,
  RELAY_ABI,
  REGISTRY_ABI,
  POOL_ABI,
  WZEC_ABI,
} from "@/lib/starknet";
import { notFound } from "next/navigation";

// ── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  time: string;
  type: "info" | "success" | "error" | "pending";
  message: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(text); } catch {
      const el = document.createElement("textarea"); el.value = text;
      document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button onClick={copy} className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-xs bg-white/5 hover:bg-white/10 transition-colors" title="Copy">
      {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3 text-gray-400" />}
    </button>
  );
}

function timestamp() {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function devApi(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch("/api/dev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...params }),
  });
  return res.json();
}

async function findFinalizedBlock(): Promise<{ height: number; commitmentRoot: string } | null> {
  if (!starknetConfig.relayAddress) return null;
  const provider = getProvider();
  const relay = new Contract({ abi: RELAY_ABI, address: starknetConfig.relayAddress, providerOrAccount: provider });
  const fh = Number(await relay.call("get_finalized_height", []));
  if (fh <= 0) return null;
  for (let h = fh; h >= 1 && h > fh - 10; h--) {
    const root = await relay.call("get_commitment_root", [h]);
    const rs = String(root);
    if (rs !== "0" && rs !== "0x0") return { height: h, commitmentRoot: rs };
  }
  return null;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DevToolsPage() {
  // Block access in non-devnet environments
  if (!isDevnet) {
    notFound();
  }

  const { current: account, accounts, getAccount } = useAccount();
  const wallet = useWallet();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [walletInfo, setWalletInfo] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [mineCount, setMineCount] = useState("10");
  const [fundAddr, setFundAddr] = useState("");
  const [fundAmount, setFundAmount] = useState("5.0");
  const [simCount, setSimCount] = useState("3");
  const [simIssueAmt, setSimIssueAmt] = useState("0.5");

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    setLogs(prev => [{ id: uid(), time: timestamp(), type, message }, ...prev].slice(0, 200));
  }, []);

  const setLoadingKey = (key: string, val: boolean) => setLoading(prev => ({ ...prev, [key]: val }));

  // ── Zcash Tools ──────────────────────────────────────────────────────────

  async function handleGenerateZAddr() {
    setLoadingKey("genZ", true);
    try {
      const r = await devApi("generate_z_address");
      if (r.ok) addLog("success", `New shielded address: ${r.address}`);
      else addLog("error", `Failed: ${r.error}`);
    } catch (e: unknown) { addLog("error", `Error: ${e instanceof Error ? e.message : String(e)}`); }
    setLoadingKey("genZ", false);
  }

  async function handleGenerateTAddr() {
    setLoadingKey("genT", true);
    try {
      const r = await devApi("generate_t_address");
      if (r.ok) addLog("success", `New transparent address: ${r.address}`);
      else addLog("error", `Failed: ${r.error}`);
    } catch (e: unknown) { addLog("error", `Error: ${e instanceof Error ? e.message : String(e)}`); }
    setLoadingKey("genT", false);
  }

  async function handleMineBlocks() {
    setLoadingKey("mine", true);
    try {
      const r = await devApi("mine_blocks", { count: parseInt(mineCount) });
      if (r.ok) addLog("success", `Mined ${r.blocks_mined} blocks → latest: ${shortAddr(r.last_hash ?? "", 8)}`);
      else addLog("error", `Mining failed: ${r.error}`);
    } catch (e: unknown) { addLog("error", `Error: ${e instanceof Error ? e.message : String(e)}`); }
    setLoadingKey("mine", false);
  }

  async function handleFundZAddr() {
    const addr = fundAddr.trim();
    if (!addr) { addLog("error", "Enter a Zcash address to fund"); return; }
    setLoadingKey("fund", true);
    try {
      const isShielded = addr.startsWith("zregtestsapling") || addr.startsWith("zs");
      const action = isShielded ? "fund_z_address" : "fund_t_address";
      const r = await devApi(action, { address: addr, amount: fundAmount });
      if (r.ok) {
        if (isShielded) {
          addLog("success", `Funding ${fundAmount} ZEC → ${shortAddr(addr, 12)} (op: ${r.operation_id})`);
          addLog("info", "Shielded tx takes ~1 min. Mine blocks to confirm.");
        } else {
          addLog("success", `Funded ${r.approximate_zec} ZEC → ${shortAddr(addr, 12)} (${r.blocks_mined} blocks mined)`);
        }
      } else addLog("error", `Funding failed: ${r.error}`);
    } catch (e: unknown) { addLog("error", `Error: ${e instanceof Error ? e.message : String(e)}`); }
    setLoadingKey("fund", false);
  }

  async function handleRefreshWalletInfo() {
    setLoadingKey("wallet", true);
    try {
      const r = await devApi("wallet_info");
      if (r.ok) {
        setWalletInfo(r);
        addLog("info", `Zcash: ${r.blocks} blocks | Balance: ${r.balance?.total ?? "?"} ZEC (${r.balance?.private ?? "?"} shielded)`);
      } else addLog("error", `Wallet info failed: ${r.error}`);
    } catch (e: unknown) { addLog("error", `Error: ${e instanceof Error ? e.message : String(e)}`); }
    setLoadingKey("wallet", false);
  }

  async function handleListZBalances() {
    setLoadingKey("listBal", true);
    try {
      const r = await devApi("list_balances");
      if (r.ok) {
        addLog("info", `Total: ${r.totals?.total ?? "?"} ZEC (${r.totals?.private ?? "?"} private, ${r.totals?.transparent ?? "?"} transparent)`);
        for (const b of (r.balances ?? [])) {
          if (parseFloat(b.balance) > 0) {
            addLog("info", `  ${shortAddr(b.address, 16)}: ${b.balance} ZEC`);
          }
        }
      } else addLog("error", `List balances failed: ${r.error}`);
    } catch (e: unknown) { addLog("error", `Error: ${e instanceof Error ? e.message : String(e)}`); }
    setLoadingKey("listBal", false);
  }

  // ── Starknet Tools ───────────────────────────────────────────────────────

  async function handleQueryContracts() {
    setLoadingKey("contracts", true);
    try {
      const p = getProvider();
      const lines: string[] = [];

      // Vault Registry
      if (starknetConfig.registryAddress) {
        const reg = new Contract({ abi: REGISTRY_ABI, address: starknetConfig.registryAddress, providerOrAccount: p });
        const count = Number(await reg.call("get_vault_count", []));
        lines.push(`VaultRegistry: ${count} vaults registered`);
      }

      // Pool
      if (starknetConfig.poolAddress) {
        const pool = new Contract({ abi: POOL_ABI, address: starknetConfig.poolAddress, providerOrAccount: p });
        const [active, capacity, deposited] = await Promise.all([
          pool.call("get_active_vault_count", []),
          pool.call("get_pool_capacity", []),
          pool.call("get_total_deposited", []),
        ]);
        lines.push(`VaultPool: ${Number(active)} active | capacity: ${formatZec(BigInt(String(capacity)))} | deposited: ${formatZec(BigInt(String(deposited)))}`);
      }

      // Relay
      if (starknetConfig.relayAddress) {
        const relay = new Contract({ abi: RELAY_ABI, address: starknetConfig.relayAddress, providerOrAccount: p });
        const [tip, fin, hdrCount] = await Promise.all([
          relay.call("get_chain_tip", []),
          relay.call("get_finalized_height", []),
          relay.call("get_header_count", []),
        ]);
        lines.push(`ZcashRelay: tip=${Number(tip)} | finalized=${Number(fin)} | headers=${Number(hdrCount)}`);
      }

      // Bridge
      if (starknetConfig.bridgeAddress) {
        const bridge = new Contract({ abi: BRIDGE_ABI, address: starknetConfig.bridgeAddress, providerOrAccount: p });
        const [issueCount, redeemCount] = await Promise.all([
          bridge.call("get_issue_count", []),
          bridge.call("get_redeem_count", []),
        ]);
        lines.push(`BridgeProtocol: ${Number(issueCount)} issues | ${Number(redeemCount)} redeems`);
      }

      // wZEC
      if (starknetConfig.wzecAddress) {
        const wzec = new Contract({ abi: WZEC_ABI, address: starknetConfig.wzecAddress, providerOrAccount: p });
        const supply = BigInt(String(await wzec.call("total_supply", [])));
        lines.push(`wZEC Token: supply=${formatZec(supply)}`);
      }

      for (const l of lines) addLog("info", l);
    } catch (e: unknown) { addLog("error", `Contract query failed: ${e instanceof Error ? e.message : String(e)}`); }
    setLoadingKey("contracts", false);
  }

  async function handleCheckWzecBalances() {
    setLoadingKey("wzecBals", true);
    try {
      const p = getProvider();
      if (!starknetConfig.wzecAddress) { addLog("error", "wZEC not deployed"); return; }
      const wzec = new Contract({ abi: WZEC_ABI, address: starknetConfig.wzecAddress, providerOrAccount: p });

      for (const acct of accounts) {
        const bal = BigInt(String(await wzec.call("balance_of", [acct.address])));
        if (bal > 0n) {
          addLog("info", `${acct.label}: ${formatZec(bal)} wZEC`);
        }
      }
      addLog("info", "wZEC balance scan complete. (Only non-zero shown)");
    } catch (e: unknown) { addLog("error", `wZEC scan failed: ${e instanceof Error ? e.message : String(e)}`); }
    setLoadingKey("wzecBals", false);
  }

  // ── Relay Seeding ───────────────────────────────────────────────────────

  async function handleSeedRelay() {
    setLoadingKey("seedRelay", true);
    addLog("info", "Seeding relay with Zcash block headers...");
    try {
      const p = getProvider();
      if (!starknetConfig.relayAddress) { addLog("error", "Relay contract not deployed"); return; }

      // Check current relay state  
      const relay = new Contract({ abi: RELAY_ABI, address: starknetConfig.relayAddress, providerOrAccount: p });
      const currentTip = Number(await relay.call("get_chain_tip", []));
      const startHeight = currentTip + 1;

      addLog("info", `Relay tip: ${currentTip}, starting from block ${startHeight}`);

      // Use deployer account (authorized relayer)
      const deployerAcct = accounts.find(a => a.label?.toLowerCase().includes("deployer"));
      if (!deployerAcct) { addLog("error", "Deployer account not found"); return; }
      const deployer = new Account({ provider: p, address: deployerAcct.address, signer: deployerAcct.private_key });

      // Fetch headers from Zcash
      const batchSize = 20;
      const { headers } = await devApi("get_block_headers", { start: startHeight, count: batchSize });
      if (!headers || headers.length === 0) {
        addLog("error", `No Zcash blocks at height ${startHeight}. Mine some blocks first.`);
        return;
      }

      addLog("info", `Fetched ${headers.length} Zcash headers (${startHeight} to ${startHeight + headers.length - 1})`);

      let submitted = 0;
      let skipped = 0;
      for (const hdr of headers) {
        try {
          const cairoHeader = {
            version: "0x" + Number(hdr.version).toString(16),
            prev_block_hash: hdr.prev_block_hash !== "0" ? "0x" + String(hdr.prev_block_hash).slice(0, 62) : "0x0",
            merkle_root: "0x" + String(hdr.merkle_root).slice(0, 62),
            commitment_root: "0x" + String(hdr.commitment_root).slice(0, 62),
            timestamp: String(hdr.timestamp),
            bits: "0x" + String(hdr.bits),
            nonce: "0x" + String(hdr.nonce).slice(0, 62),
            block_height: String(hdr.height),
          };

          const tx = await deployer.execute({
            contractAddress: starknetConfig.relayAddress,
            entrypoint: "submit_header",
            calldata: CallData.compile({ header: cairoHeader }),
          });
          await p.waitForTransaction(tx.transaction_hash);
          submitted++;
        } catch {
          skipped++; // Fee estimation failures on devnet are intermittent
        }
      }

      const newTip = Number(await relay.call("get_chain_tip", []));
      const newFin = Number(await relay.call("get_finalized_height", []));
      addLog("success", `Relay seeded: ${submitted} headers submitted, ${skipped} skipped → tip=${newTip}, finalized=${newFin}`);
    } catch (e: unknown) { addLog("error", `Seed relay failed: ${e instanceof Error ? e.message : String(e)}`); }
    setLoadingKey("seedRelay", false);
  }

  // ── Simulation Scripts ───────────────────────────────────────────────────

  async function handleSimulateIssues() {
    const count = Math.min(parseInt(simCount) || 1, 10);
    const amt = parseFloat(simIssueAmt) || 0.5;
    const zatoshi = Math.floor(amt * 1e8);

    setLoadingKey("simIssue", true);
    addLog("info", `Starting ${count} issue simulation(s)... (${amt} ZEC each)`);

    const signer = wallet.getSigner() ?? getAccount();
    if (!signer) { addLog("error", "No wallet connected"); setLoadingKey("simIssue", false); return; }
    if (!starknetConfig.bridgeAddress) { addLog("error", "Bridge not deployed"); setLoadingKey("simIssue", false); return; }

    const finalized = await findFinalizedBlock();
    if (!finalized) { addLog("error", "No finalized blocks in relay — start relayer first"); setLoadingKey("simIssue", false); return; }

    const p = getProvider();
    const bridge = new Contract({ abi: BRIDGE_ABI, address: starknetConfig.bridgeAddress, providerOrAccount: p });

    for (let i = 0; i < count; i++) {
      try {
        addLog("pending", `Issue ${i + 1}/${count}: Step 1/3 — request_lock...`);

        // Step 1: request_lock
        const tx1 = await signer.execute({
          contractAddress: starknetConfig.bridgeAddress,
          entrypoint: "request_lock",
          calldata: CallData.compile({
            mint_amount: { low: String(zatoshi), high: "0" },
            warranty_collateral: { low: "10000000", high: "0" },
          }),
        });
        await signer.waitForTransaction(tx1.transaction_hash);

        // Get request_id
        const receipt = await p.getTransactionReceipt(tx1.transaction_hash);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const events = (receipt as any)?.events ?? [];
        let requestId = "0x0";
        if (events.length > 0 && events[0].keys?.length > 1) requestId = events[0].keys[1];
        else if (events.length > 0 && events[0].data?.length > 0) requestId = events[0].data[0];

        if (requestId === "0x0") { addLog("error", `Issue ${i + 1}: Could not extract request_id`); continue; }

        // Read vault_id
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const req: any = await bridge.call("get_issue_request", [requestId]);
        const vaultId = Number(req[2] ?? 0);

        // Step 2: submit_mint
        addLog("pending", `Issue ${i + 1}/${count}: Step 2/3 — submit_mint...`);
        const tx2 = await signer.execute({
          contractAddress: starknetConfig.bridgeAddress,
          entrypoint: "submit_mint",
          calldata: CallData.compile({
            request_id: requestId,
            note_commitment: finalized.commitmentRoot,
            inclusion_proof: [],
            block_height: finalized.height,
            note_ciphertext_hash: "0x" + BigInt(Date.now() + i).toString(16),
            zk_proof: ["0x1", "0x2"],
          }),
        });
        await signer.waitForTransaction(tx2.transaction_hash);

        // Step 3: confirm_issue as vault operator
        addLog("pending", `Issue ${i + 1}/${count}: Step 3/3 — confirm_issue (vault #${vaultId + 1})...`);
        const vaultAcct = accounts[vaultId + 1];
        if (!vaultAcct) { addLog("error", `Issue ${i + 1}: Vault operator account not found`); continue; }

        const vaultOperator = new Account({
          provider: getProvider(),
          address: vaultAcct.address,
          signer: vaultAcct.private_key,
        });

        const tx3 = await vaultOperator.execute({
          contractAddress: starknetConfig.bridgeAddress,
          entrypoint: "confirm_issue",
          calldata: CallData.compile({ request_id: requestId }),
        });
        await vaultOperator.waitForTransaction(tx3.transaction_hash);

        addLog("success", `Issue ${i + 1}/${count}: Complete! ${amt} ZEC → wZEC minted. Vault #${vaultId + 1}. TX: ${shortAddr(tx3.transaction_hash, 8)}`);
      } catch (e: unknown) {
        const { message } = friendlyTxError(e);
        addLog("error", `Issue ${i + 1}/${count}: Failed — ${message}`);
      }
    }
    setLoadingKey("simIssue", false);
    addLog("info", `Issue simulation complete.`);
  }

  async function handleSimulateIssueAndRedeem() {
    const amt = parseFloat(simIssueAmt) || 0.5;
    const zatoshi = Math.floor(amt * 1e8);

    setLoadingKey("simCycle", true);
    addLog("info", `Starting full Issue→Redeem cycle (${amt} ZEC)...`);

    const signer = wallet.getSigner() ?? getAccount();
    if (!signer) { addLog("error", "No wallet connected"); setLoadingKey("simCycle", false); return; }
    if (!starknetConfig.bridgeAddress) { addLog("error", "Bridge not deployed"); setLoadingKey("simCycle", false); return; }

    const finalized = await findFinalizedBlock();
    if (!finalized) { addLog("error", "No finalized blocks — start relayer first"); setLoadingKey("simCycle", false); return; }

    const p = getProvider();
    const bridge = new Contract({ abi: BRIDGE_ABI, address: starknetConfig.bridgeAddress, providerOrAccount: p });

    try {
      // ── Issue Phase ──────────────────────────────────────────────
      addLog("pending", "ISSUE: Step 1/3 — request_lock...");
      const tx1 = await signer.execute({
        contractAddress: starknetConfig.bridgeAddress,
        entrypoint: "request_lock",
        calldata: CallData.compile({
          mint_amount: { low: String(zatoshi), high: "0" },
          warranty_collateral: { low: "10000000", high: "0" },
        }),
      });
      await signer.waitForTransaction(tx1.transaction_hash);

      const receipt1 = await p.getTransactionReceipt(tx1.transaction_hash);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events1 = (receipt1 as any)?.events ?? [];
      let reqId = "0x0";
      if (events1.length > 0 && events1[0].keys?.length > 1) reqId = events1[0].keys[1];
      else if (events1.length > 0 && events1[0].data?.length > 0) reqId = events1[0].data[0];

      if (reqId === "0x0") { addLog("error", "Could not extract issue request_id"); setLoadingKey("simCycle", false); return; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const issueReq: any = await bridge.call("get_issue_request", [reqId]);
      const vaultId = Number(issueReq[2] ?? 0);

      addLog("pending", "ISSUE: Step 2/3 — submit_mint...");
      const tx2 = await signer.execute({
        contractAddress: starknetConfig.bridgeAddress,
        entrypoint: "submit_mint",
        calldata: CallData.compile({
          request_id: reqId,
          note_commitment: finalized.commitmentRoot,
          inclusion_proof: [],
          block_height: finalized.height,
          note_ciphertext_hash: "0x" + BigInt(Date.now()).toString(16),
          zk_proof: ["0x1", "0x2"],
        }),
      });
      await signer.waitForTransaction(tx2.transaction_hash);

      addLog("pending", `ISSUE: Step 3/3 — confirm_issue (vault #${vaultId + 1})...`);
      const vaultAcct = accounts[vaultId + 1];
      if (!vaultAcct) { addLog("error", `Vault operator not found for vault #${vaultId + 1}`); setLoadingKey("simCycle", false); return; }
      const vaultOp = new Account({ provider: getProvider(), address: vaultAcct.address, signer: vaultAcct.private_key });

      const tx3 = await vaultOp.execute({
        contractAddress: starknetConfig.bridgeAddress,
        entrypoint: "confirm_issue",
        calldata: CallData.compile({ request_id: reqId }),
      });
      await vaultOp.waitForTransaction(tx3.transaction_hash);
      addLog("success", `ISSUE: Complete! ${formatZec(BigInt(zatoshi))} → wZEC minted. TX: ${shortAddr(tx3.transaction_hash, 8)}`);

      // ── Redeem Phase ─────────────────────────────────────────────
      addLog("pending", "REDEEM: Step 1/2 — submit_burn...");
      const redeemTx = await signer.execute({
        contractAddress: starknetConfig.bridgeAddress,
        entrypoint: "submit_burn",
        calldata: CallData.compile({
          note_commitment: finalized.commitmentRoot,
          note_ciphertext_hash: "0x" + BigInt(Date.now() + 1).toString(16),
          burn_amount: { low: String(zatoshi), high: "0" },
          warranty_collateral: { low: "10000000", high: "0" },
          zk_proof: ["0x1", "0x2"],
        }),
      });
      await signer.waitForTransaction(redeemTx.transaction_hash);

      const receipt2 = await p.getTransactionReceipt(redeemTx.transaction_hash);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events2 = (receipt2 as any)?.events ?? [];
      let redeemReqId = "0x0";
      if (events2.length > 0 && events2[0].keys?.length > 1) redeemReqId = events2[0].keys[1];
      else if (events2.length > 0 && events2[0].data?.length > 0) redeemReqId = events2[0].data[0];

      if (redeemReqId === "0x0") { addLog("error", "Could not extract redeem request_id"); setLoadingKey("simCycle", false); return; }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const redeemReq: any = await bridge.call("get_redeem_request", [redeemReqId]);
      const rvaultId = Number(redeemReq[2] ?? 0);

      addLog("pending", `REDEEM: Step 2/2 — confirm_redeem (vault #${rvaultId + 1})...`);
      const rvaultAcct = accounts[rvaultId + 1];
      if (!rvaultAcct) { addLog("error", `Vault operator not found`); setLoadingKey("simCycle", false); return; }
      const rvaultOp = new Account({ provider: getProvider(), address: rvaultAcct.address, signer: rvaultAcct.private_key });

      const confirmRedeemTx = await rvaultOp.execute({
        contractAddress: starknetConfig.bridgeAddress,
        entrypoint: "confirm_redeem",
        calldata: CallData.compile({
          request_id: redeemReqId,
          inclusion_proof: [],
          block_height: finalized.height,
        }),
      });
      await rvaultOp.waitForTransaction(confirmRedeemTx.transaction_hash);

      addLog("success", `REDEEM: Complete! ${formatZec(BigInt(zatoshi))} wZEC burned. TX: ${shortAddr(confirmRedeemTx.transaction_hash, 8)}`);
      addLog("success", `Full Issue→Redeem cycle finished successfully!`);
    } catch (e: unknown) {
      const { message } = friendlyTxError(e);
      addLog("error", `Cycle failed: ${message}`);
    }
    setLoadingKey("simCycle", false);
  }

  async function handleDirectMintWzec() {
    setLoadingKey("directMint", true);
    const amt = parseFloat(simIssueAmt) || 0.5;
    const zatoshi = Math.floor(amt * 1e8);

    try {
      if (!starknetConfig.wzecAddress) { addLog("error", "wZEC not deployed"); return; }
      if (!account) { addLog("error", "No account selected"); return; }

      // Use deployer (account 0) as mint authority
      const deployer = accounts[0];
      if (!deployer) { addLog("error", "Deployer account not found"); return; }

      const deployerSigner = new Account({
        provider: getProvider(),
        address: deployer.address,
        signer: deployer.private_key,
      });

      addLog("pending", `Minting ${formatZec(BigInt(zatoshi))} wZEC to ${account.label}...`);

      const tx = await deployerSigner.execute({
        contractAddress: starknetConfig.wzecAddress,
        entrypoint: "mint",
        calldata: CallData.compile({
          to: account.address,
          amount: { low: String(zatoshi), high: "0" },
        }),
      });
      await deployerSigner.waitForTransaction(tx.transaction_hash);

      addLog("success", `Minted ${formatZec(BigInt(zatoshi))} wZEC → ${account.label}. TX: ${shortAddr(tx.transaction_hash, 8)}`);
    } catch (e: unknown) {
      const { message } = friendlyTxError(e);
      addLog("error", `Direct mint failed: ${message}`);
    }
    setLoadingKey("directMint", false);
  }

  // Load wallet info on mount
  useEffect(() => { handleRefreshWalletInfo(); }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-yellow-500/10 border border-yellow-500/30">
            <Wrench className="h-5 w-5 text-yellow-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Dev Tools</h1>
            <p className="text-sm text-gray-400">Devnet utilities for testing and debugging</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400/80 bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-3 py-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>These tools only work on local devnet (starknet-devnet + zcashd regtest). Not for production use.</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column — Toolboxes */}
        <div className="lg:col-span-2 space-y-6">

          {/* ── Zcash Devnet Tools ──────────────────────────────────── */}
          <section className="card p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Coins className="h-5 w-5 text-brand-primary" />
              Zcash Regtest Tools
            </h2>
            <div className="space-y-4">
              {/* Address Generation */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-2">Address Generation</h3>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={handleGenerateZAddr} disabled={loading.genZ} className="btn-primary text-sm flex items-center gap-2">
                    {loading.genZ ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    New Shielded (z-addr)
                  </button>
                  <button onClick={handleGenerateTAddr} disabled={loading.genT} className="btn-secondary text-sm flex items-center gap-2">
                    {loading.genT ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    New Transparent (t-addr)
                  </button>
                </div>
              </div>

              {/* Mining */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-2">Block Mining</h3>
                <div className="flex gap-2 items-center">
                  <input
                    type="number" min="1" max="200" value={mineCount}
                    onChange={e => setMineCount(e.target.value)}
                    className="input-field w-20 text-sm"
                  />
                  <button onClick={handleMineBlocks} disabled={loading.mine} className="btn-primary text-sm flex items-center gap-2">
                    {loading.mine ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pickaxe className="h-4 w-4" />}
                    Mine Blocks
                  </button>
                </div>
              </div>

              {/* Funding */}
              <div>
                <h3 className="text-sm font-medium text-gray-300 mb-2">Fund Address</h3>
                <div className="space-y-2">
                  <input
                    type="text" value={fundAddr}
                    onChange={e => setFundAddr(e.target.value)}
                    placeholder="Zcash address (t-addr or z-addr)"
                    className="input-field w-full text-sm"
                  />
                  <div className="flex gap-2 items-center">
                    <input
                      type="number" min="0.001" step="0.1" value={fundAmount}
                      onChange={e => setFundAmount(e.target.value)}
                      className="input-field w-24 text-sm"
                    />
                    <span className="text-xs text-gray-400">ZEC</span>
                    <button onClick={handleFundZAddr} disabled={loading.fund} className="btn-primary text-sm flex items-center gap-2">
                      {loading.fund ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                      Fund
                    </button>
                  </div>
                  {/* Quick-fill vault addresses */}
                  <div className="flex flex-wrap gap-1">
                    {accounts.filter(a => a.zcash_shielded).slice(0, 4).map(a => (
                      <button key={a.address} onClick={() => setFundAddr(a.zcash_shielded ?? "")}
                        className="text-xs px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-400">
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Info */}
              <div className="flex gap-2 flex-wrap">
                <button onClick={handleRefreshWalletInfo} disabled={loading.wallet} className="btn-secondary text-sm flex items-center gap-2">
                  {loading.wallet ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Wallet Info
                </button>
                <button onClick={handleListZBalances} disabled={loading.listBal} className="btn-secondary text-sm flex items-center gap-2">
                  {loading.listBal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                  List All Balances
                </button>
              </div>
            </div>
          </section>

          {/* ── Starknet Contract Tools ─────────────────────────────── */}
          <section className="card p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Zap className="h-5 w-5 text-brand-secondary" />
              Starknet Contract Tools
            </h2>
            <div className="flex gap-2 flex-wrap">
              <button onClick={handleQueryContracts} disabled={loading.contracts} className="btn-primary text-sm flex items-center gap-2">
                {loading.contracts ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Query All Contracts
              </button>
              <button onClick={handleCheckWzecBalances} disabled={loading.wzecBals} className="btn-secondary text-sm flex items-center gap-2">
                {loading.wzecBals ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                wZEC Balances (All Accounts)
              </button>
              <button onClick={handleDirectMintWzec} disabled={loading.directMint} className="btn-secondary text-sm flex items-center gap-2">
                {loading.directMint ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coins className="h-4 w-4" />}
                Direct Mint wZEC → Current Account
              </button>
              <button onClick={handleSeedRelay} disabled={loading.seedRelay} className="btn-secondary text-sm flex items-center gap-2">
                {loading.seedRelay ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pickaxe className="h-4 w-4" />}
                Seed Relay (Submit Zcash Headers)
              </button>
            </div>
            <div className="mt-3 text-xs text-gray-500">
              Contract addresses: Bridge={shortAddr(starknetConfig.bridgeAddress)} | Registry={shortAddr(starknetConfig.registryAddress)} | Relay={shortAddr(starknetConfig.relayAddress)}
            </div>
          </section>

          {/* ── Simulation Scripts ──────────────────────────────────── */}
          <section className="card p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Play className="h-5 w-5 text-brand-green" />
              Simulation Scripts
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              Run multi-step protocol simulations using the currently selected devnet account.
              These execute full Issue/Redeem flows with auto-completion (vault operator steps included).
            </p>

            <div className="space-y-4">
              {/* Config */}
              <div className="flex gap-4 items-center flex-wrap">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400">Count:</label>
                  <input type="number" min="1" max="10" value={simCount}
                    onChange={e => setSimCount(e.target.value)} className="input-field w-16 text-sm" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400">Amount:</label>
                  <input type="number" min="0.01" step="0.1" value={simIssueAmt}
                    onChange={e => setSimIssueAmt(e.target.value)} className="input-field w-20 text-sm" />
                  <span className="text-xs text-gray-400">ZEC</span>
                </div>
                <div className="text-xs text-gray-500">
                  Account: <span className="text-gray-300">{account?.label ?? "None"}</span>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-2 flex-wrap">
                <button onClick={handleSimulateIssues} disabled={loading.simIssue} className="btn-primary text-sm flex items-center gap-2">
                  {loading.simIssue ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
                  Run {simCount}x Issue (ZEC→wZEC)
                </button>
                <button onClick={handleSimulateIssueAndRedeem} disabled={loading.simCycle} className="btn-secondary text-sm flex items-center gap-2">
                  {loading.simCycle ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Run Issue→Redeem Cycle
                </button>
              </div>
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <Info className="h-3 w-3" />
                Requires: connected account, deployed contracts, relay with finalized blocks.
              </div>
            </div>
          </section>

          {/* ── Quick Reference ─────────────────────────────────────── */}
          <section className="card p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Terminal className="h-5 w-5 text-gray-400" />
              Devnet Accounts Reference
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-brand-border text-gray-400">
                    <th className="text-left py-2 pr-4">#</th>
                    <th className="text-left py-2 pr-4">Label</th>
                    <th className="text-left py-2 pr-4">Starknet Address</th>
                    <th className="text-left py-2">Zcash Shielded</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a, i) => (
                    <tr key={a.address} className="border-b border-brand-border/50 hover:bg-white/5">
                      <td className="py-1.5 pr-4 text-gray-500">{i}</td>
                      <td className="py-1.5 pr-4 text-gray-300">{a.label}</td>
                      <td className="py-1.5 pr-4 font-mono text-gray-400">
                        {shortAddr(a.address, 6)} <CopyBtn text={a.address} />
                      </td>
                      <td className="py-1.5 font-mono text-gray-400">
                        {a.zcash_shielded ? (<>{shortAddr(a.zcash_shielded, 10)} <CopyBtn text={a.zcash_shielded} /></>) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Right Column — Log Console */}
        <div className="lg:col-span-1">
          <div className="card p-4 sticky top-20">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                Console
              </h2>
              <button onClick={() => setLogs([])} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
                Clear
              </button>
            </div>
            <div className="h-[calc(100vh-12rem)] overflow-y-auto space-y-1 font-mono text-xs">
              {logs.length === 0 && (
                <div className="text-gray-600 text-center py-8">No logs yet. Run a tool to see output.</div>
              )}
              {logs.map(log => (
                <div key={log.id} className={`flex gap-2 py-0.5 ${
                  log.type === "error" ? "text-red-400" :
                  log.type === "success" ? "text-green-400" :
                  log.type === "pending" ? "text-yellow-400" :
                  "text-gray-400"
                }`}>
                  <span className="text-gray-600 flex-shrink-0">{log.time}</span>
                  <span className="flex-shrink-0">
                    {log.type === "success" ? <CheckCircle2 className="h-3 w-3 inline" /> :
                     log.type === "error" ? <XCircle className="h-3 w-3 inline" /> :
                     log.type === "pending" ? <Loader2 className="h-3 w-3 inline animate-spin" /> :
                     <Info className="h-3 w-3 inline" />}
                  </span>
                  <span className="break-all">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Wallet info summary bar */}
      {walletInfo && (
        <div className="mt-6 card p-4">
          <div className="flex flex-wrap gap-6 text-xs text-gray-400">
            <div>Zcash Blocks: <span className="text-gray-200">{String(walletInfo.blocks)}</span></div>
            <div>Total ZEC: <span className="text-gray-200">{(walletInfo.balance as Record<string, string>)?.total ?? "?"}</span></div>
            <div>Private ZEC: <span className="text-gray-200">{(walletInfo.balance as Record<string, string>)?.private ?? "?"}</span></div>
            <div>Transparent ZEC: <span className="text-gray-200">{(walletInfo.balance as Record<string, string>)?.transparent ?? "?"}</span></div>
            <div>Shielded Addrs: <span className="text-gray-200">{Array.isArray(walletInfo.shielded_addresses) ? walletInfo.shielded_addresses.length : "?"}</span></div>
          </div>
        </div>
      )}
    </div>
  );
}
