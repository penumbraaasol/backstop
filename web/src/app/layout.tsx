import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { Providers } from "./providers";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "Backstop · Event cover in USDC", template: "%s · Backstop" },
  description:
    "Pay a USDC premium on Arc and get paid if an event happens. Priced from Gemini prediction-market odds and hedged on Gemini.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#120c08" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans text-sm">
        <Providers>
          <Nav />
          <main className="min-h-[calc(100dvh-4rem)]">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
