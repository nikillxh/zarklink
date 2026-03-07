import { Zap } from "lucide-react";

export default function Footer() {
  return (
    <footer className="border-t border-brand-border bg-brand-dark/50 mt-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-gray-500">
            <Zap className="h-4 w-4 text-brand-primary/50" />
            <span className="text-sm">
              Zarklink — Privacy-Preserving Zcash ↔ Starknet Bridge
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <span>Based on ZCLAIM Protocol</span>
            <span>STARK Proofs</span>
            <span>Vault Pool Model</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
