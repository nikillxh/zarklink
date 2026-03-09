"use client";

import { useState } from "react";
import {
  BookOpen,
  ArrowLeftRight,
  Shield,
  Radio,
  Zap,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Coins,
  Users,
  Lock,
  Wrench,
} from "lucide-react";
import Link from "next/link";

// ── Collapsible Section ──────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, defaultOpen = false }: {
  title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 p-5 text-left hover:bg-white/5 transition-colors">
        <Icon className="h-5 w-5 text-brand-primary flex-shrink-0" />
        <span className="text-lg font-semibold flex-1">{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-brand-border">{children}</div>}
    </div>
  );
}

function StepCard({ step, title, description, actor }: {
  step: number; title: string; description: string; actor: string;
}) {
  return (
    <div className="flex gap-4 items-start">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-primary/10 border border-brand-primary/30 text-brand-primary font-bold text-sm flex-shrink-0">
        {step}
      </div>
      <div>
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-sm text-gray-400 mt-0.5">{description}</div>
        <div className="text-xs text-gray-500 mt-1">Actor: <span className="text-gray-400">{actor}</span></div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 border border-brand-primary/30">
            <BookOpen className="h-5 w-5 text-brand-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Protocol Documentation</h1>
            <p className="text-sm text-gray-400">How Zarklink works and how to use it</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {/* ── Overview ──────────────────────────────────────────────── */}
        <Section title="What is Zarklink?" icon={Zap} defaultOpen={true}>
          <div className="mt-4 space-y-4 text-sm text-gray-300 leading-relaxed">
            <p>
              <strong className="text-foreground">Zarklink</strong> is a <strong>trustless, privacy-preserving cross-chain bridge</strong> between
              Zcash and Starknet. It lets you move ZEC value across chains by creating a wrapped token
              called <strong>wZEC</strong> on Starknet.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-white/5 rounded-lg p-3 border border-brand-border">
                <div className="font-medium text-brand-primary mb-1">Issue (ZEC → wZEC)</div>
                <div className="text-xs text-gray-400">Lock ZEC on Zcash, mint equivalent wZEC on Starknet. Use wZEC in Starknet DeFi.</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3 border border-brand-border">
                <div className="font-medium text-brand-secondary mb-1">Redeem (wZEC → ZEC)</div>
                <div className="text-xs text-gray-400">Burn wZEC on Starknet, unlock ZEC on Zcash. Get your ZEC back privately.</div>
              </div>
            </div>

            <div className="bg-brand-dark/50 rounded-lg p-4 border border-brand-border">
              <h4 className="font-medium text-foreground mb-2">Key Properties</h4>
              <ul className="space-y-1.5 text-xs text-gray-400">
                <li className="flex items-start gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-brand-green mt-0.5 flex-shrink-0" /> <span><strong className="text-gray-300">Trustless:</strong> No central authority. Vaults are economically bonded with collateral.</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-brand-green mt-0.5 flex-shrink-0" /> <span><strong className="text-gray-300">Privacy-Preserving:</strong> Transfer amounts hidden via zk-SNARKs + splitting strategy.</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-brand-green mt-0.5 flex-shrink-0" /> <span><strong className="text-gray-300">Censorship-Resistant:</strong> Anyone can become a vault by posting collateral.</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-brand-green mt-0.5 flex-shrink-0" /> <span><strong className="text-gray-300">Fraud-Provable:</strong> Challenge mechanism with on-chain zk-SNARK verification.</span></li>
              </ul>
            </div>

            <p className="text-xs text-gray-500">
              Based on the <a href="https://arxiv.org/abs/2204.10611" target="_blank" rel="noopener noreferrer" className="text-brand-primary hover:underline inline-flex items-center gap-1">ZCLAIM framework <ExternalLink className="h-3 w-3" /></a> (Sanchez et al., 2022).
            </p>
          </div>
        </Section>

        {/* ── Actors ──────────────────────────────────────────────── */}
        <Section title="Protocol Actors" icon={Users}>
          <div className="mt-4 space-y-3">
            {[
              { name: "Issuer", desc: "Locks ZEC on Zcash → receives wZEC on Starknet. Initiates the Issue flow.", color: "text-brand-primary" },
              { name: "Redeemer", desc: "Burns wZEC on Starknet → receives ZEC on Zcash. Initiates the Redeem flow.", color: "text-brand-secondary" },
              { name: "Vault Operator", desc: "Non-trusted custodian. Locks collateral on Starknet, safekeeps ZEC, processes issue/redeem requests.", color: "text-yellow-400" },
              { name: "Relayer", desc: "Bridges Zcash block headers to Starknet by submitting them to the relay contract.", color: "text-blue-400" },
              { name: "Oracle", desc: "Provides ZEC/STRK exchange rate for collateral calculations.", color: "text-purple-400" },
            ].map(a => (
              <div key={a.name} className="flex gap-3 items-start bg-white/5 rounded-lg p-3 border border-brand-border">
                <div className={`font-medium text-sm ${a.color} min-w-[100px]`}>{a.name}</div>
                <div className="text-xs text-gray-400">{a.desc}</div>
              </div>
            ))}

            <div className="mt-3 text-xs text-gray-500">
              On devnet, all roles are pre-configured: accounts 1-8 are vault operators, account 9 is the Issuer (Alice),
              account 10 is the Redeemer (Dave), account 11 is the Relayer, account 12 is the Oracle.
            </div>
          </div>
        </Section>

        {/* ── Issue Flow ──────────────────────────────────────────── */}
        <Section title="Issue Flow (ZEC → wZEC)" icon={ArrowLeftRight}>
          <div className="mt-4 space-y-6">
            <p className="text-sm text-gray-300">
              The Issue flow mints new wZEC on Starknet, backed by ZEC locked on Zcash.
              It requires 3 on-chain steps:
            </p>

            <div className="space-y-5">
              <StepCard step={1} title="request_lock" actor="Issuer"
                description="The issuer requests a lock permit from the BridgeProtocol. The VaultPool assigns a vault. A request ID is returned, and the vault's collateral is encumbered (locked)." />
              <StepCard step={2} title="submit_mint" actor="Issuer"
                description="The issuer proves they locked ZEC on Zcash by submitting a note commitment and a Merkle inclusion proof referencing a finalized Zcash block. The relay contract verifies the proof." />
              <StepCard step={3} title="confirm_issue" actor="Vault Operator"
                description="The vault operator confirms the issue. The BridgeProtocol mints wZEC to the issuer's Starknet address and releases the encumbered collateral." />
            </div>

            <div className="bg-brand-primary/5 border border-brand-primary/20 rounded-lg p-4">
              <h4 className="text-sm font-medium text-brand-primary mb-2">What Happens Under the Hood</h4>
              <div className="text-xs text-gray-400 space-y-1">
                <p>1. <code className="text-gray-300">VaultPool.assign_request()</code> picks the best vault based on capacity and collateral ratio.</p>
                <p>2. <code className="text-gray-300">ZcashRelay.verify_inclusion()</code> checks the note commitment exists in a finalized Zcash block.</p>
                <p>3. <code className="text-gray-300">wZEC.mint()</code> creates new wZEC tokens equal to the locked ZEC minus protocol fees.</p>
                <p>4. A protocol fee (configurable, default 0.1%) is deducted from the minted amount.</p>
              </div>
            </div>

            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400/80 flex gap-2">
              <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <div>
                <strong>Timeout:</strong> If the issuer doesn't submit_mint within Δ_mint blocks, or the vault
                doesn't confirm within Δ_confirm_issue blocks, the request expires and collateral is returned.
              </div>
            </div>
          </div>
        </Section>

        {/* ── Redeem Flow ─────────────────────────────────────────── */}
        <Section title="Redeem Flow (wZEC → ZEC)" icon={ArrowLeftRight}>
          <div className="mt-4 space-y-6">
            <p className="text-sm text-gray-300">
              The Redeem flow burns wZEC on Starknet and releases ZEC on Zcash.
              It requires 2 on-chain steps:
            </p>

            <div className="space-y-5">
              <StepCard step={1} title="submit_burn" actor="Redeemer"
                description="The redeemer burns wZEC by calling submit_burn. The tokens are burned immediately, and a redeem request is created. The VaultPool assigns a vault to process the release." />
              <StepCard step={2} title="confirm_redeem" actor="Vault Operator"
                description="The vault sends ZEC to the redeemer's Zcash address, then confirms on Starknet with an inclusion proof. The vault's encumbered collateral is released." />
            </div>

            <div className="bg-brand-secondary/5 border border-brand-secondary/20 rounded-lg p-4">
              <h4 className="text-sm font-medium text-brand-secondary mb-2">What Happens Under the Hood</h4>
              <div className="text-xs text-gray-400 space-y-1">
                <p>1. <code className="text-gray-300">wZEC.burn()</code> destroys the redeemer's wZEC tokens.</p>
                <p>2. The vault operator sends ZEC on the Zcash chain (z_sendmany to redeemer's shielded address).</p>
                <p>3. <code className="text-gray-300">ZcashRelay.verify_inclusion()</code> confirms the ZEC transfer in a finalized block.</p>
                <p>4. Vault's collateral encumbrance is released, and the warranty is returned.</p>
              </div>
            </div>
          </div>
        </Section>

        {/* ── Smart Contracts ─────────────────────────────────────── */}
        <Section title="Smart Contracts (Cairo)" icon={Shield}>
          <div className="mt-4 space-y-4">
            {[
              {
                name: "BridgeProtocol", file: "bridge_protocol.cairo",
                desc: "Core state machine for Issue and Redeem flows. Manages requests, fee collection, challenge/expiry logic.",
                fns: ["request_lock", "submit_mint", "confirm_issue", "submit_burn", "confirm_redeem", "challenge_issue", "expire_issue"],
              },
              {
                name: "VaultRegistry", file: "vault_registry.cairo",
                desc: "Registration, collateral management, and lifecycle for vault operators.",
                fns: ["register_vault", "deposit_collateral", "get_vault", "slash_vault"],
              },
              {
                name: "VaultPool", file: "vault_pool.cairo",
                desc: "Pooled collateral accounting and vault assignment for bridge requests.",
                fns: ["deposit_collateral", "assign_request", "encumber", "release_encumbrance"],
              },
              {
                name: "ZcashRelay", file: "zcash_relay.cairo",
                desc: "Zcash light client on Starknet. Stores block headers and verifies note inclusion proofs.",
                fns: ["submit_header", "submit_headers_batch", "verify_inclusion", "is_finalized"],
              },
              {
                name: "wZEC Token", file: "wzec_token.cairo",
                desc: "ERC-20 wrapped ZEC token. Only BridgeProtocol can mint/burn.",
                fns: ["mint", "burn", "transfer", "approve", "balance_of"],
              },
              {
                name: "Oracle", file: "oracle.cairo",
                desc: "TWAP price oracle with circuit breaker for ZEC/STRK exchange rate.",
                fns: ["get_rate", "update_rate"],
              },
            ].map(c => (
              <div key={c.name} className="bg-white/5 rounded-lg p-4 border border-brand-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-foreground text-sm">{c.name}</span>
                  <span className="text-xs text-gray-500 font-mono">{c.file}</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">{c.desc}</p>
                <div className="flex flex-wrap gap-1">
                  {c.fns.map(f => (
                    <span key={f} className="text-xs font-mono px-1.5 py-0.5 rounded bg-brand-dark border border-brand-border text-gray-400">{f}()</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Vault System ────────────────────────────────────────── */}
        <Section title="Vault System & Collateral" icon={Lock}>
          <div className="mt-4 space-y-4 text-sm text-gray-300 leading-relaxed">
            <p>
              Vaults are the custodians in the Zarklink protocol. They hold ZEC on Zcash and lock
              collateral on Starknet. The collateral ensures they cannot steal the ZEC — if they
              misbehave, their collateral is slashed.
            </p>

            <div className="bg-white/5 rounded-lg p-4 border border-brand-border">
              <h4 className="font-medium text-foreground mb-2 text-sm">Vault Lifecycle</h4>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {["Inactive (0)", "Active (1)", "Locked (2)", "Suspended (3)", "Liquidated (4)"].map((s, i) => (
                  <div key={s} className={`text-center rounded p-2 border ${
                    i === 1 ? "bg-green-500/10 border-green-500/30 text-green-400" :
                    i === 2 ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-400" :
                    i >= 3 ? "bg-red-500/10 border-red-500/30 text-red-400" :
                    "bg-white/5 border-brand-border text-gray-400"
                  }`}>{s}</div>
                ))}
              </div>
            </div>

            <div className="text-xs text-gray-400 space-y-1">
              <p><strong className="text-gray-300">Collateralization:</strong> Vaults must maintain ≥150% collateral relative to ZEC obligations.</p>
              <p><strong className="text-gray-300">Dual deposit:</strong> Collateral must be deposited to both VaultRegistry (for display/status) and VaultPool (for pool accounting).</p>
              <p><strong className="text-gray-300">Slashing:</strong> If a vault fails to confirm a request within the timeout, or is proven fraudulent, their collateral is slashed.</p>
            </div>
          </div>
        </Section>

        {/* ── Relay System ────────────────────────────────────────── */}
        <Section title="Zcash Relay (Light Client)" icon={Radio}>
          <div className="mt-4 space-y-4 text-sm text-gray-300 leading-relaxed">
            <p>
              The ZcashRelay contract acts as a Zcash light client on Starknet. The Relayer service
              continuously submits Zcash block headers, building a verified header chain on Starknet.
            </p>

            <div className="text-xs text-gray-400 space-y-2">
              <div className="bg-white/5 rounded-lg p-3 border border-brand-border">
                <strong className="text-gray-300">Finality Depth:</strong> 24 blocks (configurable).
                A block is considered &quot;finalized&quot; when it has at least 24 confirmations.
              </div>
              <div className="bg-white/5 rounded-lg p-3 border border-brand-border">
                <strong className="text-gray-300">Inclusion Proofs:</strong> To prove a ZEC note exists,
                the user provides a Merkle path from the note commitment to the block&apos;s commitment root,
                which is verified against the stored header data.
              </div>
              <div className="bg-white/5 rounded-lg p-3 border border-brand-border">
                <strong className="text-gray-300">Commitment Roots:</strong> Each Zcash block has a
                Sapling note commitment tree root. The relay stores these roots for finalized blocks,
                enabling on-chain verification of shielded transactions.
              </div>
            </div>
          </div>
        </Section>

        {/* ── Privacy ─────────────────────────────────────────────── */}
        <Section title="Privacy & Splitting Strategy" icon={Shield}>
          <div className="mt-4 space-y-4 text-sm text-gray-300 leading-relaxed">
            <p>
              A key privacy feature is the <strong>splitting strategy</strong>. Instead of sending
              a full amount through a single vault (which would reveal the amount to that vault),
              Zarklink splits transfers across multiple vaults.
            </p>

            <div className="bg-white/5 rounded-lg p-4 border border-brand-border text-xs text-gray-400">
              <h4 className="font-medium text-foreground mb-2 text-sm">How Splitting Works</h4>
              <ol className="space-y-1.5 list-decimal list-inside">
                <li>The total amount is decomposed into pieces that are powers of 2.</li>
                <li>Each piece is sent through a different vault (up to k=16 vaults).</li>
                <li>Random padding (zero-value pieces) makes the number of pieces uniform.</li>
                <li>No single vault knows the total transfer amount.</li>
              </ol>
            </div>

            <p className="text-xs text-gray-500">
              <strong>Privacy Guarantee (Theorem V.4):</strong> For any piece received by a vault,
              the posterior probability of the total amount is bounded by a constant factor of the
              prior, meaning no vault gains significant information about the full transfer.
            </p>
          </div>
        </Section>

        {/* ── How to Use ──────────────────────────────────────────── */}
        <Section title="How to Use the Bridge" icon={Coins} defaultOpen={true}>
          <div className="mt-4 space-y-6">
            {/* Prerequisites */}
            <div>
              <h3 className="text-sm font-medium text-foreground mb-2">Prerequisites</h3>
              <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
                <li>Devnet running: <code className="text-gray-300">./scripts/start-devnet.sh --full-stack</code></li>
                <li>Contracts deployed (done automatically with --full-stack)</li>
                <li>At least one vault registered and funded (done automatically)</li>
                <li>Relayer running to submit Zcash headers (done automatically with --services)</li>
              </ul>
            </div>

            {/* Issue Steps */}
            <div>
              <h3 className="text-sm font-medium text-brand-primary mb-3">Issue ZEC → wZEC</h3>
              <div className="space-y-3">
                <div className="flex gap-3 items-start text-xs text-gray-400">
                  <span className="font-mono bg-brand-primary/10 text-brand-primary rounded px-1.5 py-0.5 text-[10px] flex-shrink-0">1</span>
                  <span>Go to the <Link href="/bridge" className="text-brand-primary hover:underline">Bridge</Link> page</span>
                </div>
                <div className="flex gap-3 items-start text-xs text-gray-400">
                  <span className="font-mono bg-brand-primary/10 text-brand-primary rounded px-1.5 py-0.5 text-[10px] flex-shrink-0">2</span>
                  <span>Select <strong className="text-gray-300">Issuer (Alice)</strong> from the account dropdown (account #9)</span>
                </div>
                <div className="flex gap-3 items-start text-xs text-gray-400">
                  <span className="font-mono bg-brand-primary/10 text-brand-primary rounded px-1.5 py-0.5 text-[10px] flex-shrink-0">3</span>
                  <span>Make sure <strong className="text-gray-300">Issue</strong> tab is selected</span>
                </div>
                <div className="flex gap-3 items-start text-xs text-gray-400">
                  <span className="font-mono bg-brand-primary/10 text-brand-primary rounded px-1.5 py-0.5 text-[10px] flex-shrink-0">4</span>
                  <span>Enter an amount (e.g. <code className="text-gray-300">0.5</code> ZEC)</span>
                </div>
                <div className="flex gap-3 items-start text-xs text-gray-400">
                  <span className="font-mono bg-brand-primary/10 text-brand-primary rounded px-1.5 py-0.5 text-[10px] flex-shrink-0">5</span>
                  <span>Click <strong className="text-gray-300">Issue wZEC</strong>. Watch the 3-step process complete automatically.</span>
                </div>
                <div className="flex gap-3 items-start text-xs text-gray-400">
                  <span className="font-mono bg-brand-primary/10 text-brand-primary rounded px-1.5 py-0.5 text-[10px] flex-shrink-0">6</span>
                  <span>Your wZEC balance updates in the balance card at the top.</span>
                </div>
              </div>
            </div>

            {/* Redeem Steps */}
            <div>
              <h3 className="text-sm font-medium text-brand-secondary mb-3">Redeem wZEC → ZEC</h3>
              <div className="space-y-3">
                <div className="flex gap-3 items-start text-xs text-gray-400">
                  <span className="font-mono bg-brand-secondary/10 text-brand-secondary rounded px-1.5 py-0.5 text-[10px] flex-shrink-0">1</span>
                  <span>On the Bridge page, switch to the <strong className="text-gray-300">Redeem</strong> tab</span>
                </div>
                <div className="flex gap-3 items-start text-xs text-gray-400">
                  <span className="font-mono bg-brand-secondary/10 text-brand-secondary rounded px-1.5 py-0.5 text-[10px] flex-shrink-0">2</span>
                  <span>Use the same account that has wZEC (Issuer Alice after an Issue)</span>
                </div>
                <div className="flex gap-3 items-start text-xs text-gray-400">
                  <span className="font-mono bg-brand-secondary/10 text-brand-secondary rounded px-1.5 py-0.5 text-[10px] flex-shrink-0">3</span>
                  <span>Click <strong className="text-gray-300">Max</strong> to fill your full wZEC balance, or enter a custom amount</span>
                </div>
                <div className="flex gap-3 items-start text-xs text-gray-400">
                  <span className="font-mono bg-brand-secondary/10 text-brand-secondary rounded px-1.5 py-0.5 text-[10px] flex-shrink-0">4</span>
                  <span>Click <strong className="text-gray-300">Redeem ZEC</strong>. The 2-step process completes automatically.</span>
                </div>
                <div className="flex gap-3 items-start text-xs text-gray-400">
                  <span className="font-mono bg-brand-secondary/10 text-brand-secondary rounded px-1.5 py-0.5 text-[10px] flex-shrink-0">5</span>
                  <span>Your wZEC balance decreases. On mainnet, you&apos;d receive ZEC in your Zcash wallet.</span>
                </div>
              </div>
            </div>

            {/* Dev Tips */}
            <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4">
              <h4 className="text-sm font-medium text-yellow-400 mb-2 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Developer Notes
              </h4>
              <ul className="text-xs text-yellow-400/70 space-y-1 list-disc list-inside">
                <li>On devnet, the frontend auto-completes all steps (including vault operator actions).</li>
                <li>In production, the vault daemon would handle Steps 2-3 of Issue and Step 2 of Redeem.</li>
                <li>The relayer must be running with finalized blocks for the bridge to work.</li>
                <li>You can simulate multiple transactions using the <Link href="/dev" className="text-yellow-400 hover:underline">Dev Tools</Link> page.</li>
                <li>Direct wZEC minting (for testing redeems) is available on the Dev Tools page.</li>
              </ul>
            </div>
          </div>
        </Section>

        {/* ── Architecture Diagram ────────────────────────────────── */}
        <Section title="Architecture Overview" icon={Zap}>
          <div className="mt-4">
            <pre className="text-xs text-gray-400 bg-brand-dark rounded-lg p-4 border border-brand-border overflow-x-auto leading-relaxed">{`
┌──────────────────────────────────────────────────────────────────┐
│                        STARKNET (L2)                             │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ BridgeProto  │  │ VaultReg     │  │ VaultPool    │           │
│  │              │  │ istry        │  │              │           │
│  │ request_lock │  │ register     │  │ deposit      │           │
│  │ submit_mint  │  │ deposit      │  │ assign       │           │
│  │ confirm_issue│  │ slash        │  │ encumber     │           │
│  │ submit_burn  │  └──────────────┘  └──────────────┘           │
│  │ confirm_redm │                                                │
│  └──────────────┘                                                │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ ZcashRelay   │  │ wZEC Token   │  │ Oracle       │           │
│  │              │  │ (ERC-20)     │  │ (TWAP)       │           │
│  │ submit_hdr   │  │ mint / burn  │  │ get_rate     │           │
│  │ verify_incl  │  │ transfer     │  │ update       │           │
│  │ is_finalized │  └──────────────┘  └──────────────┘           │
│  └──────────────┘                                                │
└──────────────────────────────────────────────────────────────────┘
        ▲                    ▲                    ▲
        │ headers            │ events             │ txns
        │                    │                    │
┌───────┴────────┐  ┌───────┴────────┐  ┌───────┴────────┐
│   Relayer      │  │ Vault Daemon   │  │   Frontend     │
│  (TypeScript)  │  │ (TypeScript)   │  │  (Next.js)     │
│                │  │                │  │                │
│ Zcash headers  │  │ Auto-confirm   │  │ Bridge UI      │
│ → relay        │  │ issue/redeem   │  │ Dev tools      │
└───────┬────────┘  └───────┬────────┘  └────────────────┘
        │                    │
        ▼                    ▼
┌─────────────────────────────────────────────────────────┐
│                   ZCASH (Sapling)                        │
│                                                         │
│  zcashd regtest — shielded addresses, z_sendmany        │
│  Block production, note commitments, merkle proofs      │
└─────────────────────────────────────────────────────────┘
`}</pre>
          </div>
        </Section>

        {/* ── Troubleshooting ─────────────────────────────────────── */}
        <Section title="Troubleshooting" icon={AlertTriangle}>
          <div className="mt-4 space-y-3">
            {[
              {
                q: "\"No active vaults in pool\"",
                a: "No vault is registered. Run: ./scripts/start-devnet.sh --services"
              },
              {
                q: "\"Insufficient wZEC balance\"",
                a: "You're trying to redeem from an account with no wZEC. Switch to the account that received wZEC from an Issue, or use Dev Tools to direct-mint wZEC."
              },
              {
                q: "\"No finalized blocks in relay\"",
                a: "The relayer hasn't submitted enough headers. Start the relayer: ./scripts/start-devnet.sh --services"
              },
              {
                q: "\"Contract not found\"",
                a: "Contracts aren't deployed. Run: ./scripts/start-devnet.sh --deploy then restart the frontend."
              },
              {
                q: "Balances not updating",
                a: "Balances auto-refresh every 8-15 seconds. If still stale, check that starknet-devnet is running (curl http://127.0.0.1:5050/is_alive)."
              },
              {
                q: "Zcash balance shows \"—\"",
                a: "zcashd is not running or the API route can't reach it. Check: curl http://127.0.0.1:18232 and ensure ZCASH_RPC_USER/PASS are in frontend/.env.local"
              },
            ].map(({ q, a }) => (
              <div key={q} className="bg-white/5 rounded-lg p-3 border border-brand-border">
                <div className="text-xs font-medium text-red-400 mb-1">{q}</div>
                <div className="text-xs text-gray-400">{a}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Links ───────────────────────────────────────────────── */}
        <div className="card p-5">
          <h2 className="text-lg font-semibold mb-3">Quick Links</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Link href="/bridge" className="text-sm text-center bg-white/5 hover:bg-white/10 rounded-lg p-3 border border-brand-border transition-colors">
              <ArrowLeftRight className="h-5 w-5 mx-auto mb-1 text-brand-primary" />
              Bridge
            </Link>
            <Link href="/vaults" className="text-sm text-center bg-white/5 hover:bg-white/10 rounded-lg p-3 border border-brand-border transition-colors">
              <Shield className="h-5 w-5 mx-auto mb-1 text-yellow-400" />
              Vaults
            </Link>
            <Link href="/relay" className="text-sm text-center bg-white/5 hover:bg-white/10 rounded-lg p-3 border border-brand-border transition-colors">
              <Radio className="h-5 w-5 mx-auto mb-1 text-blue-400" />
              Relay
            </Link>
            <Link href="/dev" className="text-sm text-center bg-white/5 hover:bg-white/10 rounded-lg p-3 border border-brand-border transition-colors">
              <Wrench className="h-5 w-5 mx-auto mb-1 text-green-400" />
              Dev Tools
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
