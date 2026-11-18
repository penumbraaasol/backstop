"use client";

import { useEffect, useMemo, useState } from "react";
import type { Market, Outcome } from "@/lib/api";
import { assetOf, horizonOf, type Horizon } from "@/lib/format";
import { secondsLeft, useMarkets } from "@/lib/hooks";
import { CoverTicket } from "./CoverTicket";
import { MarketPicker } from "./MarketPicker";

export function CoverSection() {
  const { data: markets, isLoading, isError } = useMarkets();
  const [horizon, setHorizon] = useState<Horizon>("15m");
  const [asset, setAsset] = useState("BTC");
  const [symbol, setSymbol] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>("no");

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
    <section id="cover" className="mx-auto max-w-[1240px] px-5 pb-20 pt-10 sm:px-8 sm:pt-12">
      <div className="grid items-start gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <h1 className="font-serif text-xl font-medium tracking-[-0.01em] text-balance sm:text-[2.5rem] sm:leading-[1.12]">
            Pick an outcome. If it happens, you get paid in USDC.
          </h1>
          <p className="mt-3 max-w-xl text-md text-ink-2">
            Prices come from Gemini&apos;s prediction market. Every policy is hedged on Gemini and paid out by a
            contract on Arc.
          </p>
          <div className="mt-10">
            <MarketPicker
              markets={markets}
              loading={isLoading}
              error={isError}
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
          <CoverTicket market={selected} marketsLoading={isLoading} outcome={outcome} setOutcome={setOutcome} />
        </div>
      </div>
    </section>
  );
}
