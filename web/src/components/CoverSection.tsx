"use client";

import { useEffect, useMemo, useState } from "react";
import type { Market, Outcome } from "@/lib/api";
import { assetOf, horizonOf, type Horizon } from "@/lib/format";
import { secondsLeft, useMarkets, useStats } from "@/lib/hooks";
import { CoverTicket } from "./CoverTicket";
import { MarketPicker } from "./MarketPicker";
import { TickerTape } from "./TickerTape";

export function CoverSection() {
  const { data: markets, isLoading, isError, error } = useMarkets();
  const [category, setCategory] = useState("crypto");
  const [horizon, setHorizon] = useState<Horizon>("15m");
  const [horizonPicked, setHorizonPicked] = useState(false);
  const [asset, setAsset] = useState("ALL");
  const [symbol, setSymbol] = useState<string>();
  const [outcome, setOutcome] = useState<Outcome>("no");
  const [payout, setPayout] = useState(2);


  // keep the selected market fresh as prices refresh; fall back to the first match when it closes
  const selected = useMemo<Market | undefined>(() => {
    const now = Date.now();
    const canHedge = (m: Market) => !m.hedgeable || m.hedgeable.yes || m.hedgeable.no;
    const open = (markets ?? []).filter((m) => secondsLeft(m, now) > 45).sort((a, b) => Number(canHedge(b)) - Number(canHedge(a)));
    return (
      open.find((m) => m.instrumentSymbol === symbol) ??
      open.find(
        (m) =>
          m.category === category &&
          (category !== "crypto" || horizonOf(m) === horizon) &&
          (asset === "ALL" || assetOf(m) === asset),
      )
    );
  }, [markets, symbol, category, horizon, asset]);

  useEffect(() => {
    if (selected && selected.instrumentSymbol !== symbol) setSymbol(selected.instrumentSymbol);
  }, [selected, symbol]);

  // Gemini doesn't always list every crypto horizon: until the user picks a tab,
  // land on the first one (15 min, 5 min, hourly, daily) that has open markets
  useEffect(() => {
    if (horizonPicked || category !== "crypto" || !markets) return;
    const now = Date.now();
    const has = (h: Horizon) => markets.some((m) => m.category === "crypto" && horizonOf(m) === h && secondsLeft(m, now) > 45);
    if (has(horizon)) return;
    const next = (["15m", "5m", "1h", "later"] as Horizon[]).find(has);
    if (next) {
      setHorizon(next);
      setSymbol(undefined);
    }
  }, [markets, horizon, horizonPicked, category]);

  // if the chosen side can't be hedged but the other can, switch to it
  useEffect(() => {
    const h = selected?.hedgeable;
    if (!h || h[outcome]) return;
    const other = outcome === "yes" ? "no" : "yes";
    if (h[other]) setOutcome(other);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.instrumentSymbol, selected?.hedgeable?.yes, selected?.hedgeable?.no]);

  return (
    <>
      <TickerTape
        onPick={(m) => {
          setCategory(m.category);
          if (m.category === "crypto") setHorizon(horizonOf(m));
          setAsset("ALL");
          setSymbol(m.instrumentSymbol);
        }}
      />
    <section id="cover" className="mx-auto max-w-[1240px] px-5 pb-20 pt-14 sm:px-8 sm:pt-20">
      <Intro marketCount={markets?.length} />
      <div className="mt-12 grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <div>
            <MarketPicker
              markets={markets}
              loading={isLoading}
              error={isError}
              category={category}
              setCategory={(c) => {
                setCategory(c);
                setAsset("ALL");
                setSymbol(undefined);
              }}
              backendDown={(error as { code?: string } | null)?.code === "offline"}
              horizon={horizon}
              setHorizon={(h) => {
                setHorizon(h);
                setHorizonPicked(true);
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
                // a row click keeps the side if it can be hedged, otherwise switches to the side that can
                else if (m.hedgeable && !m.hedgeable[outcome]) {
                  const other = outcome === "yes" ? "no" : "yes";
                  if (m.hedgeable[other]) setOutcome(other);
                }
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
    </>
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
        <h1 className="font-hero text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.045em] text-balance sm:text-2xl">
          Hedge a real-world event in one click.
        </h1>
        <p className="mt-5 max-w-xl text-md text-fg-2">
          Priced on Gemini&rsquo;s live odds. Settled in USDC on Arc. Hedged on autopilot with Grok.
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
