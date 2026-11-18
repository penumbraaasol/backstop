"use client";

import { useEffect, useMemo, useState } from "react";
import type { Market, Outcome } from "@/lib/api";
import { assetOf, horizonOf, type Horizon } from "@/lib/format";
import { secondsLeft, useMarkets, useStats } from "@/lib/hooks";
import { CoverTicket } from "./CoverTicket";
import { MarketPicker } from "./MarketPicker";

export function CoverSection() {
  const { data: markets, isLoading, isError, error } = useMarkets();
  const [horizon, setHorizon] = useState<Horizon>("15m");
  const [asset, setAsset] = useState("ALL");
  const [symbol, setSymbol] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>("no");
  const [payout, setPayout] = useState(2);


  // keep the selected market fresh as prices refresh; fall back to the first match when it closes
  const selected = useMemo<Market | undefined>(() => {
    const now = Date.now();
    const open = (markets ?? []).filter((m) => secondsLeft(m, now) > 45);
    return (
      open.find((m) => m.instrumentSymbol === symbol) ??
      open.find((m) => horizonOf(m) === horizon && (asset === "ALL" || assetOf(m) === asset))
    );
  }, [markets, symbol, horizon, asset]);

  useEffect(() => {
    if (selected && selected.instrumentSymbol !== symbol) setSymbol(selected.instrumentSymbol);
  }, [selected, symbol]);

  return (
    <section id="cover" className="mx-auto max-w-[1240px] px-5 pb-20 pt-14 sm:px-8 sm:pt-20">
      <Intro marketCount={markets?.length} />
      <div className="mt-12 grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <div>
            <MarketPicker
              markets={markets}
              loading={isLoading}
              error={isError}
              backendDown={(error as { code?: string } | null)?.code === "offline"}
              horizon={horizon}
              setHorizon={(h) => {
                setHorizon(h);
                setSymbol(undefined);
              }}
              asset={asset}
              setAsset={(a) => {
                setAsset(a);
                setSymbol(undefined);
              }}
              selected={selected?.instrumentSymbol}
              outcome={outcome}
              onPick={(m, o) => {
                setSymbol(m.instrumentSymbol);
                if (o) setOutcome(o);
              }}
            />
          </div>
        </div>
        <div className="lg:sticky lg:top-20">
          <CoverTicket
            market={selected}
            marketsLoading={isLoading}
            outcome={outcome}
            setOutcome={setOutcome}
            payout={payout}
            setPayout={setPayout}
          />
        </div>
      </div>
    </section>
  );
}

function Intro({ marketCount }: { marketCount?: number }) {
  const { data: stats } = useStats();
  const facts: [string, string | undefined][] = [
    ["Treasury available", stats && `${Number(stats.freeLiquidityUsdc).toFixed(2)} USDC`],
    ["Open Gemini markets", marketCount?.toString()],
    ["Max payout per policy", stats && `${Number(stats.maxPayoutUsdc).toFixed(0)} USDC`],
    ["Network", "Arc Testnet"],
  ];
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
      <div>
        <h1 className="font-display text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.045em] text-balance sm:text-2xl">
          Hedge a real-world event in one click.
        </h1>
        <p className="mt-5 max-w-xl text-md text-fg-2">
          Pay a premium in USDC. If the outcome you pick happens, the contract pays you. The price comes from
          Gemini&apos;s prediction market, and every policy is hedged there.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {facts.map(([k, v]) => (
          <div key={k} className="bg-bg px-4 py-3.5">
            <dt className="text-xs text-fg-2">{k}</dt>
            <dd className="num mt-1 text-md font-semibold tracking-tight">
              {v ?? <span className="placeholder inline-block h-5 w-20 align-middle" />}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
