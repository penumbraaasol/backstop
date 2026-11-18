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

function questionOf(e: GeminiEvent, c: GeminiContract, expiry: Date): string {
  const asset = /^([A-Z]+)/.exec(e.ticker)?.[1] ?? "";
  const when = expiry.toISOString().slice(11, 16) + " UTC";
  if (e.template === "crypto-up-down" || c.ticker === "UP") {
    const strike = c.strike?.value ? `$${Number(c.strike.value).toLocaleString("en-US")}` : "its opening price";
    return `${asset} is at or above ${strike} at ${when}`;
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
    category: e.category,
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

export async function curatedMarkets(category = "crypto", perSeries = 3): Promise<MarketView[]> {
  if (cfg.MOCK_MARKETS) return sampleMarkets(perSeries);
  const key = `${category}:${perSeries}`;
  if (cache && cache.key === key && Date.now() - cache.at < 5_000) return cache.data;

  const events = await listEvents({ category, status: "active", limit: 100 });
  const views: MarketView[] = [];
  for (const e of events) {
    for (const c of e.contracts ?? []) {
      const v = toView(e, c);
      if (v && v.secondsToExpiry > cfg.MIN_SECONDS_TO_EXPIRY) views.push(v);
    }
  }
  views.sort((a, b) => a.secondsToExpiry - b.secondsToExpiry);

  // keep the next few windows per series so the list stays short
  const seen = new Map<string, number>();
  const data = views.filter((v) => {
    const s = v.series ?? v.eventTicker;
    const n = seen.get(s) ?? 0;
    seen.set(s, n + 1);
    return n < perSeries;
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
  return out.filter((m) => m.secondsToExpiry > cfg.MIN_SECONDS_TO_EXPIRY).sort((a, b) => a.secondsToExpiry - b.secondsToExpiry);
}
