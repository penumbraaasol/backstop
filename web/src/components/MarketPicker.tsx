"use client";

import { Clock, SearchX, WifiOff } from "lucide-react";
import { useMemo } from "react";
import type { Market, Outcome } from "@/lib/api";
import { assetOf, countdown, HORIZONS, horizonOf, pct, sideText, type Horizon } from "@/lib/format";
import { secondsLeft, useNow } from "@/lib/hooks";
import { AssetIcon, cx } from "./ui";

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
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of markets ?? []) c[horizonOf(m)] = (c[horizonOf(m)] ?? 0) + 1;
    return c;
  }, [markets]);
  const list = (markets ?? []).filter(
    (m) => horizonOf(m) === horizon && (asset === "ALL" || assetOf(m) === asset) && secondsLeft(m, now) > 45,
  );

  return (
    <div className="card flex min-h-[560px] flex-col overflow-hidden">
      <div className="border-b border-line p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-xl bg-white/[0.04] p-1 ring-1 ring-line">
            {HORIZONS.map((h) => (
              <button
                key={h.id}
                onClick={() => setHorizon(h.id)}
                className={cx(
                  "relative rounded-lg px-3 py-1.5 text-sm font-medium transition",
                  horizon === h.id ? "bg-white/10 text-fg shadow-sm" : "text-muted hover:text-fg",
                )}
              >
                {h.label}
                {counts[h.id] ? <span className="ml-1.5 text-xs text-faint tabular-nums">{counts[h.id]}</span> : null}
              </button>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-faint">
            Odds from Gemini · refresh every 5s
          </p>
        </div>
        <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
          {["ALL", ...assets].map((a) => (
            <button
              key={a}
              onClick={() => setAsset(a)}
              className={cx(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition",
                asset === a ? "bg-mint/10 text-mint ring-mint/30" : "text-muted ring-line hover:text-fg hover:ring-line-strong",
              )}
            >
              {a === "ALL" ? "All assets" : a}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden grid-cols-[1fr_auto_auto] gap-4 px-5 pt-3 text-[11px] font-medium uppercase tracking-wider text-faint sm:grid">
        <span>Event</span>
        <span className="w-20 text-right">Closes</span>
        <span className="w-[164px] text-center">Cover price · pays $1</span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 sm:p-3">
        {loading && !markets ? (
          <div className="space-y-2 p-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[68px] rounded-xl skeleton" />
            ))}
          </div>
        ) : error && !markets ? (
          <Empty icon={<WifiOff className="size-5" />} title="Backend unreachable" sub="Start the backend on :8787 and this list fills in." />
        ) : list.length === 0 ? (
          <Empty icon={<SearchX className="size-5" />} title="No open markets here right now" sub="Try another horizon or asset. New windows open every few minutes." />
        ) : (
          <ul className="space-y-1.5">
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
                      "group grid cursor-pointer grid-cols-[1fr_auto] items-center gap-3 rounded-xl border px-3 py-3 transition sm:grid-cols-[1fr_auto_auto] sm:gap-4",
                      active
                        ? "border-mint/40 bg-mint/[0.05] shadow-[0_0_0_1px_rgb(62_230_176/0.15)]"
                        : "border-transparent hover:border-line hover:bg-white/[0.025]",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <AssetIcon asset={assetOf(m)} src={m.imageUrl} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{sideText(m, "yes")}</p>
                        <p className="truncate text-xs text-faint">{m.title}</p>
                      </div>
                    </div>
                    <span
                      className={cx(
                        "hidden w-20 items-center justify-end gap-1 text-right font-mono text-xs tabular-nums sm:flex",
                        left < 120 ? "text-warn" : "text-muted",
                      )}
                    >
                      <Clock className="size-3" />
                      {countdown(left)}
                    </span>
                    <div className="flex gap-1.5">
                      <PriceButton
                        side="yes"
                        price={m.askYes}
                        active={active && outcome === "yes"}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPick(m, "yes");
                        }}
                      />
                      <PriceButton
                        side="no"
                        price={m.askNo}
                        active={active && outcome === "no"}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPick(m, "no");
                        }}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function PriceButton({
  side,
  price,
  active,
  onClick,
}: {
  side: Outcome;
  price: number;
  active: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const yes = side === "yes";
  return (
    <button
      onClick={onClick}
      title={`Cover ${side.toUpperCase()}: ~${Math.round(price * 100)}¢ per $1 of payout`}
      className={cx(
        "flex w-[78px] flex-col items-center rounded-lg px-2 py-1.5 text-xs ring-1 ring-inset transition",
        yes
          ? active
            ? "bg-yes/20 text-yes ring-yes/50"
            : "bg-yes/[0.06] text-yes/90 ring-yes/15 hover:bg-yes/15"
          : active
            ? "bg-no/20 text-no ring-no/50"
            : "bg-no/[0.06] text-no/90 ring-no/15 hover:bg-no/15",
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{yes ? "Yes" : "No"}</span>
      <span className="font-mono font-semibold tabular-nums">{pct(price)}</span>
    </button>
  );
}

function Empty({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-white/[0.05] text-muted ring-1 ring-line">
        {icon}
      </span>
      <p className="mt-4 font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted">{sub}</p>
    </div>
  );
}
