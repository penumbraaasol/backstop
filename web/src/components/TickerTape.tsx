"use client";

import { useMemo } from "react";
import type { Market } from "@/lib/api";
import { assetOf, countdown, sideText } from "@/lib/format";
import { secondsLeft, useMarkets, useNow, usePriceTicks } from "@/lib/hooks";
import { cx } from "./ui";

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
          className="flex shrink-0 items-center gap-2.5 border-r border-line px-5 text-xs hover:bg-surface-2"
        >
          <span className="font-mono font-medium text-fg">{assetOf(m)}</span>
          <span className="max-w-[16rem] truncate text-fg-2">{sideText(m, "yes")}</span>
          <span className="num font-mono text-up">Y {m.askYes.toFixed(2)}</span>
          <span className="num font-mono text-down">N {m.askNo.toFixed(2)}</span>
          {t?.yesDir ? (
            <span className={cx("text-[9px]", t.yesDir === 1 ? "text-up" : "text-down")}>{t.yesDir === 1 ? "▲" : "▼"}</span>
          ) : null}
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
      <div className="group relative min-w-0 flex-1 overflow-hidden">
        <div className="tape flex h-full w-max items-stretch group-hover:[animation-play-state:paused]">
          {row(0)}
          {row(1)}
        </div>
        <span className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-bg to-transparent" />
      </div>
    </div>
  );
}
