"use client";

import { useEffect, useMemo, useState } from "react";
import type { Market, Outcome } from "@/lib/api";
import { assetOf, horizonOf, type Horizon } from "@/lib/format";
import { secondsLeft, useMarkets } from "@/lib/hooks";
import { CoverTicket } from "./CoverTicket";
import { MarketPicker } from "./MarketPicker";
import { SectionHeading } from "./ui";

export function CoverSection() {
  const { data: markets, isLoading, isError } = useMarkets();
  const [horizon, setHorizon] = useState<Horizon>("15m");
  const [asset, setAsset] = useState("ALL");
  const [symbol, setSymbol] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>("yes");

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

  const pick = (m: Market, o?: Outcome) => {
    setSymbol(m.instrumentSymbol);
    if (o) setOutcome(o);
  };

  return (
    <section id="cover" className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
      <SectionHeading
        eyebrow="Get cover"
        title="Pick an event. Choose the outcome that pays you."
        sub="Live markets from Gemini. Each price is what $1 of payout costs before the spread."
      />
      <div className="mt-10 grid items-start gap-5 lg:grid-cols-[1.45fr_1fr]">
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
          onPick={pick}
        />
        <div className="lg:sticky lg:top-20">
          <CoverTicket market={selected} outcome={outcome} setOutcome={setOutcome} />
        </div>
      </div>
    </section>
  );
}
