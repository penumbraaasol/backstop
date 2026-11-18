"use client";

import { useMemo } from "react";
import type { Market, Outcome } from "@/lib/api";
import { assetOf, countdown, HORIZONS, horizonOf, sideText, timeOfDay, type Horizon } from "@/lib/format";
import { secondsLeft, useNow } from "@/lib/hooks";
import { cx, Ticker } from "./ui";

export function MarketPicker({
  markets,
  loading,
  error,
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
  horizon: Horizon;
  setHorizon: (h: Horizon) => void;
  asset: string;
  setAsset: (a: string) => void;
  selected?: string;
  outcome: Outcome;
  onPick: (m: Market, o?: Outcome) => void;
}) {
  const now = useNow();
  const assets = useMemo(() => [...new Set((markets ?? []).map(assetOf))].filter(Boolean), [markets]);
  const list = (markets ?? []).filter(
    (m) => horizonOf(m) === horizon && (asset === "ALL" || assetOf(m) === asset) && secondsLeft(m, now) > 45,
  );

  return (
    <div className="rounded-lg border border-line bg-surface px-5 pb-4 pt-3">
      {/* horizon: underlined text tabs */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line">
        <div className="flex gap-6" role="tablist">
          {HORIZONS.map((h) => (
            <button
              key={h.id}
              role="tab"
              aria-selected={horizon === h.id}
              onClick={() => setHorizon(h.id)}
              className={cx(
                "-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors",
                horizon === h.id ? "border-line-strong text-fg" : "border-transparent text-fg-2 hover:text-fg",
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

      <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-line py-2 text-xs text-fg-2 sm:grid-cols-[1fr_6.5rem_auto]">
        <span>Outcome</span>
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
              <span className="placeholder h-5 w-12" />
              <span className="placeholder h-4 flex-1" />
              <span className="placeholder h-8 w-36" />
            </li>
          ))}
        </ul>
      ) : error && !markets ? (
        <Note title="Can't reach the Backstop backend." body="Markets load from the backend on port 8787. Start it and this list fills in." />
      ) : list.length === 0 ? (
        <Note title="No open markets in this window." body="New windows open every few minutes. Try another horizon or asset." />
      ) : (
        <ul>
          {list.map((m) => {
            const active = m.instrumentSymbol === selected;
            const left = secondsLeft(m, now);
            return (
              <li key={m.instrumentSymbol}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onPick(m)}
                  onKeyDown={(e) => e.key === "Enter" && onPick(m)}
                  className={cx(
                    "grid cursor-pointer grid-cols-[1fr_auto] items-center gap-4 border-b border-line py-3 pl-3 pr-1 transition-colors sm:grid-cols-[1fr_6.5rem_auto]",
                    active ? "bg-surface-2 shadow-[inset_2px_0_0_0_var(--color-fg)]" : "hover:bg-surface-2/60",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Ticker asset={assetOf(m)} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fg">{sideText(m, "yes")}</p>
                      <p className="truncate text-xs text-fg-2">
                        <span className="num font-mono sm:hidden">in {countdown(left)} · </span>
                        {m.title}
                      </p>
                    </div>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="num text-sm text-fg">{timeOfDay(m.expiry)}</p>
                    <p className={cx("num font-mono text-xs", left < 120 ? "text-warn" : "text-fg-2")}>
                      in {countdown(left)}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {(["yes", "no"] as const).map((o) => {
                      const on = active && outcome === o;
                      const price = o === "yes" ? m.askYes : m.askNo;
                      return (
                        <button
                          key={o}
                          aria-label={`Cover ${o}, ${price.toFixed(2)} USDC per 1 USDC payout`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPick(m, o);
                          }}
                          className={cx(
                            "num w-[4.5rem] rounded-sm py-1.5 text-sm font-semibold transition-colors",
                            o === "yes"
                              ? on
                                ? "bg-up text-bg"
                                : "bg-up/10 text-up hover:bg-up/20"
                              : on
                                ? "bg-down text-bg"
                                : "bg-down/10 text-down hover:bg-down/20",
                          )}
                        >
                          {price.toFixed(2)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-fg-2">
        Prices are Gemini&apos;s current best ask, in USDC per 1 USDC of payout. They refresh every 5 seconds.
      </p>
    </div>
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
