"use client";

import { useMemo } from "react";
import type { Market, Outcome } from "@/lib/api";
import { assetOf, categoryLabel, closeLabel, countdown, HORIZONS, horizonOf, sideText, type Horizon } from "@/lib/format";
import { secondsLeft, useNow, usePriceTicks, type Tick } from "@/lib/hooks";
import { RollingNumber } from "./RollingNumber";
import { cx, Ticker } from "./ui";

const ROW = "grid grid-cols-[1fr_auto] items-center gap-4 sm:grid-cols-[minmax(0,1fr)_4.5rem_6rem_auto]";

export function MarketPicker({
  markets,
  loading,
  error,
  backendDown,
  category,
  setCategory,
  horizon,
  setHorizon,
  asset,
  setAsset,
  selected,
  outcome,
  onPick,
}: {
  markets: Market[] | undefined;
  loading: boolean;
  error: boolean;
  backendDown?: boolean;
  category: string;
  setCategory: (c: string) => void;
  horizon: Horizon;
  setHorizon: (h: Horizon) => void;
  asset: string;
  setAsset: (a: string) => void;
  selected?: string;
  outcome: Outcome;
  onPick: (m: Market, o?: Outcome) => void;
}) {
  const now = useNow();
  const ticks = usePriceTicks(markets);
  const categories = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of markets ?? []) c.set(m.category, (c.get(m.category) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => (a[0] === "crypto" ? -1 : b[0] === "crypto" ? 1 : b[1] - a[1]));
  }, [markets]);
  const inCategory = (markets ?? []).filter((m) => m.category === category);
  const assets = [...new Set(inCategory.map(assetOf))].filter(Boolean);
  const crypto = category === "crypto";
  const list = inCategory.filter(
    (m) => (!crypto || horizonOf(m) === horizon) && (asset === "ALL" || assetOf(m) === asset) && secondsLeft(m, now) > 45,
  );

  return (
    <div className="rounded-lg border border-line bg-surface px-5 pb-4 pt-4">
      {categories.length > 1 && (
        <div className="mb-3 inline-flex rounded-md bg-surface-2 p-0.5" role="tablist" aria-label="Market category">
          {categories.map(([c, n]) => (
            <button
              key={c}
              role="tab"
              aria-selected={category === c}
              onClick={() => setCategory(c)}
              className={cx(
                "rounded-[5px] px-3 py-1 text-xs font-medium transition-colors",
                category === c ? "bg-bg text-fg shadow-sm" : "text-fg-2 hover:text-fg",
              )}
            >
              {categoryLabel(c)} <span className="num text-fg-3">{n}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line">
        <div className="flex gap-6" role="tablist">
          {(crypto ? HORIZONS : [{ id: horizon, label: "Daily price ladders" }]).map((h) => (
            <button
              key={h.id}
              role="tab"
              aria-selected={horizon === h.id}
              onClick={() => setHorizon(h.id)}
              className={cx(
                "-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors",
                horizon === h.id ? "border-fg text-fg" : "border-transparent text-fg-2 hover:text-fg",
              )}
            >
              {h.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pb-2.5 text-xs">
          {["ALL", ...assets].map((a) => (
            <button
              key={a}
              onClick={() => setAsset(a)}
              className={cx(
                "font-mono",
                asset === a ? "text-fg underline decoration-2 underline-offset-4" : "text-fg-2 hover:text-fg",
              )}
            >
              {a === "ALL" ? "All" : a}
            </button>
          ))}
        </div>
      </div>

      <div className={cx(ROW, "border-b border-line py-2 text-xs text-fg-2")}>
        <span>Outcome</span>
        <span className="hidden text-right sm:block">Yes, live</span>
        <span className="hidden text-right sm:block">Closes</span>
        <span className="flex gap-1">
          <span className="w-[4.5rem] text-center">Yes</span>
          <span className="w-[4.5rem] text-center">No</span>
        </span>
      </div>

      {loading && !markets ? (
        <ul>
          {Array.from({ length: 7 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 border-b border-line py-3.5">
              <span className="placeholder h-6 w-12" />
              <span className="placeholder h-4 flex-1" />
              <span className="placeholder h-8 w-36" />
            </li>
          ))}
        </ul>
      ) : error && !markets ? (
        backendDown ? (
          <Note title="Can't reach the Backstop backend." body="Markets load from the Backstop backend. This list fills in once it's reachable." />
        ) : (
          <Note title="Gemini's market data isn't responding." body="Live prices come straight from Gemini. They'll appear here as soon as Gemini is back." />
        )
      ) : list.length === 0 ? (
        <Note title="No open markets in this window." body="New windows open every few minutes. Try another horizon or asset." />
      ) : (
        <ul>
          {list.map((m) => (
            <MarketRow
              key={m.instrumentSymbol}
              m={m}
              tick={ticks.get(m.instrumentSymbol)}
              now={now}
              active={m.instrumentSymbol === selected}
              outcome={outcome}
              onPick={onPick}
            />
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-fg-2">
        Prices are Gemini&apos;s best ask, in USDC per 1 USDC of payout, refreshed every 5 seconds. The thin line under
        each row shows how much of the market&apos;s window has passed.
      </p>
    </div>
  );
}

function MarketRow({
  m,
  tick,
  now,
  active,
  outcome,
  onPick,
}: {
  m: Market;
  tick?: Tick;
  now: number;
  active: boolean;
  outcome: Outcome;
  onPick: (m: Market, o?: Outcome) => void;
}) {
  const left = secondsLeft(m, now);
  const start = m.startTime ? new Date(m.startTime).getTime() : null;
  const end = new Date(m.expiry).getTime();
  const elapsed = start && end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : null;
  const yesShare = m.askYes / (m.askYes + m.askNo);

  return (
    <li className="relative">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onPick(m)}
        onKeyDown={(e) => e.key === "Enter" && onPick(m)}
        className={cx(
          ROW,
          "cursor-pointer border-b border-line py-3 pl-3 pr-1 transition-colors",
          active ? "bg-surface-2 shadow-[inset_2px_0_0_0_var(--color-fg)]" : "hover:bg-surface-2/60",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Ticker asset={assetOf(m)} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-fg">{sideText(m, "yes")}</p>
            <p className="truncate text-xs text-fg-2">
              <span className="num font-mono sm:hidden">in {countdown(left)} · </span>
              {m.title}
            </p>
            {/* implied odds: YES share vs NO share of the two asks */}
            <div
              className="mt-1.5 flex h-[3px] w-full max-w-[200px] gap-px overflow-hidden rounded-full"
              title={`Implied odds: YES ${Math.round(yesShare * 100)}%, NO ${Math.round((1 - yesShare) * 100)}%`}
            >
              <span className="rounded-l-full bg-up/70" style={{ width: `${yesShare * 100}%` }} />
              <span className="flex-1 rounded-r-full bg-down/60" />
            </div>
          </div>
        </div>
        <div className="hidden justify-end sm:flex">
          <Sparkline series={tick?.series} />
        </div>
        <div className="hidden text-right sm:block">
          <p className="num text-sm text-fg">{closeLabel(m.expiry)}</p>
          <p className={cx("num font-mono text-xs", left < 120 ? "text-warn" : "text-fg-2")}>in {countdown(left)}</p>
        </div>
        <div className="flex gap-1">
          {(["yes", "no"] as const).map((o) => (
            <PriceChip
              key={`${o}-${o === "yes" ? tick?.yesSeq : tick?.noSeq}`}
              side={o}
              price={o === "yes" ? m.askYes : m.askNo}
              on={active && outcome === o}
              dir={o === "yes" ? tick?.yesDir : tick?.noDir}
              changed={!!(o === "yes" ? tick?.yesSeq : tick?.noSeq)}
              onClick={(e) => {
                e.stopPropagation();
                onPick(m, o);
              }}
            />
          ))}
        </div>
      </div>
      {elapsed !== null && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-px bg-fg-3"
          style={{ width: `${elapsed * 100}%` }}
        />
      )}
    </li>
  );
}

function PriceChip({
  side,
  price,
  on,
  dir,
  changed,
  onClick,
}: {
  side: Outcome;
  price: number;
  on: boolean;
  dir?: -1 | 0 | 1;
  changed: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const yes = side === "yes";
  return (
    <button
      aria-label={`Cover ${side}, ${price.toFixed(2)} USDC per 1 USDC payout`}
      onClick={onClick}
      className={cx(
        "num relative w-[4.5rem] rounded-sm py-1.5 text-sm font-semibold transition-colors",
        yes
          ? on
            ? "bg-up text-bg"
            : "bg-up/10 text-up hover:bg-up/20"
          : on
            ? "bg-down text-bg"
            : "bg-down/10 text-down hover:bg-down/20",
        changed && dir === 1 && "flash-up",
        changed && dir === -1 && "flash-down",
      )}
    >
      <RollingNumber value={price.toFixed(2)} />
      {changed && dir ? (
        <span
          className={cx(
            "absolute right-1.5 top-1 text-[8px] leading-none",
            on ? "text-bg" : dir === 1 ? "text-up" : "text-down",
          )}
        >
          {dir === 1 ? "▲" : "▼"}
        </span>
      ) : null}
    </button>
  );
}

/** YES price since the page opened. Green if it's up from the first point, red if down. */
function Sparkline({ series }: { series?: number[] }) {
  const W = 64;
  const H = 22;
  if (!series || series.length < 2)
    return (
      <svg width={W} height={H} aria-hidden>
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--color-line-strong)" strokeDasharray="2 3" />
      </svg>
    );
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 0.01;
  const pts = series.map((v, i) => [(i / (series.length - 1)) * W, H - 3 - ((v - min) / span) * (H - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const delta = series[series.length - 1]! - series[0]!;
  const color = delta > 0 ? "var(--color-up)" : delta < 0 ? "var(--color-down)" : "var(--color-fg-3)";
  const [lx, ly] = pts[pts.length - 1]!;
  return (
    <svg width={W} height={H} role="img" aria-label={`YES ${delta >= 0 ? "up" : "down"} ${Math.abs(delta).toFixed(2)} since the page opened`}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="1.75" fill={color} />
    </svg>
  );
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <div className="border-b border-line py-14 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-fg-2">{body}</p>
    </div>
  );
}
