// Curated market list for the UI: open contracts with a two-sided price and enough time left to hedge.
import { cfg } from "./config.js";
import {
  askFor,
  contractExpiry,
  isTradable,
  listEvents,
  type GeminiContract,
  type GeminiEvent,
} from "./gemini/public.js";

export type MarketView = {
  instrumentSymbol: string;
  eventTicker: string;
  title: string;
  label: string;
  question: string;
  category: string;
  /** short code (BTC, XAU, BRENT) and a readable name (Bitcoin, Gold, Oil (Brent)) */
  asset: string;
  assetName: string;
  series: string | null;
  kind: "5m" | "15m" | "other";
  startTime: string | null;
  expiry: string;
  secondsToExpiry: number;
  strike: string | null;
  askYes: number;
  askNo: number;
  imageUrl: string | null;
  termsLink: string | null;
};

function kindOf(e: GeminiEvent): MarketView["kind"] {
  const s = e.series ?? e.ticker;
  if (/05M/.test(s)) return "5m";
  if (/15M/.test(s)) return "15m";
  return "other";
}

const NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ether", SOL: "Solana", XRP: "XRP", HYPE: "Hyperliquid", ZEC: "Zcash",
  XAU: "Gold", XAG: "Silver", BRENT: "Brent oil", WTI: "WTI oil", NGAS: "Natural gas", COPPER: "Copper",
};
const assetCode = (e: GeminiEvent) => /^([A-Z]+?)(?:05M|15M|1H|\d)/.exec(e.ticker)?.[1] ?? e.series ?? e.ticker;

function questionOf(e: GeminiEvent, c: GeminiContract, expiry: Date): string {
  const asset = assetCode(e);
  const when = expiry.toISOString().slice(11, 16) + " UTC";
  if (e.template === "crypto-up-down" || c.ticker === "UP") {
    const strike = c.strike?.value ? `$${Number(c.strike.value).toLocaleString("en-US")}` : "its opening price";
    return `${asset} is at or above ${strike} at ${when}`;
  }
  // price ladders (commodities, daily crypto): "Gold is at or above $4,100 on Nov 20"
  if (c.strike?.type === "above" && c.strike.value) {
    const day = expiry.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return `${NAMES[asset] ?? asset} is at or above $${Number(c.strike.value).toLocaleString("en-US")} on ${day}`;
  }
  return `${e.title}: ${c.label}`;
}

export function toView(e: GeminiEvent, c: GeminiContract): MarketView | undefined {
  const expiry = contractExpiry(e, c);
  const askYes = askFor(c, "yes");
  const askNo = askFor(c, "no");
  if (!expiry || askYes == null || askNo == null || !isTradable(c)) return undefined;
  // Both sides at 0.99 means an empty book (e.g. a 5-minute window that has not opened yet).
  if (askYes >= 0.99 && askNo >= 0.99) return undefined;
  return {
    instrumentSymbol: c.instrumentSymbol,
    eventTicker: e.ticker,
    title: e.title,
    label: c.label,
    question: questionOf(e, c, expiry),
    category: e.category.toLowerCase(),
    asset: assetCode(e),
    assetName: e.subcategory?.name ?? NAMES[assetCode(e)] ?? assetCode(e),
    series: e.series ?? null,
    kind: kindOf(e),
    startTime: e.startTime ?? c.effectiveDate ?? null,
    expiry: expiry.toISOString(),
    secondsToExpiry: Math.floor((expiry.getTime() - Date.now()) / 1000),
    strike: c.strike?.value ?? null,
    askYes,
    askNo,
    imageUrl: e.imageUrl ?? null,
    termsLink: e.termsLink ?? null,
  };
}

let cache: { key: string; at: number; data: MarketView[] } | undefined;

