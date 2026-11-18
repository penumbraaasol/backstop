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

// --- spot prices (Gemini exchange public ticker), used to value the agent's hypothetical holdings ---
const spotCache = new Map<string, { at: number; price: number }>();

/** Mid price in USD for BTC, ETH, SOL, XRP… from Gemini's public ticker. Cached for 15 s. */
export async function getSpot(asset: string): Promise<number | undefined> {
  const key = asset.toLowerCase();
  const hit = spotCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.price;
  try {
    const t = await getJson<{ bid?: string; ask?: string; last?: string }>(`/v1/pubticker/${key}usd`);
    const bid = Number(t.bid);
    const ask = Number(t.ask);
    const price = bid > 0 && ask > 0 ? (bid + ask) / 2 : Number(t.last);
    if (!(price > 0)) return hit?.price;
    spotCache.set(key, { at: Date.now(), price });
    return price;
  } catch {
    return hit?.price;
  }
}

// --- hedge venue prices --------------------------------------------------------------------------
// Quotes are priced from production, but the hedge order goes to the venue for HEDGE_MODE: the
// sandbox has its own order books. Selling cover we can't hedge only ends in a refund, so callers
// check the venue's ask first.
const venueCache = new Map<string, { at: number; event: GeminiEvent }>();

/**
 * Can the venue hedge this side near `quoted`? Sandbox mode only: a market the sandbox doesn't list at all
 * (weather, sports, most commodities) is hedged on the simulated venue at the production price instead.
 */
export async function venueCanHedge(instrumentSymbol: string, outcome: "yes" | "no", quoted: number, eventTicker?: string) {
  if (cfg.HEDGE_MODE === "simulated") return { ok: true, via: "simulated" as const, ask: quoted };
  const listed = await venueListed(instrumentSymbol, eventTicker);
  if (!listed && cfg.HEDGE_MODE === "sandbox") return { ok: true, via: "simulated" as const, ask: quoted };
  const ask = await venueAsk(instrumentSymbol, outcome, eventTicker);
  const ok = ask !== undefined && ask <= quoted + cfg.MAX_SLIPPAGE;
  // sandbox books are thin and drift from production: hedge those on the simulated venue at the production price.
  // Live mode stays strict: no real hedge, no sale.
  if (!ok && cfg.HEDGE_MODE === "sandbox") return { ok: true, via: "simulated" as const, ask: quoted };
  return { ok, via: cfg.HEDGE_MODE, ask };
}

/** Listed on the venue with a live book (at least one side has an ask). An empty book means nobody trades it there. */
export async function venueListed(instrumentSymbol: string, eventTicker?: string): Promise<boolean> {
  if (cfg.HEDGE_MODE === "simulated") return false;
  const ev = await venueEvent(eventTicker ?? eventTickerGuess(instrumentSymbol));
  const c = ev?.contracts?.find((x) => x.instrumentSymbol === instrumentSymbol);
  return !!c && (askFor(c, "yes") !== undefined || askFor(c, "no") !== undefined);
}

async function venueEvent(ticker: string | undefined): Promise<GeminiEvent | undefined> {
  if (!ticker || cfg.HEDGE_MODE === "simulated") return undefined;
  const base = cfg.HEDGE_MODE === "sandbox" ? "https://api.sandbox.gemini.com" : cfg.GEMINI_PUBLIC_URL;
  const key = `${base}|${ticker}`;
  let hit = venueCache.get(key);
  if (!hit || Date.now() - hit.at > 10_000) {
    const res = await fetch(`${base}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      venueCache.set(key, { at: Date.now(), event: { contracts: [] } as unknown as GeminiEvent });
      return undefined;
    }
    hit = { at: Date.now(), event: (await res.json()) as GeminiEvent };
    venueCache.set(key, hit);
  }
  return hit.event;
}

export async function venueAsk(instrumentSymbol: string, outcome: "yes" | "no", eventTicker?: string): Promise<number | undefined> {
  if (cfg.HEDGE_MODE === "simulated") return undefined; // simulated hedges fill at the production ask
  const ev = await venueEvent(eventTicker ?? eventTickerGuess(instrumentSymbol));
  const c = ev?.contracts?.find((x) => x.instrumentSymbol === instrumentSymbol);
  return c ? askFor(c, outcome) : undefined;
}
