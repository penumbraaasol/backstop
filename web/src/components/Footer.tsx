import { addressUrl, BACKSTOP_ADDRESS, USDC_ADDRESS } from "@/lib/chain";
import { shortAddr } from "@/lib/format";
import { Logo } from "./ui";

export function Footer() {
  return (
    <footer className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
      <div className="flex flex-col justify-between gap-8 md:flex-row md:items-start">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 text-sm text-muted">
            Parametric event cover on Arc, priced and hedged on Gemini Prediction Markets. Built for UBC 2026.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-faint">Backstop contract</dt>
            <dd>
              <a className="font-mono text-muted hover:text-mint" href={addressUrl(BACKSTOP_ADDRESS)} target="_blank" rel="noreferrer">
                {shortAddr(BACKSTOP_ADDRESS)}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">USDC</dt>
            <dd>
              <a className="font-mono text-muted hover:text-mint" href={addressUrl(USDC_ADDRESS)} target="_blank" rel="noreferrer">
                {shortAddr(USDC_ADDRESS)}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Network</dt>
            <dd className="text-muted">Arc Testnet · 5042002</dd>
          </div>
        </dl>
      </div>
      <p className="mt-10 border-t border-line pt-6 text-xs text-faint">
        Testnet prototype. Not insurance, not financial advice. Market data from Gemini Prediction Markets.
      </p>
    </footer>
  );
}
