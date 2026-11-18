// Public (no-auth) Gemini Prediction Markets client. Market data always comes from production,
// whatever HEDGE_MODE is, so quotes reflect the real market.
import { cfg } from "../config.js";

export type GeminiPrices = {
  buy?: { yes?: string; no?: string };
  sell?: { yes?: string; no?: string };
  bestBid?: string;
  bestAsk?: string;
  lastTradePrice?: string;
};

export type GeminiContract = {
  id: string;
  label: string;
  ticker: string;
  instrumentSymbol: string;
  status: string; // active | approved | settled | ...
  marketState?: string; // open | closed
  resolutionSide?: "yes" | "no" | null;
  resolvedAt?: string | null;
  expiryDate?: string;
  effectiveDate?: string;
  prices?: GeminiPrices;
  strike?: { type: string; value: string | null; availableAt?: string } | null;
  quantityMinimum?: string;
  quantityIncrement?: string;
  priceIncrement?: string;
};

export type GeminiEvent = {
  id: string;
  title: string;
  ticker: string;
  status: string;
  category: string;
  series?: string;
  expiryDate?: string;
  startTime?: string;
  imageUrl?: string;
  template?: string;
  termsLink?: string;
  eventTags?: { name: string; slug: string }[];
  subcategory?: { name: string; slug: string } | null;
  contracts: GeminiContract[];
};

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${cfg.GEMINI_PUBLIC_URL}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini ${path} -> HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function listEvents(opts: { category?: string; status?: string; limit?: number; offset?: number } = {}) {
  const q = new URLSearchParams();
  q.set("status", opts.status ?? "active");
  if (opts.category) q.set("category", opts.category);
  q.set("limit", String(opts.limit ?? 100));
  if (opts.offset) q.set("offset", String(opts.offset));
  const r = await getJson<{ data: GeminiEvent[]; pagination?: { total: number } }>(
    `/v1/prediction-markets/events?${q}`,
  );
  return r.data;
}

export async function getEvent(eventTicker: string): Promise<GeminiEvent> {
  return getJson<GeminiEvent>(`/v1/prediction-markets/events/${encodeURIComponent(eventTicker)}`);
}

/**
 * Gemini symbols are `GEMI-{eventTicker}-{contractTicker}`. We only use this to find which event
 * to fetch; the contract is then matched on the exact instrumentSymbol Gemini returns.
 */
export function eventTickerGuess(instrumentSymbol: string): string | undefined {
  const m = /^GEMI-(.+)-([^-]+)$/.exec(instrumentSymbol);
  return m?.[1];
}

export async function getContract(instrumentSymbol: string, eventTicker?: string) {
  const ticker = eventTicker ?? eventTickerGuess(instrumentSymbol);
  if (!ticker) throw new Error(`cannot derive event for ${instrumentSymbol}`);
  const event = await getEvent(ticker);
  const contract = event.contracts.find((c) => c.instrumentSymbol === instrumentSymbol);
  if (!contract) throw new Error(`contract ${instrumentSymbol} not found in event ${ticker}`);
  return { event, contract };
}

/** Best ask to BUY the given outcome, as a number in (0,1), or undefined if no liquidity. */
export function askFor(contract: GeminiContract, outcome: "yes" | "no"): number | undefined {
  const raw = contract.prices?.buy?.[outcome];
  if (raw == null || raw === "") return undefined;
  const p = Number(raw);
  return Number.isFinite(p) && p > 0 && p < 1 ? p : undefined;
}

export function isTradable(contract: GeminiContract): boolean {
  return contract.status === "active" && (contract.marketState ?? "open") === "open";
}

export function contractExpiry(event: GeminiEvent, contract: GeminiContract): Date | undefined {
  const s = contract.expiryDate ?? event.expiryDate;
  return s ? new Date(s) : undefined;
}
