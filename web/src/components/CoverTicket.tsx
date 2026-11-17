"use client";

import { AlertCircle, Check, ChevronDown, Droplets, ExternalLink, Info, Loader2, Minus, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useChainId, useConnection } from "wagmi";
import type { Market, Outcome } from "@/lib/api";
import { arcTestnet, FAUCET_URL, txUrl } from "@/lib/chain";
import { assetOf, countdown, localTime, previewPremium, sideText, usd } from "@/lib/format";
import { secondsLeft, useBackendConfig, useBuyCover, useNow, useStats, useUsdcBalance, type BuyStep } from "@/lib/hooks";
import { ConnectButton, useMounted } from "./ConnectButton";
import { AssetIcon, Button, cx } from "./ui";

const PRESETS = [1, 2, 5];

export function CoverTicket({
  market,
  outcome,
  setOutcome,
}: {
  market?: Market;
  outcome: Outcome;
  setOutcome: (o: Outcome) => void;
}) {
  const mounted = useMounted();
  const now = useNow();
  const { isConnected } = useConnection();
  const chainId = useChainId();
  const { data: conf } = useBackendConfig();
  const { data: stats } = useStats();
  const { data: balRaw } = useUsdcBalance();
  const { step, error, result, quoteExpiry, buy, reset } = useBuyCover();
  const [payout, setPayout] = useState(2);
  const [showMath, setShowMath] = useState(false);

  const spread = conf?.spread ?? 0.03;
  const maxPayout = stats
    ? Math.max(
        1,
        Math.floor(Math.min(Number(stats.maxPayoutUsdc), Number(stats.freeLiquidityUsdc), Number(stats.maxExposurePerMarketUsdc))),
      )
    : 5;
  useEffect(() => setPayout((p) => Math.min(Math.max(1, p), maxPayout)), [maxPayout]);

  // a new selection clears a finished or failed purchase
  useEffect(() => {
    if (step === "done" || step === "error") reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market?.instrumentSymbol, outcome]);

  if (!market)
    return (
      <div className="card flex min-h-[560px] flex-col items-center justify-center p-8 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-mint/10 text-mint ring-1 ring-mint/25">
          <ShieldCheck className="size-6" />
        </span>
        <p className="mt-5 text-lg font-semibold">Pick an event to cover</p>
        <p className="mt-1.5 max-w-xs text-sm text-muted">
          Choose a market on the left. Tap YES or NO to choose which outcome pays you.
        </p>
      </div>
    );

  const price = outcome === "yes" ? market.askYes : market.askNo;
  const { premium, hedge, margin, valid } = previewPremium(payout, price, spread);
  const left = secondsLeft(market, now);
  const busy = ["switch", "quote", "approve", "buy", "confirm"].includes(step);
  const balance = balRaw !== undefined ? Number(balRaw) / 1e6 : undefined;
  // keep a little USDC back for gas, which is also paid in USDC on Arc
  const short = balance !== undefined && balance < premium + 0.02;
  const closed = left <= 45;
  const multiple = premium > 0 ? payout / premium : 0;

  return (
    <div className="card card-glow flex flex-col p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <AssetIcon asset={assetOf(market)} src={market.imageUrl} size={40} />
          <div className="min-w-0">
            <p className="truncate text-xs text-muted">{market.title}</p>
            <p className="truncate font-semibold tracking-tight">{sideText(market, "yes")}?</p>
          </div>
        </div>
        <span
          className={cx(
            "shrink-0 rounded-lg px-2 py-1 font-mono text-xs tabular-nums ring-1 ring-inset",
            left < 120 ? "bg-warn/10 text-warn ring-warn/25" : "bg-white/[0.04] text-muted ring-line",
          )}
        >
          {countdown(left)}
        </span>
      </div>

      <p className="mt-5 text-xs font-medium text-muted">Pay me if…</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(["yes", "no"] as const).map((o) => {
          const on = outcome === o;
          const p = o === "yes" ? market.askYes : market.askNo;
          return (
            <button
              key={o}
              disabled={busy}
              onClick={() => setOutcome(o)}
              className={cx(
                "rounded-xl border p-3 text-left transition",
                on
                  ? o === "yes"
                    ? "border-yes/50 bg-yes/[0.08]"
                    : "border-no/50 bg-no/[0.08]"
                  : "border-line bg-white/[0.02] hover:border-line-strong",
              )}
            >
              <span className="flex items-center justify-between">
                <span className={cx("text-xs font-semibold uppercase tracking-wider", o === "yes" ? "text-yes" : "text-no")}>
                  {o}
                </span>
                <span
                  className={cx(
                    "flex size-4 items-center justify-center rounded-full ring-1",
                    on ? (o === "yes" ? "bg-yes ring-yes" : "bg-no ring-no") : "ring-line-strong",
                  )}
                >
                  {on && <Check className="size-3 text-ink" strokeWidth={3} />}
                </span>
              </span>
              <span className="mt-1.5 block text-sm font-medium leading-snug">{sideText(market, o)}</span>
              <span className="mt-1 block text-xs text-faint">{Math.round(p * 100)}% implied</span>
            </button>
          );
        })}
      </div>

      <p className="mt-5 text-xs font-medium text-muted">Cover amount</p>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex flex-1 items-center rounded-xl border border-line bg-white/[0.02] focus-within:border-mint/50">
          <button
            aria-label="Decrease"
            disabled={busy || payout <= 1}
            onClick={() => setPayout((p) => Math.max(1, p - 1))}
            className="p-3 text-muted transition hover:text-fg disabled:opacity-30"
          >
            <Minus className="size-4" />
          </button>
          <div className="flex flex-1 items-baseline justify-center gap-1">
            <span className="text-lg text-faint">$</span>
            <input
              type="number"
              min={1}
              max={maxPayout}
              step={1}
              value={payout}
              disabled={busy}
              onChange={(e) => {
                const v = Math.floor(Number(e.target.value));
                if (!Number.isNaN(v)) setPayout(Math.min(Math.max(1, v), maxPayout));
              }}
              className="w-14 bg-transparent text-center text-2xl font-semibold tabular-nums tracking-tight outline-none"
            />
          </div>
          <button
            aria-label="Increase"
            disabled={busy || payout >= maxPayout}
            onClick={() => setPayout((p) => Math.min(maxPayout, p + 1))}
            className="p-3 text-muted transition hover:text-fg disabled:opacity-30"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="flex gap-1">
          {PRESETS.filter((x) => x <= maxPayout).map((x) => (
            <button
              key={x}
              disabled={busy}
              onClick={() => setPayout(x)}
              className={cx(
                "rounded-lg px-2.5 py-2 text-xs font-medium ring-1 ring-inset transition",
                payout === x ? "bg-white/10 text-fg ring-line-strong" : "text-muted ring-line hover:text-fg",
              )}
            >
              ${x}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-faint">Testnet limit: up to {usd(maxPayout, 0)} per policy.</p>

      <div className="mt-5 rounded-2xl border border-line bg-black/20 p-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-muted">You pay</p>
            <p className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight">{valid ? usd(premium) : "–"}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">You get if it happens</p>
            <p className="mt-0.5 text-3xl font-semibold tabular-nums tracking-tight text-mint">{usd(payout)}</p>
          </div>
        </div>
        {valid && (
          <p className="mt-2 text-xs text-faint">
            {multiple.toFixed(2)}× your premium · otherwise the cover expires
          </p>
        )}
        <button
          onClick={() => setShowMath((s) => !s)}
          className="mt-3 flex w-full items-center justify-between border-t border-line pt-3 text-xs text-muted transition hover:text-fg"
        >
          <span className="flex items-center gap-1.5">
            <Info className="size-3.5" /> How this price is set
          </span>
          <ChevronDown className={cx("size-4 transition", showMath && "rotate-180")} />
        </button>
        {showMath && (
          <div className="mt-3 animate-fade-up space-y-2 text-xs">
            <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-center font-mono text-[13px] text-fg">
              N × (p + s) = {payout} × ({price.toFixed(2)} + {spread.toFixed(2)}) = {usd(premium)}
            </div>
            <Row k={`Hedge: buy ${payout} ${outcome.toUpperCase()} on Gemini at ${price.toFixed(2)}`} v={usd(hedge)} />
            <Row k={`Protocol spread (${Math.round(spread * 100)}¢ per contract)`} v={usd(margin)} />
            <Row k="If it happens, Gemini pays $1 per contract" v={usd(payout)} strong />
          </div>
        )}
      </div>

      <div className="mt-5">
        {!mounted ? (
          <div className="h-12 rounded-xl skeleton" />
        ) : !isConnected ? (
          <ConnectButton className="w-full [&>button]:w-full" size="lg" />
        ) : step === "done" && result ? (
          <Success result={result} onAgain={reset} />
        ) : busy ? (
          <Progress step={step} quoteExpiry={quoteExpiry} now={now} />
        ) : (
          <>
            {short && chainId === arcTestnet.id ? (
              <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="block">
                <Button variant="secondary" className="w-full py-3.5 text-[15px]">
                  <Droplets className="size-4" /> Not enough USDC · open faucet
                </Button>
              </a>
            ) : (
              <Button
                className="w-full py-3.5 text-[15px]"
                disabled={!valid || closed}
                onClick={() => buy(market, outcome, payout)}
              >
                {closed ? "Market closing" : !valid ? "Too expensive to cover" : `Buy cover · ${usd(premium)}`}
              </Button>
            )}
            {error && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-no/10 px-3 py-2 text-xs text-no ring-1 ring-inset ring-no/20">
                <AlertCircle className="mt-px size-3.5 shrink-0" /> {error}
              </p>
            )}
          </>
        )}
      </div>

      <ul className="mt-5 space-y-1.5 text-[11px] leading-relaxed text-faint">
        <li>• Price locks for 60 s once you click buy. The final premium can move a cent or two with the market.</li>
        <li>• If the Gemini hedge can&apos;t fill, your premium is refunded automatically.</li>
        <li>• Settles at {localTime(market.expiry)} from Gemini&apos;s official result.</li>
      </ul>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <span className="text-muted">{k}</span>
      <span className={cx("font-mono tabular-nums", strong ? "text-mint" : "text-fg")}>{v}</span>
    </div>
  );
}

const STEPS: { id: BuyStep; label: string }[] = [
  { id: "quote", label: "Lock price with a signed quote" },
  { id: "approve", label: "Approve USDC" },
  { id: "buy", label: "Confirm purchase in your wallet" },
  { id: "confirm", label: "Waiting for Arc confirmation" },
];

function Progress({ step, quoteExpiry, now }: { step: BuyStep; quoteExpiry?: number; now: number }) {
  const idx = step === "switch" ? -1 : STEPS.findIndex((s) => s.id === step);
  const ttl = quoteExpiry ? Math.max(0, Math.floor((quoteExpiry - now) / 1000)) : null;
  return (
    <div className="rounded-xl border border-line bg-white/[0.02] p-4">
      {step === "switch" && (
        <p className="mb-3 flex items-center gap-2 text-sm text-warn">
          <Loader2 className="size-4 animate-spin" /> Switch your wallet to Arc Testnet
        </p>
      )}
      <ol className="space-y-2.5">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 text-sm">
            <span
              className={cx(
                "flex size-5 items-center justify-center rounded-full text-[10px] font-semibold",
                i < idx && "bg-mint text-ink",
                i === idx && "bg-mint/15 text-mint ring-1 ring-mint/40",
                i > idx && "bg-white/[0.04] text-faint ring-1 ring-line",
              )}
            >
              {i < idx ? <Check className="size-3" strokeWidth={3} /> : i === idx ? <Loader2 className="size-3 animate-spin" /> : i + 1}
            </span>
            <span className={cx(i === idx ? "text-fg" : i < idx ? "text-muted" : "text-faint")}>{s.label}</span>
            {s.id === "quote" && i < idx && ttl !== null && (
              <span className="ml-auto font-mono text-[11px] text-faint tabular-nums">valid {ttl}s</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Success({ result, onAgain }: { result: { policyId: number; txHash: string; premiumUsdc: string; payoutUsdc: string }; onAgain: () => void }) {
  return (
    <div className="animate-fade-up rounded-xl border border-mint/30 bg-mint/[0.06] p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 animate-pulse-ring items-center justify-center rounded-full bg-mint text-ink">
          <Check className="size-5" strokeWidth={3} />
        </span>
        <div>
          <p className="font-semibold">You&apos;re covered · Policy #{result.policyId}</p>
          <p className="text-xs text-muted">
            Paid {usd(Number(result.premiumUsdc))} for {usd(Number(result.payoutUsdc))} of cover. Hedging on Gemini now.
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <a href="#policies" className="flex-1">
          <Button variant="secondary" className="w-full">
            Track policy
          </Button>
        </a>
        <a href={txUrl(result.txHash)} target="_blank" rel="noreferrer">
          <Button variant="ghost">
            Tx <ExternalLink className="size-3.5" />
          </Button>
        </a>
        <Button variant="ghost" onClick={onAgain}>
          New
        </Button>
      </div>
    </div>
  );
}
