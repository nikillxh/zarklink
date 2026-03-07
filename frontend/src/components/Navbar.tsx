"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap, ArrowLeftRight, Shield, BarChart3, Radio, ChevronDown, Copy, Check } from "lucide-react";
import { useAccount } from "@/context/AccountContext";
import { shortAddr } from "@/lib/starknet";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: BarChart3 },
  { href: "/bridge", label: "Bridge", icon: ArrowLeftRight },
  { href: "/vaults", label: "Vaults", icon: Shield },
  { href: "/relay", label: "Relay", icon: Radio },
];

export default function Navbar() {
  const pathname = usePathname();
  const { accounts, selectedIndex, current, select, displayAddress } = useAccount();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function copyAddress() {
    if (current?.address) {
      navigator.clipboard.writeText(current.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <nav className="sticky top-0 z-50 border-b border-brand-border bg-brand-dark/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-primary/10 border border-brand-primary/30 group-hover:border-brand-primary/60 transition-colors">
              <Zap className="h-4 w-4 text-brand-primary" />
            </div>
            <span className="text-lg font-bold text-gradient">ZARKLINK</span>
          </Link>

          {/* Nav Links */}
          <div className="flex items-center gap-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== "/" && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    active
                      ? "bg-brand-primary/10 text-brand-primary"
                      : "text-gray-400 hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </div>

          {/* Account Switcher + Status */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-brand-green animate-pulse" />
              <span className="text-xs text-gray-400">Localhost</span>
            </div>

            {/* Account dropdown */}
            {accounts.length > 0 ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-brand-border bg-brand-card hover:border-brand-primary/40 transition-colors text-sm"
                >
                  <div className="h-5 w-5 rounded-full bg-gradient-to-br from-brand-primary to-brand-blue flex items-center justify-center text-[10px] font-bold text-white">
                    {selectedIndex}
                  </div>
                  <div className="hidden sm:block text-left">
                    <div className="text-xs text-gray-400 leading-none">{current?.label}</div>
                    <div className="font-mono text-xs text-foreground leading-tight">{displayAddress}</div>
                  </div>
                  <ChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-brand-border bg-brand-card shadow-2xl shadow-black/50 overflow-hidden z-50">
                    <div className="p-3 border-b border-brand-border">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-gray-400">Devnet Accounts</span>
                        <button
                          onClick={copyAddress}
                          className="flex items-center gap-1 text-xs text-gray-500 hover:text-foreground transition-colors"
                        >
                          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
                          {copied ? "Copied" : "Copy address"}
                        </button>
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto py-1">
                      {accounts.map((acc, i) => (
                        <button
                          key={acc.address}
                          onClick={() => { select(i); setDropdownOpen(false); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                            i === selectedIndex
                              ? "bg-brand-primary/10 border-l-2 border-brand-primary"
                              : "hover:bg-white/[0.03] border-l-2 border-transparent"
                          }`}
                        >
                          <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            i === selectedIndex
                              ? "bg-brand-primary text-white"
                              : "bg-brand-dark text-gray-400 border border-brand-border"
                          }`}>
                            {i}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-foreground">{acc.label}</div>
                            <div className="font-mono text-[10px] text-gray-500 truncate">{shortAddr(acc.address, 10)}</div>
                          </div>
                          {i === selectedIndex && (
                            <span className="text-[10px] font-medium text-brand-primary bg-brand-primary/10 px-1.5 py-0.5 rounded">
                              Active
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <span className="text-xs text-gray-500 px-2 py-1 border border-brand-border rounded-lg">
                No accounts
              </span>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
