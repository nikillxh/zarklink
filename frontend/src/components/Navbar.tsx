"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap, ArrowLeftRight, Shield, BarChart3, Radio } from "lucide-react";
import WalletConnector from "@/components/WalletConnector";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: BarChart3 },
  { href: "/bridge", label: "Bridge", icon: ArrowLeftRight },
  { href: "/vaults", label: "Vaults", icon: Shield },
  { href: "/relay", label: "Relay", icon: Radio },
];

export default function Navbar() {
  const pathname = usePathname();

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

          {/* Wallet Connection + Status */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-brand-green animate-pulse" />
              <span className="text-xs text-gray-400">Localhost</span>
            </div>

            <WalletConnector />
          </div>
        </div>
      </div>
    </nav>
  );
}
