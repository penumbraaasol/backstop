import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-source-serif", weight: ["400", "500", "600"] });
const sans = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-plex-sans", weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-plex-mono", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Backstop · Event cover in USDC",
  description:
    "Pay a USDC premium on Arc and get paid if an event happens. Priced from Gemini prediction-market odds and hedged on Gemini.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#f5f2ea" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans text-sm">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
