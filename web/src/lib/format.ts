import type { Market } from "./api";

export const usd = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });

export const pct = (p: number) => `${Math.round(p * 100)}%`;

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export function countdown(seconds: number): string {
  if (seconds <= 0) return "closed";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const localTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });

export const assetOf = (m: Pick<Market, "instrumentSymbol">) =>
  /^GEMI-([A-Z]+?)(?:05M|15M|1H|\d)/.exec(m.instrumentSymbol)?.[1] ?? "";

export type Horizon = "5m" | "15m" | "1h" | "later";
export function horizonOf(m: Market): Horizon {
  if (m.kind === "5m") return "5m";
  if (m.kind === "15m") return "15m";
  if (/1H$/.test(m.series ?? "")) return "1h";
  return "later";
}
export const HORIZONS: { id: Horizon; label: string }[] = [
  { id: "5m", label: "5 min" },
  { id: "15m", label: "15 min" },
  { id: "1h", label: "Hourly" },
  { id: "later", label: "Daily +" },
];

const money = (s: string) => `$${Number(s).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Short human sentence for each side of a market. */
export function sideText(m: Market, outcome: "yes" | "no"): string {
  const asset = assetOf(m);
  if (m.strike) return outcome === "yes" ? `${asset} at or above ${money(m.strike)}` : `${asset} below ${money(m.strike)}`;
  // up/down windows that haven't opened yet have no strike: they compare against the opening price
  if (/^up$/i.test(m.label)) return outcome === "yes" ? `${asset} up vs. window open` : `${asset} down vs. window open`;
  return outcome === "yes" ? m.label : `Not “${m.label}”`;
}

/** Premium preview using the backend's integer math: N × (p + s), in USDC. */
export function previewPremium(payout: number, price: number, spread: number) {
  const micro = (x: number) => Math.round(x * 1_000_000);
  const premium = (payout * (micro(price) + micro(spread))) / 1_000_000;
  const hedge = (payout * micro(price)) / 1_000_000;
  return { premium, hedge, margin: premium - hedge, valid: price + spread < 1 };
}
