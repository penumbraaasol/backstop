// Cover assistant: turns a plain-English worry into a suggested policy (market, side, payout).
// Grok only suggests. The buyer reviews the filled-in ticket and signs the purchase themselves.
import { backstopAbi, backstopAddress, publicClient, USDC_UNIT } from "./chain.js";
import { cfg } from "./config.js";
import { curatedMarkets, type MarketView } from "./markets.js";
import { QuoteError } from "./quotes.js";

export type Suggestion = {
  instrumentSymbol: string | null;
  outcome: "yes" | "no" | null;
  payout: number | null;
  /** one short sentence the UI shows as the headline */
  summary: string;
  /** why this market and side hedge the stated risk, 1–2 sentences */
  reasoning: string;
  market?: MarketView;
  model: string;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    instrumentSymbol: { type: ["string", "null"], description: "Exactly one symbol from the list, or null if nothing fits" },
    outcome: { type: ["string", "null"], enum: ["yes", "no", null] },
    payout: { type: ["integer", "null"], description: "Whole USDC paid out if the covered outcome happens" },
    summary: { type: "string", description: "One short sentence, e.g. 'Cover 2 USDC if BTC is below $64,300 at 9:00 PM.'" },
    reasoning: { type: "string", description: "At most two short sentences on why this hedges the user's risk" },
  },
  required: ["instrumentSymbol", "outcome", "payout", "summary", "reasoning"],
} as const;

function systemPrompt(maxPayout: number) {
  return [
    "You are the cover assistant for Backstop, a testnet app that sells parametric event cover in USDC.",
    "A policy pays N USDC if a chosen outcome of a Gemini prediction market happens. Its premium is N × (ask + 0.03).",
    "The user describes a risk or a position. Choose the ONE market and side whose payout offsets that risk:",
    "- Someone long an asset who fears a drop wants the outcome where the price ends BELOW a level: that is NO on an 'at or above' market, or NO on an 'up' market.",
    "- Someone short, or waiting to buy, who fears a rise wants YES on an 'at or above' or 'up' market.",
    "- Match the asset and the time horizon the user mentions. If they give none, prefer the soonest market with more than 3 minutes left.",
    "- Prefer a strike near the current level (asks between 0.25 and 0.75) unless the user asks for crash or tail protection.",
    `- Payout is a whole number from 1 to ${maxPayout} USDC (testnet limit). Default to 2 if the user gives no size; scale with what they say, but never above ${maxPayout}.`,
    "Only use symbols from the provided list. If nothing fits (wrong asset, no time match, not a hedging request), return nulls and say briefly why in reasoning.",
    "Write plainly, no hype, no emojis. Mention concrete numbers (strike, time). Never promise profit; this is cover, not a trade.",
  ].join("\n");
}

function marketLines(markets: MarketView[]) {
  return markets
    .map(
      (m) =>
        `${m.instrumentSymbol} | ${m.question} | closes in ${Math.round(m.secondsToExpiry / 60)} min | YES ask ${m.askYes.toFixed(2)} | NO ask ${m.askNo.toFixed(2)}`,
    )
    .join("\n");
}

// a small per-IP budget so a public deployment can't run up the xAI bill
const hits = new Map<string, number[]>();
export function allowAssist(ip: string, perMinute = 6) {
  const t = Date.now();
  const recent = (hits.get(ip) ?? []).filter((x) => t - x < 60_000);
  if (recent.length >= perMinute) return false;
  recent.push(t);
  hits.set(ip, recent);
  return true;
}

export type RawSuggestion = Omit<Suggestion, "model" | "market">;

/** One structured Grok call. Exported so it can be tested against sample market lines. */
export async function askGrok(message: string, lines: string, maxPayout: number): Promise<RawSuggestion> {
  if (!cfg.GROK_API_KEY) throw new QuoteError("The cover assistant isn't configured on this server.", "assistant_off", 503);
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.GROK_API_KEY}` },
    signal: AbortSignal.timeout(25_000),
    body: JSON.stringify({
      model: cfg.GROK_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt(maxPayout) },
        {
          role: "user",
          content: `Current time: ${new Date().toISOString()}\nOpen markets (symbol | question | time left | asks):\n${lines}\n\nUser: ${message}`,
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: "cover_suggestion", strict: true, schema: SCHEMA } },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string } }[];
    error?: unknown;
  };
  if (!res.ok) throw new QuoteError(`Grok request failed (HTTP ${res.status}).`, "assistant_upstream", 502);

  try {
    return JSON.parse(body.choices?.[0]?.message?.content ?? "");
  } catch {
    throw new QuoteError("Grok returned an answer I couldn't read. Try rephrasing.", "assistant_parse", 502);
  }
}

export async function suggestCover(message: string): Promise<Suggestion> {
  if (!cfg.GROK_API_KEY) throw new QuoteError("The cover assistant isn't configured on this server.", "assistant_off", 503);

  const [markets, maxPayoutRaw, freeRaw] = await Promise.all([
    curatedMarkets("all", 3).catch(() => {
      throw new QuoteError("Gemini's market data isn't responding right now, so Grok can't see live prices. Try again shortly.", "markets_unavailable", 503);
    }),
    publicClient.readContract({ address: backstopAddress, abi: backstopAbi, functionName: "maxPayoutPerPolicy" }) as Promise<bigint>,
    publicClient.readContract({ address: backstopAddress, abi: backstopAbi, functionName: "freeLiquidity" }) as Promise<bigint>,
  ]);
  const open = markets.filter((m) => m.secondsToExpiry > 120 && Math.min(m.askYes, m.askNo) < 0.97);
  if (!open.length) throw new QuoteError("No markets are open right now.", "no_markets", 409);
  const maxPayout = Math.max(1, Math.floor(Number(maxPayoutRaw < freeRaw ? maxPayoutRaw : freeRaw) / Number(USDC_UNIT)));

  const raw = await askGrok(message, marketLines(open), maxPayout);

  // never trust the model's choice blindly: the symbol must be one we offered, the size within limits
  const market = open.find((m) => m.instrumentSymbol === raw.instrumentSymbol);
  if (!market || (raw.outcome !== "yes" && raw.outcome !== "no")) {
    return { instrumentSymbol: null, outcome: null, payout: null, summary: raw.summary, reasoning: raw.reasoning, model: cfg.GROK_MODEL };
  }
  const payout = Math.min(maxPayout, Math.max(1, Math.round(raw.payout ?? 2)));
  return { ...raw, instrumentSymbol: market.instrumentSymbol, payout, market, model: cfg.GROK_MODEL };
}
