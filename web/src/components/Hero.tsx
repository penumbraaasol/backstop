"use client";

import { ArrowRight, Landmark, ShieldCheck, Zap } from "lucide-react";
import { useMemo } from "react";
import { assetOf, countdown, previewPremium, sideText, usd } from "@/lib/format";
import { secondsLeft, useBackendConfig, useMarkets, useNow, useStats } from "@/lib/hooks";
import { AssetIcon, Badge, LiveDot } from "./ui";

export function Hero() {
  const { data: stats } = useStats();
  const { data: markets } = useMarkets();
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="aurora pointer-events-none absolute inset-0" />
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-16 sm:px-8 lg:grid-cols-[1.1fr_0.9fr] lg:pb-28 lg:pt-24">
        <div className="animate-fade-up">
          <a
            href="#how"
            className="group inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] py-1 pl-1 pr-3 text-xs text-muted transition hover:border-line-strong hover:text-fg"
          >
            <span className="rounded-full bg-mint/15 px-2 py-0.5 font-medium text-mint">New</span>
            Parametric cover, hedged on Gemini
            <ArrowRight className="size-3.5 transition group-hover:translate-x-0.5" />
          </a>
          <h1 className="mt-6 text-[2.75rem] font-semibold leading-[1.05] tracking-[-0.035em] text-balance sm:text-6xl lg:text-[4.25rem]">
            <span className="text-gradient">Hedge a real-world event</span> in one click.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted text-pretty">
            Buy USDC cover on Arc. Backstop prices it from Gemini&apos;s live prediction-market odds and backs every
            policy with a matching Gemini position. If the event happens, the smart contract pays you.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <a
              href="#cover"
              className="inline-flex items-center gap-2 rounded-xl bg-mint px-5 py-3 text-[15px] font-medium text-ink shadow-[0_8px_30px_-8px_rgb(62_230_176/0.6)] transition hover:bg-[#5cf0c1] active:scale-[0.98]"
            >
              Get cover <ArrowRight className="size-4" />
            </a>
            <a
              href="#how"
              className="inline-flex items-center gap-2 rounded-xl border border-line-strong bg-white/[0.04] px-5 py-3 text-[15px] font-medium transition hover:bg-white/[0.08]"
            >
              How it works
            </a>
          </div>
          <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-line pt-6">
            <Stat label="Treasury available" value={stats ? usd(Number(stats.freeLiquidityUsdc)) : null} />
            <Stat label="Live markets" value={markets ? String(markets.length) : null} />
            <Stat label="Max cover / policy" value={stats ? usd(Number(stats.maxPayoutUsdc), 0) : null} />
          </dl>
        </div>
        <PolicyPreview />
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight">
        {value ?? <span className="inline-block h-6 w-16 rounded skeleton align-middle" />}
      </dd>
    </div>
  );
}

/** A live "policy" card built from the soonest open market, so the hero shows the real product. */
function PolicyPreview() {
  const { data: markets } = useMarkets();
  const { data: conf } = useBackendConfig();
  const now = useNow();
  const m = useMemo(
    () => markets?.find((x) => secondsLeft(x, now) > 60 && Math.min(x.askYes, x.askNo) < 0.9) ?? markets?.[0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markets],
  );
  const spread = conf?.spread ?? 0.03;
  const outcome = m && m.askYes <= m.askNo ? "yes" : "no";
  const p = m ? (outcome === "yes" ? m.askYes : m.askNo) : 0;
  const payout = 100;
  const { premium } = previewPremium(payout, p, spread);

  return (
    <div className="relative animate-fade-up [animation-delay:120ms]">
      <div className="absolute -inset-8 rounded-[2rem] bg-mint/10 blur-3xl" />
      <div className="card card-glow relative overflow-hidden p-6 sm:p-7">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-medium text-muted">
            <LiveDot /> Live quote
          </span>
          <Badge tone="neutral">Example · {usd(payout, 0)} cover</Badge>
        </div>
        {m ? (
          <>
            <div className="mt-6 flex items-center gap-3">
              <AssetIcon asset={assetOf(m)} src={m.imageUrl} size={44} />
              <div className="min-w-0">
                <p className="truncate text-sm text-muted">{m.title}</p>
                <p className="mt-0.5 truncate text-lg font-semibold tracking-tight">Pays if {sideText(m, outcome)}</p>
              </div>
            </div>
            <div className="mt-7 grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-line bg-white/[0.02] p-4">
                <p className="text-xs text-muted">You pay</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{usd(premium)}</p>
              </div>
              <div className="rounded-2xl border border-mint/25 bg-mint/[0.06] p-4">
                <p className="text-xs text-mint/80">You get if it happens</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-mint">{usd(payout)}</p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3 font-mono text-xs text-muted">
              <span>
                {payout} × ({p.toFixed(2)} + {spread.toFixed(2)})
              </span>
              <span>closes in {countdown(secondsLeft(m, now))}</span>
            </div>
          </>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="h-12 rounded-xl skeleton" />
            <div className="h-24 rounded-xl skeleton" />
            <div className="h-10 rounded-xl skeleton" />
          </div>
        )}
        <ul className="mt-6 grid grid-cols-3 gap-2 text-[11px] text-muted">
          <li className="flex items-center gap-1.5">
            <Zap className="size-3.5 text-mint" /> Priced by Gemini
          </li>
          <li className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-mint" /> Fully hedged
          </li>
          <li className="flex items-center gap-1.5">
            <Landmark className="size-3.5 text-mint" /> Settled on Arc
          </li>
        </ul>
      </div>
    </div>
  );
}
