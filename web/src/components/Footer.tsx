import { addressUrl, BACKSTOP_ADDRESS, USDC_ADDRESS } from "@/lib/chain";
import { ExtLink, Wordmark } from "./ui";

export function Footer() {
  return (
    <footer className="mx-auto max-w-[1240px] px-5 pb-12 pt-4 sm:px-8">
      <div className="grid gap-8 border-t-2 border-ink pt-6 md:grid-cols-[1fr_auto]">
        <div className="max-w-sm">
          <Wordmark />
          <p className="mt-2 text-sm text-ink-2">
            Event cover on Arc, priced and hedged on Gemini Prediction Markets. Built for the UBC 2026 hackathon.
          </p>
        </div>
        <dl className="grid gap-x-10 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-2">Backstop contract</dt>
            <dd className="mt-0.5 font-mono text-xs">
              <ExtLink href={addressUrl(BACKSTOP_ADDRESS)}>{BACKSTOP_ADDRESS.slice(0, 10)}…{BACKSTOP_ADDRESS.slice(-6)}</ExtLink>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">USDC</dt>
            <dd className="mt-0.5 font-mono text-xs">
              <ExtLink href={addressUrl(USDC_ADDRESS)}>{USDC_ADDRESS.slice(0, 10)}…{USDC_ADDRESS.slice(-6)}</ExtLink>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-2">Network</dt>
            <dd className="mt-0.5 text-xs">Arc Testnet (5042002)</dd>
          </div>
        </dl>
      </div>
      <p className="mt-8 text-xs text-ink-2">
        Testnet prototype. Not an insurance contract and not financial advice. Market data: Gemini Prediction Markets.
      </p>
    </footer>
  );
}
