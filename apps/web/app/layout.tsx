import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { Inter, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/header";
import { I18nProvider } from "@/lib/i18n";

/**
 * Three voices, loaded once and self-hosted at build time (next/font):
 * Newsreader for statements (variable weight: 300 display, 400 titles, 500 small),
 * Inter for body, JetBrains Mono for evidence (ids, hashes, amounts, labels).
 */
const newsreader = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], display: "swap", variable: "--font-newsreader" });
const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Spout · Settlement console",
  description: "Devnet orders, broker execution, on-chain settlement. Every step on the ledger.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className={`${newsreader.variable} ${inter.variable} ${mono.variable} min-h-screen`}>
        <I18nProvider>
          <Header />
          <main className="sx-container sx-section">{children}</main>
        <footer className="sx-container" style={{ borderTop: "1px solid var(--rule-soft)", padding: "1.5rem 0 2.5rem", marginTop: "3rem" }}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="sx-overline">Spout · settlement worker · take-home</span>
            <span className="sx-mono" style={{ fontSize: "0.6875rem" }}>
              orders-lite · devnet · Alpaca Broker API sandbox
            </span>
          </div>
        </footer>
        </I18nProvider>
        <Analytics />
      </body>
    </html>
  );
}
