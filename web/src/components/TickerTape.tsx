"use client";

import { useMemo } from "react";
import type { Market } from "@/lib/api";
import { assetOf, closeLabel, countdown } from "@/lib/format";
import { secondsLeft, useMarkets, useNow, usePriceTicks } from "@/lib/hooks";
import { cx } from "./ui";

/** "≥ $64,250", "≥ $4,100", or "up" for windows without a strike yet. */
function short(m: Market) {
  if (!m.strike) return m.category === "crypto" ? "up vs open" : m.label;
  const n = Number(m.strike);
  return `≥ $${n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 3 : 0 })}`;
}

/**
 * A TradingView-style ticker tape of live markets. Scrolls continuously, pauses on hover,
 * and clicking an item selects that market. A live clock and the next close sit on the left.
 */
export function TickerTape({ onPick }: { onPick?: (m: Market) => void }) {
  const { data: markets } = useMarkets();
  const ticks = usePriceTicks(markets);
  const now = useNow();
  const items = useMemo(
    () => (markets ?? []).filter((m) => secondsLeft(m, Date.now()) > 45).slice(0, 18),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markets],
  );
  const next = items.reduce<Market | undefined>((a, m) => (!a || m.expiry < a.expiry ? m : a), undefined);
  if (!items.length) return null;

  const row = (copy: number) =>
    items.map((m) => {
      const t = ticks.get(m.instrumentSymbol);
      return (
        <button
          key={`${copy}-${m.instrumentSymbol}`}
          onClick={() => onPick?.(m)}
          tabIndex={copy ? -1 : 0}
          className="flex shrink-0 items-center gap-2 whitespace-nowrap px-4 text-xs transition-colors hover:bg-surface-2"
        >
          <span className="font-mono font-semibold text-fg">{assetOf(m)}</span>
          <span className="num text-fg-2">{short(m)}</span>
          <span className="num text-fg-3">· {closeLabel(m.expiry)}</span>
          <span className="num ml-1 font-mono text-up">Y {m.askYes.toFixed(2)}</span>
          <span className="num font-mono text-down">N {m.askNo.toFixed(2)}</span>
          <span className={cx("w-2 text-[9px]", t?.yesDir === 1 ? "text-up" : "text-down")}>
            {t?.yesDir === 1 ? "▲" : t?.yesDir === -1 ? "▼" : ""}
          </span>
          <span className="ml-3 h-3 w-px bg-line-strong" aria-hidden />
        </button>
      );
    });

  return (
    <div className="flex h-9 items-stretch border-b border-line bg-bg">
      <div className="z-10 flex shrink-0 items-center gap-3 border-r border-line bg-bg px-5 font-mono text-[11px] text-fg-2">
        <span className="flex items-center gap-1.5">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-up opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-up" />
          </span>
          LIVE
        </span>
        <span className="num hidden text-fg sm:inline">
          {new Date(now).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
        </span>
        {next && (
          <span className="num hidden md:inline">
            next close <span className="text-fg">{countdown(secondsLeft(next, now))}</span>
          </span>
        )}
      </div>
      {/* both edges fade, so items slide in and out instead of being cut off */}
      <div className="group relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_48px,black_calc(100%-48px),transparent)]">
        <div className="tape flex h-full w-max items-stretch group-hover:[animation-play-state:paused]">
          {row(0)}
          {row(1)}
        </div>
      </div>
    </div>
  );
}