/** All active events across categories (paged; Gemini caps a page at 100). */
async function allEvents(category?: string) {
  const out: GeminiEvent[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const page = await listEvents({ category, status: "active", limit: 100, offset });
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

/**
 * Markets for the UI and the agent, across every category Gemini lists.
 * Short-expiry crypto: the next `perSeries` windows per series.
 * Price ladders (commodities, daily crypto): the next 2 dates per series, and per date the
 * strikes nearest the money (asks closest to 0.5), so each list stays readable.
 */
export async function curatedMarkets(category = "all", perSeries = 3): Promise<MarketView[]> {
  if (cfg.MOCK_MARKETS) return sampleMarkets(perSeries).filter((m) => category === "all" || m.category === category);
  const key = `${category}:${perSeries}`;
  if (cache && cache.key === key && Date.now() - cache.at < 5_000) return cache.data;

  const events = await allEvents(category === "all" ? undefined : category);
  const views: MarketView[] = [];
  for (const e of events) {
    const vs = (e.contracts ?? [])
      .map((c) => toView(e, c))
      .filter((v): v is MarketView => !!v && v.secondsToExpiry > cfg.MIN_SECONDS_TO_EXPIRY);
    if (vs.length > 1) {
      // a ladder: keep the 4 strikes nearest the money
      vs.sort((a, b) => Math.abs(a.askYes - 0.5) - Math.abs(b.askYes - 0.5));
      views.push(...vs.slice(0, 4).sort((a, b) => Number(a.strike ?? 0) - Number(b.strike ?? 0)));
    } else views.push(...vs);
  }
  views.sort((a, b) => a.secondsToExpiry - b.secondsToExpiry);

  // keep the next few windows (or dates) per series so the list stays short
  const seen = new Map<string, Set<string>>();
  const data = views.filter((v) => {
    const s = v.series ?? v.eventTicker;
    const set = seen.get(s) ?? new Set<string>();
    seen.set(s, set);
    if (set.has(v.eventTicker)) return true;
    if (set.size >= (v.kind === "other" ? 2 : perSeries)) return false;
    set.add(v.eventTicker);
    return true;
  });
  cache = { key, at: Date.now(), data };
  return data;
}

// --- development only: sample markets for when Gemini's public API is down -------------------
const SAMPLE = [
  { asset: "BTC", spot: 64_300, step: 50 },
  { asset: "ETH", spot: 1_800, step: 5 },
  { asset: "SOL", spot: 74.5, step: 0.25 },
  { asset: "XRP", spot: 0.98, step: 0.005 },
];

/** Deterministic, slowly drifting prices so the UI and the screener see realistic movement. */
function sampleMarkets(perSeries: number): MarketView[] {
  const nowMs = Date.now();
  const out: MarketView[] = [];
  for (const [mins, kind, series] of [
    [5, "5m", "05M"],
    [15, "15m", "15M"],
    [60, "other", "1H"],
  ] as const) {
    const period = mins * 60_000;
    for (let w = 1; w <= perSeries; w++) {
      const end = Math.ceil(nowMs / period) * period + (w - 1) * period;
      const start = end - period;
      for (const [i, a] of SAMPLE.entries()) {
        const t = nowMs / 30_000; // moves every 30 s
        const drift = Math.sin(t / 3 + i * 1.7 + w) * 0.12 + Math.sin(t / 11 + i) * 0.06;
        const yes = Math.min(0.92, Math.max(0.08, +(0.5 + drift).toFixed(2)));
        const no = Math.min(0.95, +(1.02 - yes).toFixed(2));
        const strike = (a.spot + (w - 2) * a.step).toFixed(a.spot > 10 ? 2 : 4);
        const when = new Date(end);
        const ticker = `${a.asset}${series}${when.toISOString().slice(2, 16).replace(/[-T:]/g, "")}`;
        out.push({
          instrumentSymbol: `GEMI-${ticker}-SAMPLE`,
          eventTicker: ticker,
          title: `${a.asset} price at ${when.toISOString().slice(11, 16)} UTC (sample)`,
          label: "Up",
          question: `${a.asset} is at or above $${Number(strike).toLocaleString("en-US")} at ${when.toISOString().slice(11, 16)} UTC`,
          category: "crypto",
          asset: a.asset,
          assetName: NAMES[a.asset] ?? a.asset,
          series: `${a.asset}${series}`,
          kind,
          startTime: new Date(start).toISOString(),
          expiry: when.toISOString(),
          secondsToExpiry: Math.floor((end - nowMs) / 1000),
          strike,
          askYes: yes,
          askNo: no,
          imageUrl: null,
          termsLink: null,
        });
      }
    }
  }
  // commodity ladders, settling at 22:00 UTC today and in two days
  for (const [i, c] of [
    { asset: "XAU", spot: 4_100, step: 25 },
    { asset: "BRENT", spot: 90, step: 1 },
    { asset: "WTI", spot: 86, step: 1 },
    { asset: "NGAS", spot: 3.4, step: 0.1 },
    { asset: "XAG", spot: 52, step: 0.5 },
    { asset: "COPPER", spot: 5.1, step: 0.05 },
  ].entries()) {
    for (const days of [0, 2]) {
      const d = new Date(nowMs);
      d.setUTCHours(22, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() + days + (d.getTime() < nowMs ? 1 : 0));
      const ticker = `${c.asset}${d.toISOString().slice(2, 10).replace(/-/g, "")}2200`;
      for (let k = -1; k <= 2; k++) {
        const strike = +(c.spot + k * c.step).toFixed(2);
        const drift = Math.sin(nowMs / 60_000 + i + k) * 0.05;
        const yes = Math.min(0.9, Math.max(0.1, +(0.62 - k * 0.14 + drift).toFixed(2)));
        out.push({
          instrumentSymbol: `GEMI-${ticker}-HI${strike}-SAMPLE`,
          eventTicker: ticker,
          title: `${NAMES[c.asset]} price on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} (sample)`,
          label: `$${strike} or above`,
          question: `${NAMES[c.asset]} is at or above $${strike.toLocaleString("en-US")} on ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`,
          category: "commodities",
          asset: c.asset,
          assetName: NAMES[c.asset]!,
          series: c.asset,
          kind: "other",
          startTime: null,
          expiry: d.toISOString(),
          secondsToExpiry: Math.floor((d.getTime() - nowMs) / 1000),
          strike: String(strike),
          askYes: yes,
          askNo: Math.min(0.95, +(1.02 - yes).toFixed(2)),
          imageUrl: null,
          termsLink: null,
        });
      }
    }
  }
  return out.filter((m) => m.secondsToExpiry > cfg.MIN_SECONDS_TO_EXPIRY).sort((a, b) => a.secondsToExpiry - b.secondsToExpiry);
}
