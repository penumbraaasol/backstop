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
