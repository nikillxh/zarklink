import type { Metadata } from "next";
import localFont from "next/font/local";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { AccountProvider } from "@/context/AccountContext";
import { WalletProvider } from "@/context/WalletContext";
import { BridgeProvider } from "@/context/BridgeContext";
import { ZcashAccountProvider } from "@/context/ZcashAccountContext";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Zarklink — Zcash ↔ Starknet Bridge",
  description: "Privacy-preserving bridge between Zcash and Starknet using STARK proofs and the Vault Pool Model.",
  openGraph: {
    title: "Zarklink — Zcash ↔ Starknet Bridge",
    description: "Privacy-preserving bridge between Zcash and Starknet using STARK proofs and the Vault Pool Model.",
    url: "https://zarklink.vercel.app",
    siteName: "Zarklink",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Zarklink — Zcash ↔ Starknet Bridge",
    description: "Privacy-preserving bridge between Zcash and Starknet using STARK proofs and the Vault Pool Model.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <AccountProvider>
          <WalletProvider>
            <ZcashAccountProvider>
              <BridgeProvider>
                <Navbar />
                <main className="flex-1">{children}</main>
                <Footer />
              </BridgeProvider>
            </ZcashAccountProvider>
          </WalletProvider>
        </AccountProvider>
      </body>
    </html>
  );
}
