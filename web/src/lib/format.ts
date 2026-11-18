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

export const assetOf = (m: Pick<Market, "instrumentSymbol" | "asset">) =>
  m.asset ?? /^GEMI-([A-Z]+?)(?:05M|15M|1H|\d)/.exec(m.instrumentSymbol)?.[1] ?? "";

/** Readable asset name for sentences: "Gold", "Brent oil", or the ticker for crypto. */
const nameOf = (m: Market) => (m.category === "crypto" ? assetOf(m) : (m.assetName ?? assetOf(m)));

export const CATEGORY_LABEL: Record<string, string> = { crypto: "Crypto", commodities: "Commodities", weather: "Weather", sports: "Sports" };
export const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c.charAt(0).toUpperCase() + c.slice(1);

/** "9:15 PM" for markets closing within a day, otherwise "Nov 20". */
export const closeLabel = (iso: string) =>
  new Date(iso).getTime() - Date.now() < 20 * 3600_000
    ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

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
  const asset = nameOf(m);
  if (m.strike) return outcome === "yes" ? `${asset} at or above ${money(m.strike)}` : `${asset} below ${money(m.strike)}`;
  // up/down windows that haven't opened yet have no strike: they compare against the opening price
  if (/^up$/i.test(m.label)) return outcome === "yes" ? `${asset} up from window open` : `${asset} down from window open`;
  if (m.category === "sports") return outcome === "yes" ? `${m.label} wins` : `${m.label} doesn't win`;
  if (m.category === "weather") return outcome === "yes" ? `High of ${m.label}` : `High outside ${m.label}`;
  return outcome === "yes" ? m.label : `Not “${m.label}”`;
}

/** Premium preview using the backend's integer math: N × (p + s), in USDC. */
export function previewPremium(payout: number, price: number, spread: number) {
  const micro = (x: number) => Math.round(x * 1_000_000);
  const premium = (payout * (micro(price) + micro(spread))) / 1_000_000;
  const hedge = (payout * micro(price)) / 1_000_000;
  return { premium, hedge, margin: premium - hedge, valid: price + spread < 1 };
}

/** "5:30 AM" in the viewer's time zone. */
export const timeOfDay = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "Nov 17, 05:30:12" for the tracking log (unix seconds). */
export const stamp = (unix: number) =>
  new Date(unix * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

/** Plain USDC amount: "1.26". */
export const usdc = (n: number | string) => Number(n).toFixed(2);

/** Full clause for sentences: "BTC is below $64,935.82 at 5:30 AM". */
export function condition(m: Market, outcome: "yes" | "no"): string {
  const asset = nameOf(m);
  const at = m.category === "crypto" ? timeOfDay(m.expiry) : `${closeLabel(m.expiry)}, ${timeOfDay(m.expiry)}`;
  if (m.strike)
    return outcome === "yes" ? `${asset} is at or above ${money(m.strike)} at ${at}` : `${asset} is below ${money(m.strike)} at ${at}`;
  if (/^up$/i.test(m.label))
    return outcome === "yes" ? `${asset} is up from its opening price at ${at}` : `${asset} is down from its opening price at ${at}`;
  if (m.category === "sports") return outcome === "yes" ? `${m.label} wins (${m.title})` : `${m.label} doesn't win (${m.title})`;
  if (m.category === "weather") return outcome === "yes" ? `the high is ${m.label} (${m.title.replace(/\?$/, "")})` : `the high is outside ${m.label} (${m.title.replace(/\?$/, "")})`;
  return outcome === "yes" ? `“${m.label}” happens` : `“${m.label}” doesn't happen`;
}
